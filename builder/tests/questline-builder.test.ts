/**
 * Contract-surface tests for quests/builder: the plan closes with a manifest
 * that bounds the build (planned ids only, missing pieces reported, round
 * budget from the plan's size, progress per round); the scripted agent drafts
 * through the tools, gets feedback, finishes; cast resolution by type and by
 * reservation (shared across questlines); the translator's plan pass with its
 * manifest repair round; E_LLM and E_CAST paths.
 */

import { describe, expect, it } from 'vitest';
import type { AgentPort, AgentReply, AgentToolCall, LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { parsePlanManifest } from '../PlanManifest.js';
import { ToolDispatcher } from '../ToolDispatcher.js';
import { QuestlineDraft } from '../QuestlineDraft.js';
import { QuestlineBuilder } from '../QuestlineBuilder.js';
import { QuestlineTranslator } from '../QuestlineTranslator.js';
import type { BuildProgress, QuestAssignment } from '../schema.js';

const ASSIGNMENT: QuestAssignment = {
  title: 'The Kettle Debt',
  synopsis: 'A city where the water bill is paid in names.',
  characters: 'Mara Vex\nRole: a barista at the Static Cafe\nVoice: dry. "Coffee is free if you are paying with bad news."',
  arc: 'Presentation\nA barista owes the wrong lender and wants one favor run quietly.',
};
const PLAN = `Plan: cast Mara as cafe_barista; the ledger is a document at the Grey Market; one act, one ending.

## Manifest
roles: barista, lender
items: ledger (document), stall (information)
acts: a1
endings: e_paid
steps: s_ask (talk), s_fetch (pickup), s_pay (deliver)`;
const MANIFEST = parsePlanManifest(PLAN);

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

const FINISH: AgentToolCall = { tool: 'finish_questline', input: {} };
const FULL_BUILD: AgentReply[] = [{ kind: 'calls', calls: [...SETUP_CALLS, ...STEP_CALLS, FINAL_STEP, FINISH] }];

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

const build = (agent: AgentPort, extra: Partial<Parameters<QuestlineBuilder['build']>[0]> = {}) =>
  new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent, ...fixtureDeps(), ...extra });

describe('PlanManifest', () => {
  it('reads the manifest grammar in its bullet form too, ignoring kinds and "none"', () => {
    const manifest = parsePlanManifest('prose\n\n### 5. Manifest\n- **Roles**: `r_a` (barista), r_b\n- Items: none\n- Acts:\n  - a1\n  - a2\n- Endings: e1\n- Steps: s1 (talk); s2 (pickup)\n');
    expect(manifest).toEqual({ roles: ['r_a', 'r_b'], items: [], acts: ['a1', 'a2'], endings: ['e1'], steps: ['s1', 's2'] });
  });
});

describe('QuestlineDraft through the tools', () => {
  it('accepts only the ids the plan lists and names the planned ones', () => {
    const dispatcher = new ToolDispatcher(new QuestlineDraft(MANIFEST));
    for (const call of SETUP_CALLS) dispatcher.dispatch(call);
    const extra = dispatcher.dispatch(step({ ...(STEP_CALLS[0]!.input as object), stepId: 's_extra' }));
    expect(extra.result).toMatch(/^error: step s_extra is not in the plan; planned steps: s_ask, s_fetch, s_pay; not yet added: s_ask, s_fetch, s_pay/);
    expect(dispatcher.dispatch(STEP_CALLS[0]!).result).toBe('step s_ask added (entry); 7 of 9 planned pieces in');
  });

  it('refuses a step with every bad reference at once', () => {
    const dispatcher = new ToolDispatcher(new QuestlineDraft(MANIFEST));
    for (const call of SETUP_CALLS) dispatcher.dispatch(call);
    const { result } = dispatcher.dispatch(step({ ...(STEP_CALLS[1]!.input as object), actId: 'a9', needs: ['ghost'] }));
    expect(result).toContain('unknown act a9 (planned acts: a1)');
    expect(result).toContain('unknown item ghost (planned items: ledger, stall)');
  });

  it('finish reports the planned pieces still missing before validating', () => {
    const dispatcher = new ToolDispatcher(new QuestlineDraft(MANIFEST));
    for (const call of [...SETUP_CALLS, ...STEP_CALLS]) dispatcher.dispatch(call);
    expect(dispatcher.dispatch(FINISH).result).toBe('error: not finished; still to add from the plan: steps: s_pay; then call finish_questline again');
  });
});

describe('QuestlineBuilder', () => {
  it('answers a text-only reply with a nudge that names what is missing, and goes on', async () => {
    const { agent, requests } = scriptedAgent([{ kind: 'done', text: 'I have added everything.' }, ...FULL_BUILD]);
    const { definition } = await build(agent);

    expect(definition.steps).toHaveLength(3);
    expect(requests).toHaveLength(2);
    const turns = requests[1]!.transcript;
    expect(turns[0]).toEqual({ role: 'assistant', text: 'I have added everything.' });
    expect(turns[1]?.role).toBe('user');
    const nudge = 'text' in turns[1]! ? turns[1].text : '';
    expect(nudge).toContain('Still to add from the plan: roles: barista, lender; items: ledger, stall; acts: a1; endings: e_paid; steps: s_ask, s_fetch, s_pay; then call finish_questline.');
  });

  it('gives up after three text-only replies', async () => {
    await expect(build(scriptedAgent([]).agent)).rejects.toThrow(/without finishing The Kettle Debt: 0 of 9 planned pieces in/);
  });

  it('bounds the rounds by the plan: two per planned piece plus eight', async () => {
    const stuck: AgentPort = { step: async () => ({ kind: 'calls', calls: [SETUP_CALLS[0]!] }) };
    const events: BuildProgress[] = [];
    await expect(build(stuck, { progress: (e) => events.push(e) })).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', message: expect.stringContaining('within 26 rounds: 0 of 9 planned pieces in') }),
    );
    expect(events).toHaveLength(26);
    expect(events[1]).toEqual({ title: 'The Kettle Debt', round: 2, maxRounds: 26, committed: 0, planned: 9, note: 'create_questline (1 refused)' });
  });

  it('drafts from the plan through the tools, corrects a validation failure from feedback, and resolves the cast', async () => {
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: SETUP_CALLS },
      { kind: 'calls', calls: [...STEP_CALLS, FINISH] },
      { kind: 'calls', calls: [FINAL_STEP, FINISH] },
    ]);
    const deps = fixtureDeps();
    const events: BuildProgress[] = [];
    const { definition, cast } = await new QuestlineBuilder().build({
      assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent, progress: (e) => events.push(e), ...deps,
    });

    expect(requests).toHaveLength(3);
    const toolTurns = requests[2]!.transcript.filter((t) => t.role === 'tool');
    expect(toolTurns.some((t) => t.results.some((r) => r.result.includes('error:')))).toBe(true);
    expect(events.map((e) => [e.round, e.committed, e.note])).toEqual([
      [1, 6, 'create_questline, add_role, add_role, add_item, add_item, add_fact, add_fact, add_act, add_ending'],
      [2, 8, 'add_step, add_step, finish_questline (1 refused)'],
      [3, 9, 'add_step, finish_questline'],
    ]);

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
    const first = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent: scriptedAgent(FULL_BUILD).agent, ...deps });
    const second = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent: scriptedAgent(FULL_BUILD).agent, ...deps });
    expect(second.cast['lender']).toBe(first.cast['lender']);
  });

  it('throws E_CAST when a role type has no castable NPC', async () => {
    const manifest = parsePlanManifest('## Manifest\nroles: ghost\nitems: none\nacts: a1\nendings: e\nsteps: s1');
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
          FINISH,
        ],
      },
    ]);
    await expect(build(agent, { manifest })).rejects.toThrowError(expect.objectContaining({ code: 'E_CAST' }));
  });
});

describe('QuestlineTranslator', () => {
  function planPort(answers: string[]) {
    const prompts: { system: string; prompt: string }[] = [];
    const queue = [...answers];
    const port: LLMPort = {
      complete: async (request) => {
        prompts.push(request);
        return queue.shift() ?? '';
      },
    };
    return { port, prompts };
  }

  it('plans in prose from the arc and the world brief, then builds from the plan', async () => {
    const plan = planPort([`\n${PLAN}\n`]);
    const { agent, requests } = scriptedAgent(FULL_BUILD);
    const result = await new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan: plan.port, build: agent }, ...fixtureDeps() });

    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]!.system).toContain('Question yourself');
    expect(plan.prompts[0]!.system).toContain('## Manifest');
    expect(plan.prompts[0]!.prompt).toContain('owes the wrong lender and wants one favor');
    expect(plan.prompts[0]!.prompt).toContain('Static Cafe (coffee shop)');
    expect(plan.prompts[0]!.prompt).not.toMatch(/parcelId|districtId/);
    expect(result.plan).toBe(PLAN);
    expect(requests[0]!.prompt).toContain(PLAN);
    expect(result.definition.id).toBe('q_kettle');
  });

  it('repairs a plan without a usable manifest once, then fails with E_LLM', async () => {
    const repaired = planPort(['Plan without the closing section.', PLAN]);
    const result = await new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan: repaired.port, build: scriptedAgent(FULL_BUILD).agent }, ...fixtureDeps() });
    expect(repaired.prompts).toHaveLength(2);
    expect(repaired.prompts[1]!.prompt).toContain('- no "## Manifest" section at the end of the plan');
    expect(result.plan).toBe(PLAN);

    const hopeless = planPort(['no manifest', '## Manifest\nroles: The Barista\nitems: none\nacts: a1\nendings: e1\nsteps: s1']);
    await expect(
      new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan: hopeless.port, build: scriptedAgent(FULL_BUILD).agent }, ...fixtureDeps() }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ problems: ['roles entry "The Barista" is not a machine id (letters, digits, underscores)'] }) }),
    );
  });
});
