/**
 * Contract-surface tests for quests/builder: the plan closes with a manifest
 * that bounds the build, the scripted agent drafts through the tools and gets
 * feedback, cast resolution by type and by reservation, E_LLM and E_CAST.
 */

import { describe, expect, it } from 'vitest';
import { STEP_KINDS } from '../../flow/schema.js';
import type { AgentPort, AgentReply, AgentTool, AgentToolCall, LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { playableKinds, targetLine } from '../mechanics.js';
import { parsePlanManifest } from '../PlanManifest.js';
import { QuestlineBuilder } from '../QuestlineBuilder.js';
import { QuestlineTranslator } from '../QuestlineTranslator.js';
import type { BuildProgress, QuestAssignment } from '../schema.js';
import { BUILDER_TOOLS } from '../tools.js';

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
  { tool: 'create_questline', input: { id: 'q_kettle', title: 'The Kettle Debt', premise: 'A barista owes the wrong lender.' } },
  { tool: 'add_role', input: { roleId: 'barista', npcType: 'cafe_barista', persona: 'Nervy, in debt.' } },
  { tool: 'add_role', input: { roleId: 'lender', npcType: 'corpo_exec', persona: 'Charges interest in favors.', reservedName: { given: 'Sable', family: 'Quill' } } },
  { tool: 'add_item', input: { itemId: 'ledger', name: 'Debt ledger', description: "Sable's names and numbers.", kind: 'document', atParcelId: 'p7' } },
  { tool: 'add_item', input: { itemId: 'stall', name: 'Which stall hides it', description: 'Mara knows the stall.', kind: 'information' } },
  { tool: 'add_fact', input: { factId: 'f_debt', roleId: 'barista', text: 'I owe Sable more than the cafe earns.', gateFlag: 'knows_debt' } },
  { tool: 'add_fact', input: { factId: 'f_iou', roleId: 'lender', text: 'Debts are memory with interest.' } },
  { tool: 'add_act', input: { actId: 'a1', title: 'The Favor', summary: 'Run the errand.' } },
  { tool: 'add_ending', input: { endingId: 'e_paid', title: 'Paid Off', epilogue: 'The debt dies quietly.' } },
];

const STEP_CALLS: AgentToolCall[] = [
  step({ stepId: 's_ask', actId: 'a1', wantedByRoleId: 'barista', entry: true,
    narrative: { description: 'The barista asks for one quiet favor.', playerHint: 'Talk to the barista at the Static Cafe.', stake: "If the ledger surfaces, the cafe is Sable's by spring." },
    target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' },
    gives: ['stall'], effects: [{ kind: 'setFlag', flag: 'knows_debt' }], next: [{ toStepId: 's_fetch', when: [] }] }),
  step({ stepId: 's_fetch', actId: 'a1', wantedByRoleId: 'barista',
    narrative: { description: 'The ledger sits in a market stall.', playerHint: 'Pick up the ledger.', stake: 'Her name is in it.' },
    target: { kind: 'pickup', itemId: 'ledger' }, needs: ['stall'], next: [{ toStepId: 's_pay', when: [] }] }),
];

const FINAL_STEP = step({ stepId: 's_pay', actId: 'a1', wantedByRoleId: 'lender', endingId: 'e_paid',
  narrative: { description: 'Sable takes the ledger and forgets a name.', playerHint: 'Deliver the ledger to Helix Dynamics Tower.', stake: 'Sable wants the book back more than the debt.' },
  target: { kind: 'deliver', itemId: 'ledger', place: { parcelId: 'p1' } }, needs: ['ledger'], next: [] });

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

function fixtureDeps() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'builder-test', world, types });
  return { world, types, sim };
}

const build = (agent: AgentPort, extra: Partial<Parameters<QuestlineBuilder['build']>[0]> = {}) =>
  new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent, ...fixtureDeps(), ...extra });

const toolResults = (transcript: Parameters<AgentPort['step']>[0]['transcript']) =>
  transcript.filter((turn) => turn.role === 'tool').flatMap((turn) => turn.results.map((result) => result.result));

describe('PlanManifest', () => {
  it('reads the manifest grammar in its bullet form too, ignoring kinds and "none"', () => {
    const manifest = parsePlanManifest('prose\n\n### 5. Manifest\n- **Roles**: `r_a` (barista), r_b\n- Items: none\n- Acts:\n  - a1\n  - a2\n- Endings: e1\n- Steps: s1 (talk); s2 (pickup)\n');
    expect(manifest).toEqual({ roles: ['r_a', 'r_b'], items: [], acts: ['a1', 'a2'], endings: ['e1'], steps: ['s1', 's2'] });
  });
});

describe('QuestlineBuilder', () => {
  it('answers a half-written call and a text-only reply with what is still missing, then finishes', async () => {
    const halfStep = step({ stepId: 's_ask', actId: 'a1', narrative: { description: 'Ask Mara about the ledger.' } });
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: [...SETUP_CALLS, halfStep] },
      { kind: 'done', text: 'I have added everything.' },
      ...FULL_BUILD,
    ]);
    const { definition } = await build(agent);

    expect(toolResults(requests[1]!.transcript)).toContain(
      'error: add_step not accepted: target is missing; next is missing; narrative.playerHint is missing; narrative.stake is missing',
    );
    const turns = requests[2]!.transcript;
    expect(turns[2]).toEqual({ role: 'assistant', text: 'I have added everything.' });
    expect(turns[3]).toMatchObject({
      role: 'user',
      text: expect.stringContaining('Still to add from the plan: steps: s_ask, s_fetch, s_pay; then call finish_questline.'),
    });
    expect(definition.steps).toHaveLength(3);
  });

  it('answers a target or an effect missing a field its kind needs with a tool result, never an abort', async () => {
    const ask = STEP_CALLS[0]!.input as object;
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: [
        ...SETUP_CALLS,
        step({ ...ask, target: { kind: 'listen', atParcelId: 'p4' } }),
        step({ ...ask, target: { kind: 'goto' } }),
        step({ ...ask, effects: [{ kind: 'simFlag', roleId: 'barista' }] }),
      ] },
      { kind: 'calls', calls: [...STEP_CALLS, FINAL_STEP, FINISH] },
    ]);
    const { definition } = await build(agent);

    expect(toolResults(requests[1]!.transcript)).toEqual(expect.arrayContaining([
      'error: step s_ask not added: target.roleIds is missing (listen: roleIds, exactly two different roles; atParcelId.)',
      'error: step s_ask not added: target.place is missing (goto: place.)',
      'error: step s_ask not added: effects[0].op is missing',
    ]));
    expect(definition.steps).toHaveLength(3);
  });

  it('tells a model that resends a refused call word for word, in any key order, that nothing changed', async () => {
    const ask = STEP_CALLS[0]!.input as Record<string, unknown>;
    const bad = step({ ...ask, target: { kind: 'talk', atParcelId: 'p4', roleIds: ['barista', 'lender'] } });
    const reordered = step(Object.fromEntries(Object.entries(bad.input as object).reverse()));
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: [...SETUP_CALLS, bad] },
      { kind: 'calls', calls: [reordered] },
      { kind: 'calls', calls: [...STEP_CALLS, FINAL_STEP, FINISH] },
    ]);
    await build(agent);

    const [first, again] = toolResults(requests[2]!.transcript).filter((result) => result.startsWith('error: step s_ask'));
    expect(first).toBe('error: step s_ask not added: target.roleId is missing (talk: roleId; optional atParcelId, the parcel where the talk happens.)');
    expect(again).toBe(`${first}\nThis exact call was refused before, for the same reason. Sending it again changes nothing: change what the error names, or build another planned piece first.`);
  });

  it('reports E_LLM when the configured build round budget is exhausted', async () => {
    const stuck: AgentPort = { step: async () => ({ kind: 'calls', calls: [] }) };
    await expect(build(stuck, { maxRounds: 1 })).rejects.toMatchObject({ code: 'E_LLM' });
  });

  it('drafts from the plan through the tools, corrects a validation failure from feedback, and resolves the cast', async () => {
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: SETUP_CALLS },
      { kind: 'calls', calls: [
        step({ ...(STEP_CALLS[0]!.input as object), stepId: 'unplanned' }),
        step({ ...(STEP_CALLS[0]!.input as object), target: { kind: 'talk', roleId: 'barista', atParcelId: 'missing' } }),
        ...STEP_CALLS, FINISH,
      ] },
      { kind: 'calls', calls: [FINAL_STEP, FINISH] },
    ]);
    const deps = fixtureDeps();
    const events: BuildProgress[] = [];
    const { definition, cast } = await new QuestlineBuilder().build({
      assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent, progress: (e) => events.push(e), ...deps,
    });

    expect(requests).toHaveLength(3);
    const feedback = toolResults(requests[2]!.transcript).join('\n');
    expect(feedback).toContain('not in the plan');
    expect(feedback).toContain('unknown parcel missing');
    expect(events[0]!.refusals).toEqual([]);
    expect(events[1]!.refusals).toEqual([
      expect.stringContaining('not in the plan'), expect.stringContaining('unknown parcel missing'), expect.stringContaining('not finished'),
    ]);
    expect(events.at(-1)).toMatchObject({
      round: 3,
      committed: MANIFEST.roles.length + MANIFEST.items.length + MANIFEST.acts.length + MANIFEST.endings.length + MANIFEST.steps.length,
    });

    expect(definition.id).toBe('q_kettle');
    expect(definition.flags).toEqual(['knows_debt']);
    expect(definition.steps).toHaveLength(3);
    expect(definition.steps[0]).toMatchObject({ wantedByRoleId: 'barista', gives: ['stall'], needs: [] });
    expect(definition.items.map((i) => i.kind)).toEqual(['document', 'information']);
    expect(deps.sim.getNPC(cast['barista']!).job?.parcelId).toBe('p4');

    const { system, prompt } = requests[0]!;
    expect(system).toContain('Step catalog');
    expect(system).toContain('Artifact catalog');
    expect(prompt).toContain(PLAN);
    expect(prompt).toContain('Mara Vex');
    expect(prompt).toContain('[parcelId p4]');
    expect(prompt).not.toContain('owes the wrong lender and wants one favor');
  });

  it('replaces a planned piece added again under its id, so a problem finish reports is fixed with the tools', async () => {
    const endless = step({ ...(FINAL_STEP.input as object), endingId: undefined });
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: [...SETUP_CALLS, ...STEP_CALLS, endless, FINISH] },
      { kind: 'calls', calls: [FINAL_STEP, FINISH] },
    ]);
    const { definition } = await build(agent);

    expect(toolResults(requests[1]!.transcript)).toContain('error: q_kettle: terminal step s_pay has no ending');
    expect(definition.steps.map((s) => s.stepId)).toEqual(['s_ask', 's_fetch', 's_pay']);
    expect(definition.steps[2]).toMatchObject({ endingId: 'e_paid' });
  });

  it('names every place it commits and moves a story onto a venue that staffs its character', async () => {
    const deps = fixtureDeps();
    // The plan sends the barista to a corporate tower; nobody pours coffee there.
    const atTower = STEP_CALLS.map((call) =>
      (call.input as { stepId: string }).stepId === 's_ask'
        ? step({ ...(call.input as object), target: { kind: 'talk', roleId: 'barista', atParcelId: 'p1' } })
        : call,
    );
    const { definition } = await new QuestlineBuilder().build({
      assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, ...deps,
      agent: scriptedAgent([{ kind: 'calls', calls: [...SETUP_CALLS, ...atTower, FINAL_STEP, FINISH] }]).agent,
    });

    const ask = definition.steps.find((entry) => entry.stepId === 's_ask')!;
    expect(ask.target).toEqual({ kind: 'talk', roleId: 'barista', atParcelId: 'p4' });
    const pay = definition.steps.find((entry) => entry.stepId === 's_pay')!;
    expect(pay.target).toMatchObject({ place: { parcelId: 'p1', name: 'Helix Dynamics Tower' } });
  });

  it('casts a character from the post the story names at the hour it names', async () => {
    const deps = fixtureDeps();
    const lastCall = STEP_CALLS.map((call) =>
      (call.input as { stepId: string }).stepId === 's_ask'
        ? step({
            ...(call.input as object),
            narrative: {
              description: 'The barista talks once the counter empties.',
              playerHint: 'Talk to the barista during the slow hour.',
              stake: "If the ledger surfaces, the cafe is Sable's by spring.",
            },
          })
        : call,
    );
    const { definition, cast } = await new QuestlineBuilder().build({
      assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, ...deps,
      agent: scriptedAgent([{ kind: 'calls', calls: [...SETUP_CALLS, ...lastCall, FINAL_STEP, FINISH] }]).agent,
    });

    const ask = definition.steps.find((entry) => entry.stepId === 's_ask')!;
    expect(ask.window).toEqual({ label: 'slow hour', days: [0, 1, 2, 3, 4, 5, 6], startMin: 960, endMin: 1410 });
    const barista = deps.sim.getNPC(cast['barista']!);
    expect(barista.job).toMatchObject({ parcelId: 'p4', role: 'barista', shift: { kind: 'evening' } });
    // The hour the hint promises is an hour she is really behind the counter.
    expect(deps.sim.behaviorAt(barista.npcId, ask.window!.startMin + 60)).toMatchObject({
      activity: 'working', place: { kind: 'parcel', id: 'p4' },
    });
  });

  it('casts a reserved character once across questlines, anyone of the type otherwise, and throws E_CAST for nobody', async () => {
    const deps = fixtureDeps();
    const first = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent: scriptedAgent(FULL_BUILD).agent, ...deps });
    const second = await new QuestlineBuilder().build({ assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, agent: scriptedAgent(FULL_BUILD).agent, ...deps });
    expect(second.cast['lender']).toBe(first.cast['lender']);
    expect(deps.sim.getNPC(first.cast['barista']!).type).toBe('cafe_barista');
    expect(deps.sim.getNPC(first.cast['lender']!).name).toEqual({ given: 'Sable', family: 'Quill' });

    // A resident type is never on duty anywhere, so the vendor query cannot serve it.
    const neighbour = deps.sim.reserveNPC({ name: { given: 'Ada', family: 'Renn' }, type: 'sump_resident' });
    const resident = SETUP_CALLS.map((call) =>
      call.tool === 'add_role' && (call.input as { roleId: string }).roleId === 'lender'
        ? { tool: 'add_role', input: { roleId: 'lender', npcType: 'sump_resident', persona: 'Keeps every debt in her head.' } }
        : call,
    );
    const { cast } = await new QuestlineBuilder().build({
      assignment: ASSIGNMENT, plan: PLAN, manifest: MANIFEST, ...deps,
      agent: scriptedAgent([{ kind: 'calls', calls: [...resident, ...STEP_CALLS, FINAL_STEP, FINISH] }]).agent,
    });
    expect(cast['lender']).toBe(neighbour.npcId);

    const ghostManifest = parsePlanManifest('## Manifest\nroles: ghost\nitems: none\nacts: a1\nendings: e\nsteps: s1');
    const ghost = scriptedAgent([{ kind: 'calls', calls: [
      { tool: 'create_questline', input: { id: 'q_ghost', title: 'Ghost', premise: 'Nobody staffs this.' } },
      { tool: 'add_role', input: { roleId: 'ghost', npcType: 'sump_resident', persona: 'Stays home.' } },
      { tool: 'add_act', input: { actId: 'a1', title: 'a', summary: 's' } },
      { tool: 'add_ending', input: { endingId: 'e', title: 'e', epilogue: 'done' } },
      step({
        narrative: { description: 'Ask around the Sump.', playerHint: 'Talk to a resident.', stake: 'Someone has to ask.' },
        stepId: 's1', actId: 'a1', target: { kind: 'talk', roleId: 'ghost' }, next: [], endingId: 'e', entry: true,
      }),
      FINISH,
    ] }]);
    await expect(build(ghost.agent, { manifest: ghostManifest })).rejects.toThrowError(expect.objectContaining({ code: 'E_CAST' }));
  });
});

describe('QuestlineTranslator', () => {

  it('plans in prose from the arc and the world brief, builds from the plan, and repairs a missing manifest once', async () => {
    const plan = planPort([`\n${PLAN}\n`]);
    const { agent, requests } = scriptedAgent(FULL_BUILD);
    const result = await new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan: plan.port, build: agent }, ...fixtureDeps() });

    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]!.system).toContain('Write the plan in these sections');
    expect(plan.prompts[0]!.system).toContain('## Manifest');
    expect(plan.prompts[0]!.prompt).toContain('owes the wrong lender and wants one favor');
    expect(plan.prompts[0]!.prompt).toContain('Static Cafe (coffee shop)');
    expect(plan.prompts[0]!.prompt).not.toMatch(/parcelId|districtId/);
    expect(plan.prompts[0]!.system).toContain('# Step catalog');
    expect(result.plan).toBe(PLAN);
    expect(requests[0]!.prompt).toContain(PLAN);
    expect(result.definition.id).toBe('q_kettle');

    const repaired = planPort(['Plan without the closing section.', PLAN]);
    const second = await new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan: repaired.port, build: scriptedAgent(FULL_BUILD).agent }, ...fixtureDeps() });
    expect(repaired.prompts).toHaveLength(2);
    expect(repaired.prompts[1]!.prompt).toContain('- no "## Manifest" section at the end of the plan');
    expect(second.plan).toBe(PLAN);

    const hopeless = planPort(['no manifest', '## Manifest\nroles: The Barista\nitems: none\nacts: a1\nendings: e1\nsteps: s1']);
    await expect(
      new QuestlineTranslator().translate({ assignment: ASSIGNMENT, ports: { plan: hopeless.port, build: scriptedAgent(FULL_BUILD).agent }, ...fixtureDeps() }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ problems: ['roles entry "The Barista" is not a machine id (letters, digits, underscores)'] }) }),
    );
  });
});

describe('mechanic allowlist', () => {
  const PLAYABLE = ['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work'] as const;
  type Schema = { properties: Record<string, Schema>; description?: string; enum?: string[] };
  const targetSchema = (tools: AgentTool[]) => (tools.find((tool) => tool.name === 'add_step')!.inputSchema as Schema).properties['target']!;

  it('shows the planner and the builder only the playable kinds, and refuses a step of another kind by name', async () => {
    const plan = planPort([PLAN]);
    const hack = step({ ...(STEP_CALLS[0]!.input as object), target: { kind: 'hacking', targetId: 'till', place: { parcelId: 'p4' }, completionFlag: 'hacked' } });
    const { agent, requests } = scriptedAgent([
      { kind: 'calls', calls: [...SETUP_CALLS, hack] },
      { kind: 'calls', calls: [...STEP_CALLS, FINAL_STEP, FINISH] },
    ]);
    const { definition } = await new QuestlineTranslator().translate({
      assignment: ASSIGNMENT, ports: { plan: plan.port, build: agent }, mechanics: PLAYABLE, ...fixtureDeps(),
    });

    const planner = plan.prompts[0]!.system;
    expect(planner).toContain(`Each step is one of: ${PLAYABLE.join(', ')}.`);
    expect(planner).toContain('## steal (take what a person guards)');
    expect(planner).not.toMatch(/## (assassinate|investigation|rescue|escort|access|hacking|sabotage|transportation)\b/);

    const { system, tools } = requests[0]!;
    expect(system).not.toContain('## hacking');
    expect(system).toContain('(a talk, listen or observe step)');
    const target = targetSchema(tools);
    expect(target.properties['kind']!.enum).toEqual(PLAYABLE);
    expect(Object.keys(target.properties)).not.toContain('completionFlag');
    expect(target.description).toContain('- work: atParcelId, role');
    expect(target.description).not.toMatch(/- hacking:|completionFlag/);

    expect(toolResults(requests[1]!.transcript)).toContain(`error: step kind hacking is not playable here; use one of ${PLAYABLE.join(', ')}`);
    expect(definition.steps.map((entry) => entry.target.kind)).toEqual(['talk', 'pickup', 'deliver']);
  });

  it('offers every kind without an allowlist, and an allowlist naming no real kind is a caller error', () => {
    const target = targetSchema(BUILDER_TOOLS);
    expect(target.properties['kind']!.enum).toEqual(STEP_KINDS);
    expect(STEP_KINDS).toHaveLength(16);
    expect(target.description).toContain('- transportation: journeyId');
    expect(target.description).toContain('Each completionFlag must be set by a setFlag');
    expect(() => playableKinds(['goto', 'teleport'])).toThrowError(/unknown step kind teleport/);
    expect(() => playableKinds([])).toThrowError(/names no step kind/);
    expect(playableKinds(['work', 'goto'])).toEqual(['goto', 'work']);
    for (const kind of STEP_KINDS) expect(targetLine(kind)).toMatch(new RegExp(`^${kind}: \\w`));
  });
});
