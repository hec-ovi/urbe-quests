/** Who a person knows and where those people are, and the names a player asks about that they do not know. */

import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { DialogContextService } from '../DialogContextService.js';
import { peopleKnown } from '../people.js';
import type { BehaviorState, NPCInstance } from '../../world/types/simulation.js';

const TUE_10 = 1 * 1440 + 600;

function city() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'people-test', world, types });
  const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const partner = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 + 8 * 60 });
  const doctor = sim.reserveNPC({ name: { given: 'Mira', family: 'Chen' }, type: 'corpo_exec', jobParcelId: 'p1' });
  // The doctor works where the barista works, for the test.
  doctor.job = { ...doctor.job!, parcelId: barista.job!.parcelId };
  const stranger = sim.reserveNPC({ name: { given: 'Oskar', family: 'Vey' }, type: 'corpo_exec', jobParcelId: 'p1' });
  // Nobody shares a building with the stranger.
  barista.home = { parcelId: 'p9', unit: 1 };
  partner.home = { parcelId: 'p10', unit: 1 };
  doctor.home = { parcelId: 'p13', unit: 1 };
  stranger.home = { parcelId: 'p14', unit: 1 };
  return { world, types, sim, barista, partner, doctor, stranger };
}

const behaviorOf = (sim: StubSimulation, overrides: Record<string, Partial<BehaviorState>> = {}) =>
  (npcId: string, timeMin: number): BehaviorState => ({ ...sim.behaviorAt(npcId, timeMin), ...overrides[npcId] });

describe('peopleKnown', () => {
  it('knows the people it works with, where they are now as the host knows it, and flags the one the player names', () => {
    const { sim, barista, partner, doctor, stranger } = city();
    const people: NPCInstance[] = [barista, partner, doctor, stranger];
    const here = peopleKnown({ npc: barista, timeMin: TUE_10, line: 'hello, I am looking for doc mira', people, present: [doctor.npcId], behaviorAt: behaviorOf(sim) });
    const mira = here.known.find((person) => person.npcId === doctor.npcId)!;
    expect(mira).toMatchObject({ relation: 'coworker', now: { kind: 'here' }, asked: true, name: { given: 'Mira', family: 'Chen' } });
    expect(here.known.some((person) => person.npcId === stranger.npcId)).toBe(false);
    expect(here.unknown).toEqual([]);

    const away = peopleKnown({ npc: barista, timeMin: TUE_10, line: 'Where is Mira?', people, behaviorAt: behaviorOf(sim, { [doctor.npcId]: { mode: 'home', interrupted: false } }) });
    expect(away.known.find((person) => person.npcId === doctor.npcId)!.now).toEqual({ kind: 'home' });
    const held = peopleKnown({ npc: barista, timeMin: TUE_10, people, behaviorAt: behaviorOf(sim, { [doctor.npcId]: { interrupted: true } }) });
    expect(held.known.find((person) => person.npcId === doctor.npcId)!.now).toEqual({ kind: 'unknown' });
  });

  it('does not know a stranger the player names, and says only the word the player used', () => {
    const { sim, barista, partner, doctor, stranger } = city();
    const elsewhere = peopleKnown({ npc: stranger, timeMin: TUE_10, line: 'have you seen doc mira?', people: [barista, partner, doctor, stranger], behaviorAt: behaviorOf(sim) });
    expect(elsewhere.known.some((person) => person.npcId === doctor.npcId)).toBe(false);
    expect(elsewhere.unknown).toEqual(['mira']);
  });

  it('renders the people segment before the turns with the rule that nothing else about anybody is known', () => {
    const { world, types, sim, barista, partner, doctor, stranger } = city();
    const service = new DialogContextService({ world, types, sim, llm: { complete: async () => '' } });
    const people = peopleKnown({ npc: barista, timeMin: TUE_10, line: 'is Mira in?', people: [barista, partner, doctor, stranger], present: [doctor.npcId], behaviorAt: behaviorOf(sim) });
    const context = service.contextFor(barista.npcId, TUE_10, { people });
    expect(context.segments.map((segment) => segment.id)).toEqual(['world', 'type', 'npc', 'people', 'turns']);
    const text = context.segments.find((segment) => segment.id === 'people')!.text;
    expect(text).toContain('never make up where somebody else is');
    expect(text).toMatch(/- Mira Chen works with you\. Mira Chen is here with you right now, in this building or a few steps away: you can see them\. Mira Chen works as .* at Static Cafe\. They are looking for Mira Chen, who is someone else, not you: tell them Mira Chen is here and point the way\./);

    const away = service.contextFor(barista.npcId, TUE_10, {
      people: peopleKnown({ npc: barista, timeMin: TUE_10, line: 'is Mira in?', people: [barista, doctor], behaviorAt: behaviorOf(sim, { [doctor.npcId]: { mode: 'home', interrupted: false } }) }),
    }).segments.find((segment) => segment.id === 'people')!.text;
    expect(away).toContain('Mira Chen is not here: at home right now, as far as you know. Mira Chen works as');
    expect(away).toContain(', from 8 in the morning to 4 in the afternoon.');
    expect(away).toContain('They are asking about Mira Chen, who is someone else, not you.');

    const stranger2 = service.contextFor(stranger.npcId, TUE_10, {
      people: peopleKnown({ npc: stranger, timeMin: TUE_10, line: 'where is mira', people: [barista, doctor, stranger], behaviorAt: behaviorOf(sim) }),
    });
    const words = stranger2.segments.find((segment) => segment.id === 'people')!.text;
    expect(words).toContain('They asked about "mira": you know nobody by that name');
    expect(words).not.toContain('Mira Chen');
    expect(stranger2.segments[0]!.text).toContain('never make up where someone is, when they work, what they do or how you are tied to them');
  });
});

describe('spoken', () => {
  it('says a minute of the day the way people say it', async () => {
    const { spoken } = await import('../time.js');
    expect([0, 720, 840, 570, 1320, 125, 1439].map(spoken)).toEqual([
      'midnight', 'noon', '2 in the afternoon', 'half past 9 in the morning', '10 at night', '2:05 at night', '11:59 at night',
    ]);
  });
});
