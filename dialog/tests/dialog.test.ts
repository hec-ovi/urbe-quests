/**
 * Contract-surface tests for DialogContextService: layer order and sharing,
 * closed knowledge with flag gating, the player and the talk at hand, the
 * person and place layers, names instead of ids, the lines shown before an
 * exchange, tiered memory, death and persistence.
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

/** A small street grid: First and Second Street run east-west, First and Second Avenue north-south. */
const withStreets = (world: DialogWorld): DialogWorld => ({
  ...world,
  streets: {
    edges: [
      { id: 'e_a', class: 'road', path: [[0, 0], [200, 0]] },
      { id: 'e_b', class: 'street', path: [[0, 100], [200, 100]] },
      { id: 'e_c', class: 'road', path: [[0, 0], [0, 100]] },
      { id: 'e_d', class: 'street', path: [[100, 0], [100, 100]] },
    ],
  },
  parcels: world.parcels.map((parcel) => {
    const lots: Record<string, { lot: [number, number][]; access: { edgeId: string; point: [number, number] } }> = {
      p4: { lot: [[10, 5], [40, 5], [40, 30], [10, 30]], access: { edgeId: 'e_a', point: [25, 5] } },
      p5: { lot: [[50, 5], [80, 5], [80, 30], [50, 30]], access: { edgeId: 'e_a', point: [65, 5] } },
      p9: { lot: [[10, 70], [40, 70], [40, 95], [10, 95]], access: { edgeId: 'e_b', point: [25, 95] } },
    };
    return lots[parcel.id] ? { ...parcel, ...lots[parcel.id] } : parcel;
  }),
});

const LOOK = {
  height: 'tall', build: 'a slim build', face: ['a wide jaw', 'large eyes'], hair: 'short black hair, slicked back',
  skin: 'deep brown', eyes: 'grey-green', wearing: ['a navy bomber jacket with slate sleeves', 'charcoal joggers', 'grey high-top sneakers'],
  fabric: 'leather',
};

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

    // The person's household as the simulation has it, and nothing invented.
    expect(npc!.text).toMatch(person.family.length === 0
      ? /You live alone: you have no partner and no children, and nobody else lives with you\./
      : /You live with your [a-z ]+ [A-Z]/);

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

  it('tells a cast NPC who the player is and the talk it is on, in its own authored words, and nobody else', () => {
    const { service, runtime, informerId, buyerId, sim } = setup();
    const definition = structuredClone(runtime.def);
    definition.prologue = 'You are a courier who owes the cafe. Your debt is due Friday.';
    definition.steps[0]!.wantedByRoleId = 'buyer';
    definition.steps[0]!.dialogue = {
      opening: '[sigh] You again. The cameras are dark.',
      choices: [
        { id: 'ask', text: 'Since when?', reply: '[whisper] A week.', completesStep: false },
        { id: 'carry', text: "I'll carry it.", reply: 'Go.', completesStep: true },
        { id: 'drop', text: 'Not my problem.', reply: 'Then go.', completesStep: true },
      ],
    };
    const story = new QuestlineRuntime(definition, runtime.cast, sim);
    service.attachQuestline(story);
    const bystander = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 + 8 * 60 });

    const informer = segment(service.contextFor(informerId, TUE_10), 'quest');
    expect(informer).toContain('(these words address the player as you). It is background: what has happened since, and the matter you are on with them now, come first.\nYou are a courier who owes the cafe. Your debt is due Friday.');
    expect(informer).toContain('The matter you have raised with the player and are on now. You opened it: "You again. The cameras are dark."');
    expect(informer).toContain('Asked "Since when?", you answer: "A week."');
    expect(informer).toContain('What would settle it, should the player choose to say it: "I\'ll carry it." or "Not my problem."');
    expect(informer).not.toContain('carry the precinct rumor out');
    expect(informer).not.toContain('Go.');

    const buyer = segment(service.contextFor(buyerId, TUE_10), 'quest');
    expect(buyer).toContain('You are a courier who owes the cafe.');
    expect(buyer).toContain('carry the precinct rumor out');
    expect(buyer).not.toContain('You again.');
    expect(service.contextFor(bystander.npcId, TUE_10).segments.map((s) => s.text).join('\n')).not.toContain('courier');

    story.chooseDialogue('s_talk', informerId, 'carry', TUE_10);
    expect(segment(service.contextFor(informerId, TUE_10), 'quest')).not.toContain('You opened it');

    delete definition.prologue;
    service.attachQuestline(new QuestlineRuntime(definition, runtime.cast, sim));
    expect(segment(service.contextFor(informerId, TUE_10), 'quest')).not.toContain('Who the player is');
  });

  it('keeps how the player came in behind the talk a later step is on', () => {
    const { service, runtime, informerId, sim } = setup();
    const definition = structuredClone(runtime.def);
    definition.prologue = 'You are a courier who owes the cafe. She has sent for you: go and see her.';
    const first = definition.steps[0]!;
    delete first.endingId;
    first.next = [{ toStepId: 's_after', when: [] }];
    first.dialogue = { opening: 'You came. Here is the rumor.', choices: [{ id: 'carry', text: "I'll carry it.", reply: 'Go.', completesStep: true }] };
    definition.steps.push({
      ...structuredClone(first), stepId: 's_after', endingId: 'e_done', next: [], effects: [],
      dialogue: { opening: 'You carried it. Now they know your face.', choices: [{ id: 'hide', text: 'Then hide me.', reply: 'Back room.', completesStep: true }] },
    });
    const story = new QuestlineRuntime(definition, runtime.cast, sim);
    service.attachQuestline(story);
    story.chooseDialogue('s_talk', informerId, 'carry', TUE_10);

    const quest = segment(service.contextFor(informerId, TUE_10), 'quest');
    expect(quest).toMatch(/how they came into this, as they were told it when it began .* It is background: what has happened since, and the matter you are on with them now, come first\.\nYou are a courier who owes the cafe\. She has sent for you: go and see her\./);
    expect(quest).toContain('The matter you have raised with the player and are on now. You opened it: "You carried it. Now they know your face."');
    expect(quest).not.toContain('Here is the rumor.');
  });

  it('carries the lines shown since the last exchange after the remembered turns and stores them ahead of the next exchange, each at its minute', async () => {
    const { service, informerId } = setup();
    await service.recordExchange(informerId, { line: 'Hi.', reply: 'Hm.', atMin: TUE_10 });
    const prior = [
      { speaker: 'npc' as const, text: '[sigh] The cameras are dark.' },
      { speaker: 'player' as const, text: 'Since when?' },
      { speaker: 'npc' as const, text: 'A week.' },
    ];
    expect(segment(service.contextFor(informerId, TUE_10 + 5, { prior }), 'conversation')).toContain(
      'The conversation so far:\nPlayer: Hi.\nYou: Hm.\nYou: The cameras are dark.\nPlayer: Since when?\nYou: A week.',
    );
    expect(segment(service.contextFor(informerId, TUE_10 + 5), 'conversation')).not.toContain('cameras');

    const shown = [{ ...prior[0]!, atMin: TUE_10 + 1 }, { ...prior[1]!, atMin: TUE_10 + 2 }, prior[2]!];
    await service.recordExchange(informerId, { line: 'What do you mean?', reply: '[whisper] Nobody is watching.', atMin: TUE_10 + 5, prior: shown });
    expect(service.serializeMemory()[informerId]!.turns.slice(2)).toEqual([
      { speaker: 'npc', text: 'The cameras are dark.', atMin: TUE_10 + 1 },
      { speaker: 'player', text: 'Since when?', atMin: TUE_10 + 2 },
      { speaker: 'npc', text: 'A week.', atMin: TUE_10 + 5 },
      { speaker: 'player', text: 'What do you mean?', atMin: TUE_10 + 5 },
      { speaker: 'npc', text: 'Nobody is watching.', atMin: TUE_10 + 5 },
    ]);
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

  it('tells what the host saw happen nearby, with where and how long ago, after the place and before the turns', () => {
    const { service, informerId } = setup();
    const work = 'p4';
    const context = service.contextFor(informerId, TUE_10, {
      guide: { placeId: work, kind: 'parcel' },
      events: [
        { kind: 'struck', atMin: TUE_10 - 1, parcelId: work, metres: 34, hard: true, down: true },
        { kind: 'struck', atMin: TUE_10 - 25, parcelId: 'p8', metres: 6 },
        { kind: 'struck', atMin: TUE_10 - 70, parcelId: work, metres: 3, self: true, down: true },
        { kind: 'scene', atMin: TUE_10 - 3 * 60, parcelId: 'p8', metres: 52, notes: ['It looks like a crime scene.', 'A body lies on the ground.'] },
        { kind: 'scene', atMin: TUE_10 - 2 * 1440, parcelId: 'p8', metres: 52, notes: ['Someone stands there crying.'] },
      ],
    });
    expect(context.segments.map((s) => s.id)).toEqual(['world', 'type', 'npc', 'quest', 'place', 'events', 'turns']);
    const events = segment(context, 'events');
    expect(events).toMatch(/^What has happened around you lately, as you saw it or heard it from the people nearby\. The player may not know\./);
    expect(events.split('\n').slice(1)).toEqual([
      '- A car ran someone down at speed in the street by Static Cafe in Kanaal Market, about 30 metres from where you stand, a moment ago. They still lie there.',
      '- A car hit someone in the street by Precinct 9 in Kanaal Market, right where you stand, 25 minutes ago.',
      '- A car hit you in the street by Static Cafe in Kanaal Market, about an hour ago. You are shaken, but back on your feet.',
      '- At Precinct 9 in Kanaal Market, about 50 metres from where you stand, for about 3 hours now: It looks like a crime scene. A body lies on the ground.',
      '- At Precinct 9 in Kanaal Market, about 50 metres from where you stand, for 2 days now: Someone stands there crying.',
    ]);
    expect(events).not.toMatch(/\bp[48]\b/);
    expect(service.contextFor(informerId, TUE_10, { events: [] }).segments.some((s) => s.id === 'events')).toBe(false);
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
    expect(segment(during, 'conversation')).toContain('Player: line 1\nYou: reply 1');
    expect(segment(during, 'conversation')).toContain('Player: line 3\nYou: reply 3');
    expect(folds).toEqual(['player: line 1\nnpc: reply 1']);

    notes[0]!('<think>short</think> The player asked about the lift.');
    await folding;
    const after = service.contextFor(informerId, TUE_10);
    expect(segment(after, 'memory')).toBe('You remember:\n- The player asked about the lift.');
    expect(segment(after, 'conversation')).not.toContain('line 1');

    const restored = setup({ memory: { tailSize: 4, foldSize: 2 } });
    restored.service.restoreMemory(service.serializeMemory());
    expect(segment(restored.service.contextFor(restored.informerId, TUE_10), 'conversation')).toContain('Player: line 3');
  });

  it('keeps the turns when a fold fails and folds them with the next exchange', async () => {
    let down = true;
    const llm: LLMPort = { complete: async () => { if (down) throw new Error('model down'); return 'Folded.'; } };
    const { service, informerId } = setup({ memory: { tailSize: 2, foldSize: 2 }, llm });
    await service.recordExchange(informerId, { line: 'a', reply: 'b', atMin: TUE_10 });
    await expect(service.recordExchange(informerId, { line: 'c', reply: 'd', atMin: TUE_10 })).rejects.toThrow('model down');
    expect(segment(service.contextFor(informerId, TUE_10), 'conversation')).toContain('Player: a\nYou: b\nPlayer: c');

    down = false;
    await service.recordExchange(informerId, { line: 'e', reply: 'f', atMin: TUE_10 });
    const context = service.contextFor(informerId, TUE_10);
    expect(segment(context, 'memory')).toBe('You remember:\n- Folded.\n- Folded.');
    expect(segment(context, 'conversation')).toContain('The conversation so far:\nPlayer: e\nYou: f');
  });

  it('remembers replies without cues, keeps a note shaped like a transcript and treats an empty note as a failed fold', async () => {
    const notes = ['<think>nothing</think>', 'Player: asked about the lift.\nNPC: said it is broken.'];
    const { service, informerId } = setup({ memory: { tailSize: 2, foldSize: 2 }, llm: { complete: async () => notes.shift() ?? 'Later.' } });
    await service.recordExchange(informerId, { line: 'x', reply: '[sigh] y', atMin: TUE_10 });
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

  it('tells a person what they look like, where they live and work by street and apartment, their day and how they take to strangers', () => {
    const { service, sim, informerId } = setup({ world: withStreets });
    const person = sim.getNPC(informerId);
    person.home = { parcelId: 'p9', unit: 3, apartment: { id: 'floor:2/f1-home-1', floor: 2, number: '201' } };
    person.traits = ['warm', 'helpful'];
    const npc = segment(service.contextFor(informerId, TUE_10, { look: LOOK }), 'npc');
    expect(npc).toContain('What you look like, as anyone who sees you can tell: you are tall, with a slim build, a wide jaw and large eyes.');
    expect(npc).toContain('Your hair: short black hair, slicked back. Your skin is deep brown and your eyes are grey-green.');
    expect(npc).toContain('You are wearing a navy bomber jacket with slate sleeves, charcoal joggers and grey high-top sneakers; your clothes are leather.');
    expect(npc).toContain('You live in apartment 201 on the second floor of Blockhouse Elin, an apartment block on Second Street near the corner of First Avenue, in The Sump.');
    expect(npc).toContain('You work at Static Cafe, a coffee shop on First Street near the corner of First Avenue, in Kanaal Market as');
    expect(npc).toContain('You are friendly with strangers');
    expect(npc).toMatch(/Your day today, Tuesday: .*at work/);

    person.traits = ['suspicious', 'brusque'];
    expect(segment(service.contextFor(informerId, TUE_10), 'npc')).toContain('You do not like strangers');
  });

  it('says where a person stands: the street and corner, the building beside them, what is around, the light and where they are headed', () => {
    const { service, informerId } = setup({ world: withStreets });
    const turns = segment(service.contextFor(informerId, TUE_10, { here: { x: 30, z: -3, light: 'night, under street lamps and neon' } }), 'turns');
    expect(turns).toContain('You are standing on First Street near the corner of First Avenue, in Kanaal Market.');
    expect(turns).toContain('You are outside Static Cafe, a coffee shop.');
    expect(turns).toContain('Around you:\n- Noodle Saint, a restaurant, about 20 metres to the south-east');
    expect(turns).toContain('The light: night, under street lamps and neon.');
    // A restaurant nobody can go into is no place around to go to.
    const shut = setup({ world: (world) => ({ ...withStreets(world), closed: ['p5'] }) });
    expect(segment(shut.service.contextFor(shut.informerId, TUE_10, { here: { x: 30, z: -3 } }), 'turns')).not.toContain('Noodle Saint');

    const inside = segment(service.contextFor(informerId, TUE_10, { here: { x: 25, z: 20, parcelId: 'p4', floor: 0 } }), 'turns');
    expect(inside).toContain('You are inside Static Cafe, a coffee shop, on the ground floor.');
    expect(inside).not.toContain('- Static Cafe');

    const building = {
      room: 'lobby', lifts: 2, stairs: 1,
      floors: [
        { index: 0, rooms: ['lobby', 'mechanical_room'] },
        { index: 1, rooms: [], apartments: ['101', '102'] },
        { index: 2, rooms: [], apartments: ['201', '202'] },
        { index: 3, rooms: ['gym'] },
      ],
      people: [{ name: 'Mira Chen', role: 'receptionist', floor: 0, room: 'lobby' }, { role: 'security', floor: 3 }],
    };
    const housed = segment(service.contextFor(informerId, TUE_10, { here: { x: 25, z: 20, parcelId: 'p4', floor: 0, building } }), 'turns');
    expect(housed).toContain('You are in the lobby.');
    expect(housed).toContain('The building as you know it, 4 floors: ground floor: lobby, mechanical room; first floor to second floor: apartments 101 to 202; third floor: gym.');
    expect(housed).toContain('Between its floors there are 2 lifts and a staircase.');
    expect(housed).toContain('In the building right now, as far as you can tell:\n- Mira Chen, receptionist, on this floor in the lobby\n- a security, on the third floor');

    const guided = segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'street:2', kind: 'street' } }), 'place');
    expect(guided).toContain('You have led the player to Second Street');
  });

  it('says who a person lives with from their household alone, and what they do not have', () => {
    const { service, sim, informerId } = setup();
    const npc = sim.getNPC(informerId);
    npc.family = [];
    expect(segment(service.contextFor(informerId, TUE_10), 'npc')).toContain('You live alone: you have no partner and no children, and nobody else lives with you.');
    npc.family = [{ npcId: 'a1', relation: 'partner', name: { given: 'Ada', family: 'Vance' }, instantiated: false }];
    expect(segment(service.contextFor(informerId, TUE_10), 'npc')).toContain('You live with your partner Ada Vance, and nobody else. You have no children.');
    npc.family = [
      { npcId: 'a1', relation: 'partner', name: { given: 'Ada', family: 'Vance' }, instantiated: false },
      { npcId: 'k1', relation: 'child', name: { given: 'Rian', family: 'Vance' }, instantiated: false },
    ];
    expect(segment(service.contextFor(informerId, TUE_10), 'npc')).toContain('You live with your partner Ada Vance and your child Rian Vance, and nobody else. That is your whole household');
  });

  it('keeps the talk so far ahead of what changes every turn, and says how far home, work, the story\'s place and a named address lie', async () => {
    const { service, informerId } = setup({ world: withStreets });
    await service.recordExchange(informerId, { line: 'Where do you live?', reply: 'Up the road.', atMin: TUE_10 });
    const ways = [
      { what: 'home' as const, metres: 350, point: 'north-east', minutes: 5, lift: 'up' as const },
      { what: 'work' as const, metres: 10, point: 'south', minutes: 1 },
      { what: 'quest' as const, name: 'Static Cafe', metres: 120, point: 'west', minutes: 2 },
      { what: 'named' as const, name: 'apartment 301, floor 3, Kessler Block', metres: 40, point: 'north', minutes: 1, lift: 'down' as const },
    ];
    const context = service.contextFor(informerId, TUE_10, { here: { x: 30, z: -3 }, addresses: { home: { parcelId: 'p9', floor: 2, unit: 'apartment 201' }, ways } });
    const ids = context.segments.map((s) => s.id);
    expect(ids.indexOf('conversation')).toBeLessThan(ids.indexOf('turns'));
    expect(ids.at(-1)).toBe('turns');
    const now = segment(context, 'turns');
    expect(now).not.toContain('Where do you live?');
    expect(now).toContain('- your home: about 350 metres to the north-east, 5 minutes on foot, then the lift up');
    expect(now).toContain('- your work: right here');
    expect(now).toContain("- Static Cafe, where the player's business takes them: about 120 metres to the west, 2 minutes on foot");
    expect(now).toContain('- apartment 301, floor 3, Kessler Block: about 40 metres to the north, a minute on foot, then the lift down');
    expect(segment(context, 'address')).not.toContain('metres');
  });

  it('tells a companion what it overheard the player say to other people, marked as theirs', () => {
    const { service, informerId } = setup();
    const overheard = [{ name: 'Mira Chen', role: 'receptionist', player: 'Who rents 1407?', reply: 'Nobody since spring.' }];
    const context = service.contextFor(informerId, TUE_10, { overheard });
    const ids = context.segments.map((s) => s.id);
    expect(ids.indexOf('overheard')).toBeLessThan(ids.indexOf('turns'));
    expect(segment(context, 'overheard')).toContain("These are other people's words, not yours and not said to you");
    expect(segment(context, 'overheard')).toContain('- You overheard the player talking to Mira Chen, the receptionist. The player said: "Who rents 1407?" Mira Chen answered: "Nobody since spring."');
    expect(segment(service.contextFor(informerId, TUE_10), 'overheard')).toBe('');
  });

  it('knows the apartment it has led the player to as its own home', () => {
    const { service, sim, informerId } = setup({ world: withStreets });
    sim.getNPC(informerId).home = { parcelId: 'p9', unit: 3, apartment: { id: 'floor:2/f1-home-1', floor: 2, number: '201' } };
    const place = segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'p9', kind: 'parcel' } }), 'place');
    expect(place).toContain('You live here: your own apartment is number 201, on the second floor.');
    const door = segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'p9', kind: 'parcel', notes: ['You stand at the door of your apartment, which you have opened.'] } }), 'place');
    expect(door).toContain('What is there right now:\n- You stand at the door of your apartment, which you have opened.');
    expect(segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'a103', kind: 'person', name: 'Mira Chen' } }), 'place'))
      .toBe('You have walked the player to Mira Chen, who stands here with you both now. You have done what they asked; say so, and leave them to talk.');
    expect(segment(service.contextFor(informerId, TUE_10, { guide: { placeId: 'lift', kind: 'spot', name: 'the lift on the ground floor' } }), 'place'))
      .toBe('You have walked the player to the lift on the ground floor, and you are both standing there now.');
  });

  it('tells a person what they are doing for the player now: following, leading, an errand', () => {
    const { service, informerId } = setup();
    const turns = (task: Parameters<typeof service.contextFor>[2]) => segment(service.contextFor(informerId, TUE_10, task), 'turns');
    expect(turns({ task: { kind: 'leading', place: 'Static Cafe' } })).toContain('You are taking the player to Static Cafe, because they asked and you agreed.');
    expect(turns({ task: { kind: 'following' } })).toContain('You are walking with the player, following them');
    expect(turns({ task: { kind: 'sitting' } })).toContain('You are sitting here for a while, because the player asked you to.');
    expect(turns({ task: { kind: 'walking', place: 'the lift' } })).toContain('The player asked you to go to the lift');
    expect(turns({ task: { kind: 'brought', place: 'Static Cafe' } })).toContain('You have brought the player to Static Cafe, as they asked; you are there together now.');
    expect(turns({})).not.toContain('because they asked');
  });

  it('tells a person their home and work by address, where they stand inside, the cards they carry and a theft they caught', () => {
    const { service, informerId } = setup({ world: withStreets });
    const addresses = {
      home: { parcelId: 'p9', floor: 2, unit: 'apartment 201' },
      work: { parcelId: 'p4', floor: 0, room: 'counter_area' },
      here: { parcelId: 'p9', floor: 2, unit: 'apartment 201', room: 'living room' },
      access: [{ parcelId: 'p9', opens: 'apartment 201', tie: 'home' as const }, { parcelId: 'p4', opens: 'the staff rooms', tie: 'work' as const }],
      caught: 1,
    };
    const context = service.contextFor(informerId, TUE_10, { addresses, here: { x: 25, z: 20, parcelId: 'p9', floor: 2 } });
    expect(context.segments.map((entry) => entry.id).slice(0, 4)).toEqual(['world', 'type', 'npc', 'address']);
    const address = segment(context, 'address');
    expect(address).toContain('- Home: apartment 201, floor 2, Blockhouse Elin, an apartment block on Second Street near the corner of First Avenue, in The Sump.');
    expect(address).toContain('- Work: the counter area, ground floor, Static Cafe, a coffee shop on First Street near the corner of First Avenue, in Kanaal Market.');
    expect(address).toContain('You carry access cards for apartment 201 at Blockhouse Elin (your home) and the staff rooms at Static Cafe (your work).');
    expect(address).toContain('You caught the player trying to lift your card once.');
    expect(segment(context, 'turns')).toContain('Inside, you are on floor 2, in apartment 201, in the living room.');
    expect(service.contextFor(informerId, TUE_10, { addresses: {} }).segments.some((entry) => entry.id === 'address')).toBe(false);
  });

  it('tells a person the player called them, after the hour and what they are doing', () => {
    const { service, informerId } = setup();
    const turns = segment(service.contextFor(informerId, TUE_10, { call: { caller: 'player' } }), 'turns');
    expect(turns).toContain('they called you, and you are talking to them on the phone');
    expect(turns.indexOf('on the phone')).toBeGreaterThan(turns.indexOf('right now you are'));
    expect(segment(service.contextFor(informerId, TUE_10), 'turns')).not.toContain('on the phone');
  });
});
