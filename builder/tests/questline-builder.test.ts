/**
 * Contract-surface tests for quests/builder: the scripted agent drafts through
 * the tools, gets validation feedback, finishes; cast resolution by type and
 * by reservation; E_LLM and E_CAST paths.
 */

import { describe, expect, it } from 'vitest';
import type { AgentPort, AgentReply, AgentToolCall } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineBuilder } from '../QuestlineBuilder.js';

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
  { tool: 'add_item', input: { itemId: 'ledger', name: 'Debt ledger', description: 'Names and numbers.', atParcelId: 'p7' } },
  { tool: 'add_fact', input: { factId: 'f_debt', roleId: 'barista', text: 'I owe Sable more than the cafe earns.', gateFlag: 'knows_debt' } },
  { tool: 'add_fact', input: { factId: 'f_iou', roleId: 'lender', text: 'Debts are memory with interest. I never forget either.' } },
  { tool: 'add_act', input: { actId: 'a1', title: 'The Favor', summary: 'Run the errand.' } },
  { tool: 'add_ending', input: { endingId: 'e_paid', title: 'Paid Off', epilogue: 'The debt dies quietly.' } },
];

const STEP_CALLS: AgentToolCall[] = [
  step({
    narrative: { description: 'The barista asks for one quiet favor.', playerHint: 'Talk to the barista at the Static Cafe.' },
    stepId: 's_ask',
    actId: 'a1',
    target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' },
    effects: [{ kind: 'setFlag', flag: 'knows_debt' }],
    next: [{ toStepId: 's_fetch', when: [] }],
    entry: true,
  }),
  step({
    narrative: { description: 'The ledger sits in a market stall.', playerHint: 'Pick up the ledger.' },
    stepId: 's_fetch',
    actId: 'a1',
    target: { kind: 'pickup', itemId: 'ledger' },
    next: [{ toStepId: 's_pay', when: [] }],
  }),
];

const FINAL_STEP = step({
  narrative: { description: 'Sable takes the ledger and forgets a name.', playerHint: 'Deliver the ledger to Helix Dynamics Tower.' },
  stepId: 's_pay',
  actId: 'a1',
  target: { kind: 'deliver', itemId: 'ledger', place: { parcelId: 'p1' } },
  next: [],
  endingId: 'e_paid',
});

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
  it('drafts through the tools, corrects a validation failure from feedback, and resolves the cast', async () => {
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: SETUP_CALLS },
      { kind: 'calls', calls: [...STEP_CALLS, { tool: 'finish_questline', input: {} }] },
      { kind: 'calls', calls: [FINAL_STEP, { tool: 'finish_questline', input: {} }] },
    ]);
    const deps = fixtureDeps();
    const { definition, cast } = await new QuestlineBuilder().build({
      premise: { title: 'The Kettle Debt', premise: 'A barista owes the wrong lender and wants one favor run quietly.' },
      agent,
      ...deps,
    });

    expect(requests).toHaveLength(3);
    const toolTurns = requests[2]!.transcript.filter((t) => t.role === 'tool');
    expect(toolTurns.some((t) => t.results.some((r) => r.result.includes('error:')))).toBe(true);

    expect(definition.id).toBe('q_kettle');
    expect(definition.flags).toEqual(['knows_debt']);
    expect(definition.steps).toHaveLength(3);
    expect(deps.sim.getNPC(cast['barista']!).type).toBe('cafe_barista');
    expect(deps.sim.getNPC(cast['barista']!).job?.parcelId).toBe('p4');
    expect(deps.sim.getNPC(cast['lender']!).name).toEqual({ given: 'Sable', family: 'Quill' });

    expect(requests[0]!.system).toContain('Step catalog');
    expect(requests[0]!.prompt).toContain('[parcelId p4]');
  });

  it('throws E_LLM when the agent stops without finishing', async () => {
    const { agent } = scriptedAgent([{ kind: 'done', text: 'I refuse.' }]);
    await expect(
      new QuestlineBuilder().build({ premise: { title: 'x', premise: 'y' }, agent, ...fixtureDeps() }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_LLM' }));
  });

  it('throws E_LLM when the round budget runs out', async () => {
    const { agent } = scriptedAgent([
      { kind: 'calls', calls: [{ tool: 'create_questline', input: { id: 'q', title: 't', premise: 'p' } }] },
      { kind: 'calls', calls: [{ tool: 'add_act', input: { actId: 'a1', title: 't', summary: 's' } }] },
    ]);
    await expect(
      new QuestlineBuilder().build({ premise: { title: 'x', premise: 'y' }, agent, maxRounds: 2, ...fixtureDeps() }),
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
            narrative: { description: 'Ask around the Sump.', playerHint: 'Talk to a resident.' },
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
    await expect(
      new QuestlineBuilder().build({ premise: { title: 'x', premise: 'y' }, agent, ...fixtureDeps() }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_CAST' }));
  });
});
