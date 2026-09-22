/**
 * Contract-surface tests for quests/dialog: layer order and sharing, closed
 * knowledge with flag gating, tiered memory, death, persistence, and the reply.
 */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { QuestlineRuntime } from '../../flow/QuestlineRuntime.js';
import { Converse } from '../Converse.js';
import { DialogContextService } from '../DialogContextService.js';
import type { DialogContext } from '../schema.js';

const TUE_10 = 1 * 1440 + 600;

const DEF: QuestlineDefinition = {
  id: 'q_rumor',
  title: 'The Rumor Mill',
  premise: 'A barista trades in rumors; one of them is dangerous.',
  roles: [
    { roleId: 'informer', npcType: 'cafe_barista', persona: 'Collects rumors like tips.' },
    { roleId: 'buyer', npcType: 'corpo_exec', persona: 'Pays for silence.', reservedName: { given: 'Vela', family: 'Marsh' } },
  ],
  items: [],
  facts: [
    { factId: 'f_open', roleId: 'informer', text: 'The Arcade cameras have been dark for a week.' },
    { factId: 'f_secret', roleId: 'informer', text: 'Helix pays someone at Precinct 9 in clinic credit.', gateFlag: 'trusted' },
    { factId: 'f_buyer', roleId: 'buyer', text: 'I bought the precinct list twice already.' },
  ],
  acts: [{ actId: 'a1', title: 'Coffee', summary: 'Earn trust.' }],
  steps: [{
    stepId: 's_talk', actId: 'a1', wantedByRoleId: 'informer', endingId: 'e_done',
    narrative: {
      description: 'Small talk first.',
      playerHint: 'Talk to the barista at the Static Cafe.',
      stake: 'She needs someone to carry the precinct rumor out before it carries her.',
    },
    target: { kind: 'talk', roleId: 'informer', atParcelId: 'p4' },
    gives: [], needs: [], conditions: [], next: [], branching: 'parallel',
    effects: [{ kind: 'setFlag', flag: 'trusted' }],
  }],
  endings: [{ endingId: 'e_done', title: 'In Confidence', epilogue: 'The rumor changes hands.' }],
  flags: ['trusted'],
  entryStepIds: ['s_talk'],
};

function setup(memory?: { tailSize: number; foldSize: number }) {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'dialog-test', world, types });
  const informer = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const buyer = sim.reserveNPC({ name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' });
  const llmCalls: string[] = [];
  const llm: LLMPort = {
    complete: async ({ prompt }) => {
      llmCalls.push(prompt);
      return 'They talked about the dark cameras; the barista stayed wary.';
    },
  };
  const service = new DialogContextService({ world, types, sim, llm, ...(memory ? { memory } : {}) });
  const runtime = new QuestlineRuntime(DEF, { informer: informer.npcId, buyer: buyer.npcId }, sim);
  service.attachQuestline(runtime);
  return { sim, service, runtime, informerId: informer.npcId, buyerId: buyer.npcId, llmCalls };
}

describe('DialogContextService', () => {
  it('layers context in cache order with shared world and type segments and the closed knowledge scope', () => {
    const { service, informerId, buyerId } = setup();
    const context = service.contextFor(informerId, TUE_10);

    expect(context.segments.map((s) => s.id)).toEqual(['world', 'type', 'npc', 'quest', 'turns']);
    expect(context.segments.filter((s) => s.shared).map((s) => s.id)).toEqual(['world', 'type']);

    const [world, type, npc, quest, turns] = context.segments;
    expect(world!.text).toContain('deflect in character');
    expect(world!.text).toContain('Crown Spire');
    expect(type!.text).toContain('neon-lit cafe');
    expect(npc!.text).toMatch(/You are .+ .+\./);
    expect(npc!.text).toContain('You work at Static Cafe in Kanaal Market');
    expect(npc!.text).toContain('Collects rumors like tips.');
    expect(quest!.text).toContain('The Arcade cameras have been dark');
    expect(turns!.text).toContain('It is Tuesday 10:00');

    const all = context.segments.map((s) => s.text).join('\n');
    expect(all).not.toContain('Helix pays someone at Precinct 9');
    expect(all).not.toContain('I bought the precinct list');

    expect(service.contextFor(buyerId, TUE_10).segments[0]!.text).toBe(world!.text);
  });

  it("carries the giver's want, then unlocks the gated fact and the epilogue the questline reached", () => {
    const { service, runtime, informerId, buyerId } = setup();
    const quest = (npcId: string) => service.contextFor(npcId, TUE_10).segments.find((s) => s.id === 'quest')?.text ?? '';
    expect(quest(informerId)).toContain('What you want from the player right now');
    expect(quest(informerId)).toContain('carry the precinct rumor out');
    expect(quest(buyerId)).not.toContain('carry the precinct rumor out');

    runtime.advance({ kind: 'talkedTo', npcId: informerId }, TUE_10);
    expect(quest(informerId)).not.toContain('What you want from the player');
    expect(quest(informerId)).toContain('Helix pays someone at Precinct 9');
    expect(quest(informerId)).toContain('How it ended, as you lived it:\n- The rumor changes hands.');
    expect(quest(buyerId)).toContain('The rumor changes hands.');
  });

  it('replaces a questline attached again under the same id instead of stacking it', () => {
    const { service, runtime, informerId, sim } = setup();
    service.attachQuestline(QuestlineRuntime.restore(runtime.def, runtime.cast, sim, runtime.serialize()));
    const quest = service.contextFor(informerId, TUE_10).segments.find((s) => s.id === 'quest');
    const wants = quest?.text.split('\n').filter((line) => line.startsWith('- ')) ?? [];
    expect(wants.length).toBe(new Set(wants).size);
  });

  it('uses the authored character name in context and replies without changing the cast or bystanders', async () => {
    const { service, runtime, informerId, sim } = setup();
    const definition = structuredClone(runtime.def);
    definition.roles[0]!.characterName = { given: 'Petra', family: 'Moss' };
    definition.roles[0]!.persona = 'Petra keeps her brother’s shift logs and wants his case heard.';
    service.attachQuestline(new QuestlineRuntime(definition, runtime.cast, sim));
    const original = structuredClone(sim.getNPC(informerId));
    const bystander = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 + 8 * 60 });

    const context = service.contextFor(informerId, TUE_10);
    const identity = context.segments.find((segment) => segment.id === 'npc')!.text;
    expect(context.npcId).toBe(informerId);
    expect(context.characterName).toEqual({ given: 'Petra', family: 'Moss' });
    expect(identity).toContain('You are Petra Moss.');
    expect(identity).toContain('Your name is Petra Moss.');
    expect(identity).toContain('Petra keeps her brother’s shift logs');
    expect(identity).not.toContain(`You are ${original.name.given} ${original.name.family}.`);
    expect(sim.getNPC(informerId)).toEqual(original);

    const other = service.contextFor(bystander.npcId, TUE_10);
    expect(other.characterName).toBeUndefined();
    expect(other.segments.find((segment) => segment.id === 'npc')!.text)
      .toContain(`You are ${bystander.name.given} ${bystander.name.family}.`);
    expect(other.segments[0]!.text).toBe(context.segments[0]!.text);
    expect(other.segments[1]!.text).toBe(context.segments[1]!.text);

    const calls: { system: string; prompt: string }[] = [];
    await new Converse({ complete: async (request) => { calls.push(request); return 'My name is Petra Moss.'; } })
      .reply({ context, name: `${original.name.given} ${original.name.family}`, line: 'Are you Petra?' });
    expect(calls[0]!.prompt).toContain('Answer as Petra Moss');
    expect(calls[0]!.system).toContain('Your name is Petra Moss.');
  });

  it('keeps a verbatim tail, folds overflow into a digest through the LLM, and round-trips memory', async () => {
    const { service, informerId, llmCalls } = setup({ tailSize: 4, foldSize: 2 });
    for (let i = 1; i <= 5; i++) {
      await service.recordTurn(informerId, { speaker: i % 2 === 1 ? 'player' : 'npc', text: `line ${i}`, atMin: TUE_10 + i });
    }
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain('line 1');

    const context = service.contextFor(informerId, TUE_10);
    expect(context.segments.find((s) => s.id === 'memory')!.text).toContain('the barista stayed wary');
    const turns = context.segments.find((s) => s.id === 'turns')!;
    expect(turns.text).not.toContain('line 1');
    expect(turns.text).toContain('Player: line 5');

    const restored = setup({ tailSize: 4, foldSize: 2 });
    restored.service.restoreMemory(service.serializeMemory());
    const kept = restored.service.contextFor(restored.informerId, TUE_10).segments.find((s) => s.id === 'turns')!;
    expect(kept.text).toContain('line 5');
  });

  it('refuses unknown types and dead NPC context', () => {
    const { sim, service, informerId } = setup();
    const { world, types } = loadFixtureWorld('neon-bay');
    types.types = types.types.filter((type) => type.type !== 'cafe_barista');
    const unknownType = new DialogContextService({ world, types, sim, llm: { complete: async () => '' } });
    expect(() => unknownType.contextFor(informerId, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_UNKNOWN_ID' }));
    sim.applyFlag(informerId, { kind: 'die' });
    expect(() => service.contextFor(informerId, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_WRONG_STATE' }));
  });
});

describe('Converse', () => {
  it('sends the layers in order as the system prompt and the player line as the turn', async () => {
    const context: DialogContext = {
      npcId: 'npc-1',
      segments: [
        { id: 'world', text: 'WORLD LAYER', shared: true },
        { id: 'type', text: 'TYPE LAYER', shared: true },
        { id: 'npc', text: 'NPC LAYER', shared: false },
        { id: 'turns', text: 'TURNS LAYER', shared: false },
      ],
    };
    const seen: { system: string; prompt: string }[] = [];
    const llm: LLMPort = {
      async complete(request) {
        seen.push(request);
        return '  Not tonight, friend.\n';
      },
    };

    const reply = await new Converse(llm).reply({ context, name: 'Mara Voss', line: 'Where is the lift?' });

    expect(reply).toBe('Not tonight, friend.');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.system).toBe('WORLD LAYER\n\nTYPE LAYER\n\nNPC LAYER\n\nTURNS LAYER');
    expect(seen[0]?.prompt).toContain('"Where is the lift?"');
    expect(seen[0]?.prompt).toContain('Answer as Mara Voss');
  });
});
