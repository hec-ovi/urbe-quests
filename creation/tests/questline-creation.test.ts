/**
 * Contract-surface test for quests/creation: one prompt runs script, main
 * translation, situations and side translations against fixture story text
 * and a scripted build agent; no model needed. Plus the E_LLM path.
 */

import { describe, expect, it } from 'vitest';
import type { AgentPort, AgentToolCall, LLMPort } from '../../ports/llm.js';
import type { CreationProgress } from '../schema.js';
import { loadFixtureStory } from '../../story/fixtures.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';

const FIXTURE = loadFixtureStory('cyberpunk');

function textPort(responses: string[]) {
  const calls: { system: string; prompt: string }[] = [];
  const queue = [...responses];
  const port: LLMPort = {
    complete: async (request) => {
      calls.push(request);
      return queue.shift() ?? '';
    },
  };
  return { port, calls };
}

/** Plans by echoing the assignment title, so every build can be traced to its arc; the manifest matches the scripted build. */
function planPort() {
  const calls: { system: string; prompt: string }[] = [];
  const port: LLMPort = {
    complete: async (request) => {
      calls.push(request);
      const title = /^Title: (.+)$/m.exec(request.prompt)?.[1] ?? 'untitled';
      return `Plan for ${title}: the barista tells where the chip is; the chip is picked up.\n\n## Manifest\nroles: barista\nitems: tip (information), chip (device)\nacts: a1\nendings: e1\nsteps: s1 (talk), s2 (pickup)`;
    },
  };
  return { port, calls };
}

/** Builds the same two-step questline for whatever assignment arrives, in one round. */
function buildAgent() {
  const requests: Parameters<AgentPort['step']>[0][] = [];
  let count = 0;
  const port: AgentPort = {
    step: async (request) => {
      requests.push(request);
      const id = `q_${++count}`;
      const calls: AgentToolCall[] = [
        { tool: 'create_questline', input: { id, title: id, premise: 'A tip, then a chip.' } },
        { tool: 'add_role', input: { roleId: 'barista', npcType: 'cafe_barista', persona: 'Dry, short.' } },
        { tool: 'add_item', input: { itemId: 'tip', name: 'Where the chip is', description: 'Mara knows the stall.', kind: 'information' } },
        { tool: 'add_item', input: { itemId: 'chip', name: 'Data chip', description: 'Her brother\'s last night.', kind: 'device', atParcelId: 'p7' } },
        { tool: 'add_act', input: { actId: 'a1', title: 'Act', summary: 'One act.' } },
        { tool: 'add_ending', input: { endingId: 'e1', title: 'Done', epilogue: 'The chip changes hands.' } },
        {
          tool: 'add_step',
          input: {
            narrative: { description: 'Ask Mara.', playerHint: 'Talk to the barista.', stake: 'Nobody else asks.' },
            wantedByRoleId: 'barista',
            stepId: 's1',
            actId: 'a1',
            target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' },
            gives: ['tip'],
            next: [{ toStepId: 's2', when: [] }],
            entry: true,
          },
        },
        {
          tool: 'add_step',
          input: {
            narrative: { description: 'Find the chip.', playerHint: 'Pick up the chip.', stake: 'Without it her word is a rumor.' },
            wantedByRoleId: 'barista',
            stepId: 's2',
            actId: 'a1',
            target: { kind: 'pickup', itemId: 'chip' },
            needs: ['tip'],
            next: [],
            endingId: 'e1',
          },
        },
        { tool: 'finish_questline', input: {} },
      ];
      return { kind: 'calls', calls };
    },
  };
  return { port, requests };
}

function setup(scriptResponses: string[]) {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'creation-test', world, types });
  const script = textPort(scriptResponses);
  const situations = textPort([FIXTURE.situations]);
  const plan = planPort();
  const build = buildAgent();
  const ports = { script: script.port, situations: situations.port, plan: plan.port, build: build.port };
  return { world, types, sim, ports, script, situations, plan, build };
}

describe('QuestlineCreation', () => {
  it('runs script, main translation, situations and side translations from one prompt', async () => {
    const deps = setup([FIXTURE.script]);
    const events: CreationProgress[] = [];
    const result = await new QuestlineCreation().run({
      prompt: 'create a dark cynical sci fi cyberpunk story',
      world: deps.world,
      types: deps.types,
      sim: deps.sim,
      ports: deps.ports,
      progress: (event) => events.push(event),
    });

    expect(deps.script.calls[0]!.prompt).toContain('Creation prompt:\ncreate a dark cynical sci fi cyberpunk story');
    expect(result.script.script.title).toBe('The Water Bill');
    expect(result.situations.situations).toHaveLength(3);

    expect(deps.plan.calls).toHaveLength(4);
    const mainPlan = deps.plan.calls.find((c) => c.prompt.includes('Title: The Water Bill'))!;
    expect(mainPlan.prompt).toContain('### Rain on the Static Cafe'.slice(4));
    expect(mainPlan.prompt).toContain('Voice: Polished, sentences that end in questions');
    const farePlan = deps.plan.calls.find((c) => c.prompt.includes('Title: The Last Fare'))!;
    expect(farePlan.prompt).toContain('Rue\nRole: the night bus driver');
    expect(farePlan.prompt).toContain('Voice: Quiet, literal, remembers times exactly');
    expect(farePlan.prompt).toContain('orbits it without resolving it');

    expect(deps.build.requests).toHaveLength(4);
    const mainBuild = deps.build.requests.find((r) => r.prompt.includes('Plan for The Water Bill'))!;
    expect(mainBuild.prompt).toContain('[parcelId p4]');
    expect(mainBuild.prompt).not.toContain('Rain on the Static Cafe');

    expect(result.main.plan).toContain('Plan for The Water Bill');
    expect(result.main.definition.items.map((i) => i.kind)).toEqual(['information', 'device']);
    expect(result.main.definition.steps[1]).toMatchObject({ needs: ['tip'], wantedByRoleId: 'barista' });
    expect(deps.sim.getNPC(result.main.cast['barista']!).type).toBe('cafe_barista');
    expect(result.side.map((s) => s.situationId)).toEqual(['sit_1', 'sit_2', 'sit_3']);
    expect(result.side.map((s) => s.plan)).toEqual([
      expect.stringContaining('The Last Fare'),
      expect.stringContaining("Doc Sanna's Supply Run"),
      expect.stringContaining('Noodle Saint After Hours'),
    ]);

    expect(events[0]?.kind).toBe('script');
    expect(events.filter((e) => e.kind === 'build').map((e) => e.kind === 'build' && e.build.committed)).toEqual([7, 7, 7, 7]);
    expect(events.filter((e) => e.kind === 'questline').map((e) => e.kind === 'questline' && e.questline).sort()).toEqual(['main', 'sit_1', 'sit_2', 'sit_3']);
  });

  it('fails with E_LLM when the script is unusable, before any translation starts', async () => {
    const deps = setup(['no script', 'still no script']);
    await expect(
      new QuestlineCreation().run({ prompt: 'anything', world: deps.world, types: deps.types, sim: deps.sim, ports: deps.ports }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_LLM' }));
    expect(deps.plan.calls).toHaveLength(0);
    expect(deps.situations.calls).toHaveLength(0);
  });
});
