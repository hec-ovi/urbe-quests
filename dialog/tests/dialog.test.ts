/**
 * Contract-surface tests for DialogContextService: layer order and sharing,
 * closed knowledge with flag gating, the person and place layers, names
 * instead of ids, tiered memory, death and persistence.
 */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { QuestlineRuntime } from '../../flow/QuestlineRuntime.js';
import { Converse } from '../Converse.js';
import { DialogContextService } from '../DialogContextService.js';
import type { DialogContext, DialogWorld, SegmentId } from '../schema.js';

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

function setup(options: {
  memory?: { tailSize: number; foldSize: number };
  llm?: LLMPort;
  world?: (world: DialogWorld) => DialogWorld;
} = {}) {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'dialog-test', world, types });
  const informer = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const buyer = sim.reserveNPC({ name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' });
  const llm = options.llm ?? { complete: async () => '' };
  const service = new DialogContextService({ world: options.world?.(world) ?? world, types, sim, llm, ...(options.memory ? { memory: options.memory } : {}) });
  const runtime = new QuestlineRuntime(DEF, { informer: informer.npcId, buyer: buyer.npcId }, sim);
  service.attachQuestline(runtime);
  return { sim, service, runtime, informerId: informer.npcId, buyerId: buyer.npcId };
}

const segment = (context: DialogContext, id: SegmentId) => context.segments.find((s) => s.id === id)?.text ?? '';

describe('DialogContextService', () => {
  it('layers context in cache order with shared world and type segments and the closed knowledge scope', () => {
    const { service, sim, informerId, buyerId } = setup();
    const context = service.contextFor(informerId, TUE_10);

    expect(context.segments.map((s) => s.id)).toEqual(['world', 'type', 'npc', 'quest', 'turns']);
    expect(context.segments.filter((s) => s.shared).map((s) => s.id)).toEqual(['world', 'type']);

    const [world, type, npc, quest, turns] = context.segments;
    expect(world!.text).toContain('deflect in character');
    expect(world!.text).toContain('Crown Spire');
    expect(type!.text).toContain('neon-lit cafe');
    const person = sim.getNPC(informerId);
    const noun = person.gender === 'female' ? 'woman' : 'man';
    expect(npc!.text).toContain(`You are ${person.name.given} ${person.name.family}, a ${person.age}-year-old ${noun}.`);
    expect(npc!.text).toContain(`People would call you ${person.traits![0]} and ${person.traits![1]}`);
    expect(npc!.text).toContain('You work at Static Cafe in Kanaal Market');
    expect(npc!.text).toContain('Collects rumors like tips.');
    expect(quest!.text).toContain('The Arcade cameras have been dark');
    expect(turns!.text).toContain('It is Tuesday 10:00; right now you are at work.');

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
    expect(identity).toContain('You are Petra Moss, a');
    expect(identity).toContain('Your name is Petra Moss.');
    expect(identity).toContain('Petra keeps her brother’s shift logs');
    expect(identity).not.toContain(`You are ${original.name.given} ${original.name.family},`);
    expect(sim.getNPC(informerId)).toEqual(original);

    const other = service.contextFor(bystander.npcId, TUE_10);
    expect(other.characterName).toBeUndefined();
    expect(other.segments.find((segment) => segment.id === 'npc')!.text)
      .toContain(`You are ${bystander.name.given} ${bystander.name.family},`);
    expect(other.segments[0]!.text).toBe(context.segments[0]!.text);
    expect(other.segments[1]!.text).toBe(context.segments[1]!.text);

    const calls: { system: string; prompt: string }[] = [];
    await new Converse({ complete: async (request) => { calls.push(request); return 'My name is Petra Moss.'; } })
      .reply({ context, name: `${original.name.given} ${original.name.family}`, line: 'Are you Petra?' });
    expect(calls[0]!.prompt).toContain('Answer as Petra Moss');
    expect(calls[0]!.system).toContain('Your name is Petra Moss.');
  });

  it('describes the person Simulation made and the places the world has not named, never their ids', () => {
    const { service, informerId } = setup({
      world: (world) => ({
        ...world,
        districts: world.districts.map(({ name: _, ...district }) => district),
        parcels: world.parcels.map(({ name: _, ...parcel }) => parcel),
      }),
    });
    const text = service.contextFor(informerId, TUE_10).segments.map((s) => s.text).join('\n');
    expect(text).not.toMatch(/\b[dp]\d+\b/);
    expect(text).not.toContain("The city's districts");
    expect(text).toContain("The city's character: rain-soaked cyberpunk port city");
    expect(text).toContain('You work at a coffee shop in a modest commercial district as');
  });

  it('describes transit work by the stop or the lines, and a guided stop the NPC works at', () => {
    const transit = { trainStations: [{ id: 'ts1', name: 'Harbor Station', districtId: 'd2' }], subwayStations: [{ id: 'ss0', districtId: 'd3' }] };
    const { service, sim, informerId } = setup({ world: (world) => ({ ...world, transit }) });
    const npc = sim.getNPC(informerId);
    const shift = npc.job!.shift;
    delete npc.job;
    const background = () => segment(service.contextFor(informerId, TUE_10), 'npc');

    npc.transitJob = { place: { kind: 'stop', id: 'ss0' }, role: 'fare_agent', shift };
    expect(background()).toContain('You work at a subway station in The Sump as fare agent,');
    expect(segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'ss0', kind: 'stop' } }), 'place'))
      .toContain('You have led the player to a subway station in The Sump, and you are both standing there now.\nYou work here.');
    expect(segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'ts1', kind: 'stop' } }), 'place'))
      .toContain('led the player to Harbor Station, a train station in Kanaal Market,');

    npc.transitJob = { place: { kind: 'route', id: 'Rsl0' }, role: 'driver', shift };
    expect(background()).toContain("You work on the city's transit lines as driver,");
    expect(background()).not.toContain('Rsl0');
  });

  it('adds the place the NPC led the player to, what its own life ties it to, and what the host shows there', () => {
    const { service, sim, informerId } = setup();
    const work = sim.getNPC(informerId).job!.parcelId;
    const guided = service.contextFor(informerId, TUE_10, {
      guide: { placeId: work, kind: 'parcel', notes: ['A cracked window behind the counter.'] },
    });
    expect(guided.segments.map((s) => s.id)).toEqual(['world', 'type', 'npc', 'quest', 'place', 'turns']);
    expect(segment(guided, 'place')).toContain('You have led the player to Static Cafe, a coffee shop in Kanaal Market,');
    expect(segment(guided, 'place')).toContain('You work here.');
    expect(segment(guided, 'place')).toContain('What is there right now:\n- A cracked window behind the counter.');

    const precinct = segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'p8', kind: 'parcel', name: 'the precinct' } }), 'place');
    expect(precinct).toContain('the precinct, a police station in Kanaal Market');
    expect(precinct).not.toContain('You work here.');
    expect(segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 's_9', kind: 'stop' } }), 'place')).toContain('led the player to a transit stop,');
    expect(service.contextFor(informerId, TUE_10).segments.some((s) => s.id === 'place')).toBe(false);
  });

  it('stores an exchange at once and folds overflow after it, keeping the turns until their note exists', async () => {
    const notes: ((note: string) => void)[] = [];
    const folds: string[] = [];
    const llm: LLMPort = { complete: ({ prompt }) => new Promise((resolve) => { folds.push(prompt); notes.push(resolve); }) };
    const { service, informerId } = setup({ memory: { tailSize: 4, foldSize: 2 }, llm });
    await service.recordExchange(informerId, { line: 'line 1', reply: 'reply 1', atMin: TUE_10 });
    await service.recordExchange(informerId, { line: 'line 2', reply: 'reply 2', atMin: TUE_10 + 1 });
    const folding = service.recordExchange(informerId, { line: 'line 3', reply: 'reply 3', atMin: TUE_10 + 2 });

    const during = service.contextFor(informerId, TUE_10);
    expect(segment(during, 'turns')).toContain('Player: line 1\nYou: reply 1');
    expect(segment(during, 'turns')).toContain('Player: line 3\nYou: reply 3');
    expect(folds).toEqual(['player: line 1\nnpc: reply 1']);

    notes[0]!('<think>short</think> The player asked about the lift.');
    await folding;
    const after = service.contextFor(informerId, TUE_10);
    expect(segment(after, 'memory')).toBe('You remember:\n- The player asked about the lift.');
    expect(segment(after, 'turns')).not.toContain('line 1');

    const restored = setup({ memory: { tailSize: 4, foldSize: 2 } });
    restored.service.restoreMemory(service.serializeMemory());
    expect(segment(restored.service.contextFor(restored.informerId, TUE_10), 'turns')).toContain('Player: line 3');
  });

  it('keeps the turns when a fold fails and folds them with the next exchange', async () => {
    let down = true;
    const llm: LLMPort = { complete: async () => { if (down) throw new Error('model down'); return 'Folded.'; } };
    const { service, informerId } = setup({ memory: { tailSize: 2, foldSize: 2 }, llm });
    await service.recordExchange(informerId, { line: 'a', reply: 'b', atMin: TUE_10 });
    await expect(service.recordExchange(informerId, { line: 'c', reply: 'd', atMin: TUE_10 })).rejects.toThrow('model down');
    expect(segment(service.contextFor(informerId, TUE_10), 'turns')).toContain('Player: a\nYou: b\nPlayer: c');

    down = false;
    await service.recordExchange(informerId, { line: 'e', reply: 'f', atMin: TUE_10 });
    const context = service.contextFor(informerId, TUE_10);
    expect(segment(context, 'memory')).toBe('You remember:\n- Folded.\n- Folded.');
    expect(segment(context, 'turns')).toContain('The conversation so far:\nPlayer: e\nYou: f');
  });

  it('keeps a note shaped like a transcript and treats an empty note as a failed fold', async () => {
    const notes = ['<think>nothing</think>', 'Player: asked about the lift.\nNPC: said it is broken.'];
    const { service, informerId } = setup({ memory: { tailSize: 2, foldSize: 2 }, llm: { complete: async () => notes.shift() ?? 'Later.' } });
    await service.recordExchange(informerId, { line: 'x', reply: 'y', atMin: TUE_10 });
    await expect(service.recordExchange(informerId, { line: 'z', reply: 'w', atMin: TUE_10 })).rejects.toMatchObject({ code: 'E_LLM' });
    expect(service.serializeMemory()[informerId]!.turns.map((turn) => turn.text)).toEqual(['x', 'y', 'z', 'w']);

    await service.recordExchange(informerId, { line: 'v', reply: 'u', atMin: TUE_10 });
    expect(service.serializeMemory()[informerId]).toEqual({
      digest: ['Player: asked about the lift.\nNPC: said it is broken.', 'Later.'],
      turns: [{ speaker: 'player', text: 'v', atMin: TUE_10 }, { speaker: 'npc', text: 'u', atMin: TUE_10 }],
    });
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
