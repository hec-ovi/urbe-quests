/**
 * Contract-surface tests for quests/builder: the scripted agent drafts through
 * the tools from a plan, gets validation feedback, finishes; cast resolution
 * by type and by reservation (shared across questlines); the translator's
 * plan pass; E_LLM and E_CAST paths.
 */

import { describe, expect, it } from 'vitest';
import type { AgentPort, AgentReply, AgentToolCall, LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineBuilder } from '../QuestlineBuilder.js';
import { QuestlineTranslator } from '../QuestlineTranslator.js';
import type { QuestAssignment } from '../schema.js';

const ASSIGNMENT: QuestAssignment = {
  title: 'The Kettle Debt',
  synopsis: 'A city where the water bill is paid in names.',
  characters: 'Mara Vex\nRole: a barista at the Static Cafe\nVoice: dry. "Coffee is free if you are paying with bad news."',
  arc: 'Presentation\nA barista owes the wrong lender and wants one favor run quietly.',
};
const PLAN = 'Plan: cast Mara as cafe_barista; the ledger is a document at the Grey Market; one act, one ending.';

const step = (input: Record<string, unknown>): AgentToolCall => ({ tool: 'add_step', input });

const SETUP_CALLS: AgentToolCall[] = [
  {
    tool: 'create_questline',
    input: { id: 'q_kettle', title: 'The Kettle Debt', premise: 'A barista owes the wrong lender.' },
  },
  { tool: 'add_role', input: { roleId: 'barista', npcType: 'cafe_barista', persona: 'Nervy, in debt.' } },
  {
    tool: 'add_role',
    input: {
      roleId: 'lender',
      npcType: 'corpo_exec',
      persona: 'Charges interest in favors.',
      reservedName: { given: 'Sable', family: 'Quill' },
    },
  },
  {
    tool: 'add_item',
    input: { itemId: 'ledger', name: 'Debt ledger', description: 'Sable\'s names and numbers; Mara\'s is the ninth.', kind: 'document', atParcelId: 'p7' },
  },
  {
    tool: 'add_item',
    input: { itemId: 'stall', name: 'Which stall hides it', description: 'Mara knows the stall; she tells it.', kind: 'information' },
  },
  { tool: 'add_fact', input: { factId: 'f_debt', roleId: 'barista', text: 'I owe Sable more than the cafe earns.', gateFlag: 'knows_debt' } },
  { tool: 'add_fact', input: { factId: 'f_iou', roleId: 'lender', text: 'Debts are memory with interest. I never forget either.' } },
  { tool: 'add_act', input: { actId: 'a1', title: 'The Favor', summary: 'Run the errand.' } },
  { tool: 'add_ending', input: { endingId: 'e_paid', title: 'Paid Off', epilogue: 'The debt dies quietly.' } },
];

const STEP_CALLS: AgentToolCall[] = [
  step({
    narrative: {
      description: 'The barista asks for one quiet favor.',
      playerHint: 'Talk to the barista at the Static Cafe.',
      stake: 'If the ledger surfaces, the cafe is Sable\'s by spring.',
    },
    wantedByRoleId: 'barista',
    stepId: 's_ask',
    actId: 'a1',
    target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' },
    gives: ['stall'],
    effects: [{ kind: 'setFlag', flag: 'knows_debt' }],
    next: [{ toStepId: 's_fetch', when: [] }],
    entry: true,
  }),
  step({
    narrative: { description: 'The ledger sits in a market stall.', playerHint: 'Pick up the ledger.', stake: 'Her name is in it.' },
    wantedByRoleId: 'barista',
    stepId: 's_fetch',
    actId: 'a1',
    target: { kind: 'pickup', itemId: 'ledger' },
    needs: ['stall'],
    next: [{ toStepId: 's_pay', when: [] }],
  }),
];

const FINAL_STEP = step({
  narrative: {
    description: 'Sable takes the ledger and forgets a name.',
    playerHint: 'Deliver the ledger to Helix Dynamics Tower.',
    stake: 'Sable wants the book back more than the debt.',
  },
  wantedByRoleId: 'lender',
  stepId: 's_pay',
  actId: 'a1',
  target: { kind: 'deliver', itemId: 'ledger', place: { parcelId: 'p1' } },
  needs: ['ledger'],
  next: [],
  endingId: 'e_paid',
});

const FULL_BUILD: AgentReply[] = [{ kind: 'calls', calls: [...SETUP_CALLS, ...STEP_CALLS, FINAL_STEP, { tool: 'finish_questline', input: {} }] }];

function scriptedAgent(script: AgentReply[]) {
  const requests: Parameters<AgentPort['step']>[0][] = [];
  const queue = [...script];
  const agent: AgentPort = {
    step: async (request) => {
      requests.push(request);
      return queue.shift() ?? { kind: 'done', text: 'out of script' };
    },
  };
  return { agent, requests };
}

function fixtureDeps() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'builder-test', world, types });
  return { world, types, sim };
}

describe('QuestlineBuilder', () => {
  it('answers a text-only reply with a nudge back to the tools and goes on', async () => {
    const { agent, requests } = scriptedAgent([{ kind: 'done', text: 'I have added everything.' }, ...FULL_BUILD]);
    const deps = fixtureDeps();
    const { definition } = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent, ...deps });

    expect(definition.steps.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(2);
    const turns = requests[1]!.transcript;
    expect(turns[0]).toEqual({ role: 'assistant', text: 'I have added everything.' });
    expect(turns[1]?.role).toBe('user');
    expect('text' in turns[1]! && turns[1].text).toContain('finish_questline');
  });

  it('gives up after three text-only replies', async () => {
    const { agent } = scriptedAgent([]);
    const deps = fixtureDeps();
    await expect(new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent, ...deps })).rejects.toThrow(/without finishing/);
  });

  it('drafts from the plan through the tools, corrects a validation failure from feedback, and resolves the cast', async () => {
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: SETUP_CALLS },
      { kind: 'calls', calls: [...STEP_CALLS, { tool: 'finish_questline', input: {} }] },
      { kind: 'calls', calls: [FINAL_STEP, { tool: 'finish_questline', input: {} }] },
    ]);
    const deps = fixtureDeps();
    const { definition, cast } = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent, ...deps });

    expect(requests).toHaveLength(3);
    const toolTurns = requests[2]!.transcript.filter((t) => t.role === 'tool');
    expect(toolTurns.some((t) => t.results.some((r) => r.result.includes('error:')))).toBe(true);

    expect(definition.id).toBe('q_kettle');
    expect(definition.flags).toEqual(['knows_debt']);
    expect(definition.steps).toHaveLength(3);
    expect(definition.steps[0]).toMatchObject({ wantedByRoleId: 'barista', gives: ['stall'], needs: [] });
    expect(definition.items.map((i) => i.kind)).toEqual(['document', 'information']);
    expect(deps.sim.getNPC(cast['barista']!).type).toBe('cafe_barista');
    expect(deps.sim.getNPC(cast['barista']!).job?.parcelId).toBe('p4');
    expect(deps.sim.getNPC(cast['lender']!).name).toEqual({ given: 'Sable', family: 'Quill' });

    const { system, prompt } = requests[0]!;
    expect(system).toContain('Step catalog');
    expect(system).toContain('Artifact catalog');
    expect(prompt).toContain(PLAN);
    expect(prompt).toContain('Mara Vex');
    expect(prompt).toContain('[parcelId p4]');
    expect(prompt).not.toContain('owes the wrong lender and wants one favor');
  });

  it('casts a reserved character once across questlines', async () => {
    const deps = fixtureDeps();
    const first = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent: scriptedAgent(FULL_BUILD).agent, ...deps });
    const second = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent: scriptedAgent(FULL_BUILD).agent, ...deps });
    expect(second.cast['lender']).toBe(first.cast['lender']);
  });

  it('throws E_LLM when the agent stops without finishing', async () => {
    const { agent } = scriptedAgent([{ kind: 'done', text: 'I refuse.' }]);
    await expect(new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent, ...fixtureDeps() })).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM' }),
    );
  });

  it('throws E_LLM when the round budget runs out', async () => {
    const { agent } = scriptedAgent([
      { kind: 'calls', calls: [{ tool: 'create_questline', input: { id: 'q', title: 't', premise: 'p' } }] },
      { kind: 'calls', calls: [{ tool: 'add_act', input: { actId: 'a1', title: 't', summary: 's' } }] },
    ]);
    await expect(
      new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent, maxRounds: 2, ...fixtureDeps() }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_LLM' }));
  });

  it('throws E_CAST when a role type has no castable NPC', async () => {
    const { agent } = scriptedAgent([
      {
        kind: 'calls',
        calls: [
          { tool: 'create_questline', input: { id: 'q_ghost', title: 'Ghost', premise: 'Nobody staffs this.' } },
          { tool: 'add_role', input: { roleId: 'ghost', npcType: 'sump_resident', persona: 'Stays home.' } },
          { tool: 'add_act', input: { actId: 'a1', title: 'a', summary: 's' } },
          { tool: 'add_ending', input: { endingId: 'e', title: 'e', epilogue: 'done' } },
          step({
            narrative: { description: 'Ask around the Sump.', playerHint: 'Talk to a resident.', stake: 'Someone has to ask.' },
            stepId: 's1',
            actId: 'a1',
            target: { kind: 'talk', roleId: 'ghost' },
            next: [],
            endingId: 'e',
            entry: true,
          }),
          { tool: 'finish_questline', input: {} },
        ],
      },
    ]);
    await expect(new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, agent, ...fixtureDeps() })).rejects.toThrowError(
      expect.objectContaining({ code: 'E_CAST' }),
    );
  });
});

describe('QuestlineTranslator', () => {
  it('plans in prose from the arc and the world brief, then builds from the plan', async () => {
    const planPrompts: { system: string; prompt: string }[] = [];
    const plan: LLMPort = {
      complete: async (request) => {
        planPrompts.push(request);
        return `\n${PLAN}\n`;
      },
    };
    const { agent, requests } = scriptedAgent(FULL_BUILD);
    const result = await new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan, build: agent }, ...fixtureDeps() });

    expect(planPrompts).toHaveLength(1);
    expect(planPrompts[0]!.system).toContain('Question yourself');
    expect(planPrompts[0]!.prompt).toContain('owes the wrong lender and wants one favor');
    expect(planPrompts[0]!.prompt).toContain('Static Cafe (coffee shop)');
    expect(planPrompts[0]!.prompt).not.toMatch(/parcelId|districtId/);
    expect(result.plan).toBe(PLAN);
    expect(requests[0]!.prompt).toContain(PLAN);
    expect(result.definition.id).toBe('q_kettle');
  });

  it('throws E_LLM on an empty plan', async () => {
    const plan: LLMPort = { complete: async () => '  ' };
    await expect(
      new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan, build: scriptedAgent(FULL_BUILD).agent }, ...fixtureDeps() }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_LLM' }));
  });
});
