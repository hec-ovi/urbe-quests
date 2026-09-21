/**
 * Contract-surface tests for cast resolution and the pin that follows it: a
 * questline is published where its own people hold their posts, a questline
 * the city cannot staff comes back blocked with its reason, and a character
 * found anywhere but on a post moves nothing.
 */

import { describe, expect, it, vi } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { SimulationError } from '../../world/types/simulation.js';
import type { QuestlineDefinition, QuestRole, QuestStep, StepTarget } from '../../flow/schema.js';
import { CastResolver } from '../CastResolver.js';
import { StoryVenues } from '../StoryVenues.js';

/** Tuesday 10:00, inside the day post; Tuesday 03:00, when nobody is on duty anywhere. */
const TUE_10 = 1 * 1440 + 600;
const TUE_03 = 1 * 1440 + 180;

const role = (roleId: string, npcType: string): QuestRole => ({ roleId, npcType, persona: 'Runs the floor upstairs.' });

const step = (stepId: string, target: StepTarget, wantedByRoleId?: string): QuestStep => ({
  stepId,
  actId: 'a1',
  narrative: { description: 'The floor boss wants a word.', playerHint: 'Talk to her.', stake: 'She loses the floor.' },
  ...(wantedByRoleId !== undefined ? { wantedByRoleId } : {}),
  target,
  gives: [],
  needs: [],
  conditions: [],
  effects: [],
  next: [],
  branching: 'parallel',
});

const questline = (id: string, roles: QuestRole[], steps: QuestStep[]): QuestlineDefinition => ({
  id,
  title: 'The Tower Floor',
  premise: 'An executive needs a word off the record.',
  roles,
  items: [],
  facts: [],
  acts: [{ actId: 'a1', title: 'The Word', summary: 'Meet her.' }],
  steps,
  endings: [{ endingId: 'e1', title: 'Said', epilogue: 'The word is out.' }],
  flags: [],
  entryStepIds: [steps[0]!.stepId],
});

function city() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'cast-test', world, types });
  const venues = new StoryVenues(world, types);
  return { sim, venues, resolver: new CastResolver(sim, venues) };
}

/** Every parcel the steps name, in step order. */
const places = (def: QuestlineDefinition): (string | undefined)[] =>
  def.steps.map((entry) => {
    const t = entry.target;
    if (t.kind === 'talk' || t.kind === 'listen' || t.kind === 'work') return t.atParcelId;
    return 'place' in t && 'parcelId' in t.place ? t.place.parcelId : undefined;
  });

describe('CastResolver', () => {
  it('publishes a step in the building its own character holds a post in, name included', () => {
    const { sim, venues, resolver } = city();
    // The story pins the executive to Spire Residences: people live there, nobody is hired there.
    const authored = questline(
      'q_tower',
      [role('exec', 'corpo_exec')],
      [
        step('s_go', { kind: 'goto', place: { parcelId: 'p13', name: 'Spire Residences' } }, 'exec'),
        step('s_talk', { kind: 'talk', roleId: 'exec', atParcelId: 'p13' }),
      ],
    );

    const { cast, posts } = resolver.cast(authored, TUE_10);
    const published = venues.pin(authored, new Map(Object.entries(posts)));

    expect(posts).toEqual({ exec: 'p1' });
    expect(sim.getNPC(cast['exec']!).job?.parcelId).toBe('p1');
    expect(published.steps[1]!.target).toEqual({ kind: 'talk', roleId: 'exec', atParcelId: 'p1' });
    expect(published.steps[0]!.target).toEqual({ kind: 'goto', place: { parcelId: 'p1', name: 'Helix Dynamics Tower' } });
  });

  it('publishes a questline it cannot staff with the reason, instead of dropping it', () => {
    const { resolver } = city();
    // Nobody is hired to be a resident, and no Sump resident exists to play the part.
    const authored = questline(
      'q_tower',
      [role('exec', 'corpo_exec'), role('neighbour', 'sump_resident')],
      [step('s_talk', { kind: 'talk', roleId: 'neighbour' })],
    );

    const result = resolver.cast(authored, TUE_10);

    expect(result.blocked).toMatchObject({ roleId: 'neighbour', npcType: 'sump_resident' });
    expect(result.blocked?.reason).toContain('cannot be cast');
  });

  it('keeps every questline in its own places when a character is found off a post', () => {
    const { sim, venues, resolver } = city();
    // One person of each type is in the world already, all working in the same hotel.
    for (const [given, type] of [['Ada', 'cafe_barista'], ['Bo', 'corpo_exec'], ['Cy', 'precinct_officer']] as const) {
      sim.reserveNPC({ name: { given, family: 'Renn' }, type, jobParcelId: 'p2' });
    }
    const set = [
      questline('q_a', [role('r1', 'cafe_barista')], [
        step('s_go', { kind: 'goto', place: { parcelId: 'p4', name: 'Static Cafe' } }, 'r1'),
        step('s_talk', { kind: 'talk', roleId: 'r1', atParcelId: 'p4' }),
      ]),
      questline('q_b', [role('r2', 'corpo_exec')], [step('s_talk', { kind: 'talk', roleId: 'r2', atParcelId: 'p3' })]),
      questline('q_c', [role('r3', 'precinct_officer')], [step('s_talk', { kind: 'talk', roleId: 'r3', atParcelId: 'p8' })]),
    ];
    const options = { taken: new Set<string>(), characters: new Map<string, string>() };

    // This host publishes no posts at any hour; existing off-post people remain valid fallbacks.
    vi.spyOn(sim, 'getNPCVendor').mockImplementation(() => {
      throw new SimulationError('E_NO_MATCH', 'no published posts');
    });
    const published = set.map((def) => {
      const { cast, posts } = resolver.cast(def, TUE_03, options);
      expect(posts).toEqual({});
      expect(sim.getNPC(Object.values(cast)[0]!).job?.parcelId).toBe('p2');
      return venues.pin(def, new Map(Object.entries(posts)));
    });

    expect(published.map(places)).toEqual([['p4', 'p4'], ['p3'], ['p8']]);
    expect(new Set(published.flatMap(places))).toEqual(new Set(['p4', 'p3', 'p8']));
  });

  it('casts distinct day and evening staff when the game opens after closing time', () => {
    const { sim, resolver } = city();
    const authored = questline('q_night', [role('first', 'cafe_barista'), role('second', 'cafe_barista')], [
      step('s_first', { kind: 'talk', roleId: 'first', atParcelId: 'p4' }),
      step('s_second', { kind: 'talk', roleId: 'second', atParcelId: 'p4' }),
    ]);

    const result = resolver.cast(authored, TUE_03);

    expect(result.blocked).toBeUndefined();
    expect(new Set(Object.values(result.cast)).size).toBe(2);
    expect(Object.values(result.cast).map((id) => sim.getNPC(id).job?.shift.kind)).toEqual(['day', 'evening']);
    expect(result.posts).toEqual({ first: 'p4', second: 'p4' });
  });

  it('searches later times inside the authored window before other weekly posts', () => {
    const { sim, resolver } = city();
    const vendor = sim.getNPCVendor.bind(sim);
    vi.spyOn(sim, 'getNPCVendor').mockImplementation((query) => {
      if (query.timeMin % 1440 < 600) throw new SimulationError('E_NO_MATCH', 'late opening');
      return vendor(query);
    });
    const meeting = step('s_talk', { kind: 'talk', roleId: 'barista', atParcelId: 'p4' });
    meeting.window = { days: [2], startMin: 480, endMin: 720, label: 'morning appointment' };

    const result = resolver.cast(questline('q_window', [role('barista', 'cafe_barista')], [meeting]), TUE_03);

    expect(result.blocked).toBeUndefined();
    expect(sim.getNPC(result.cast['barista']!).job?.shift.kind).toBe('day');
    expect(sim.getNPCVendor).toHaveBeenCalledWith(expect.objectContaining({ timeMin: 2 * 1440 + 600 }));
  });

  it('finds a post on another weekday before declaring a role uncastable', () => {
    const { sim, resolver } = city();
    const vendor = sim.getNPCVendor.bind(sim);
    vi.spyOn(sim, 'getNPCVendor').mockImplementation((query) => {
      if (Math.floor(query.timeMin / 1440) % 7 !== 4) throw new SimulationError('E_NO_MATCH', 'Friday post');
      return vendor(query);
    });
    const authored = questline('q_weekly', [role('barista', 'cafe_barista')], [
      step('s_talk', { kind: 'talk', roleId: 'barista', atParcelId: 'p4' }),
    ]);

    const result = resolver.cast(authored, TUE_03);

    expect(result.blocked).toBeUndefined();
    expect(sim.getNPC(result.cast['barista']!).job?.parcelId).toBe('p4');
  });

  it('blocks an exhausted cast instead of giving two characters the same person', () => {
    const { sim, resolver } = city();
    const person = sim.getNPCVendor({ parcelId: 'p4', type: 'cafe_barista', timeMin: TUE_10 });
    vi.spyOn(sim, 'getNPCVendor').mockReturnValue(person);
    const options = { taken: new Set<string>(), characters: new Map<string, string>() };
    const first = questline('q_first', [role('barista', 'cafe_barista')], [
      step('s_talk', { kind: 'talk', roleId: 'barista', atParcelId: 'p4' }),
    ]);
    expect(resolver.cast(first, TUE_10, options).cast['barista']).toBe(person.npcId);
    expect(resolver.cast({ ...first, id: 'q_shared' }, TUE_03, options).cast['barista']).toBe(person.npcId);

    const other = questline('q_other', [role('other', 'cafe_barista')], [
      step('s_other', { kind: 'talk', roleId: 'other', atParcelId: 'p4' }),
    ]);
    const result = resolver.cast(other, TUE_03, options);

    expect(result.cast).toEqual({});
    expect(result.blocked).toMatchObject({ roleId: 'other', npcType: 'cafe_barista' });
    expect(options.characters.has('other:cafe_barista')).toBe(false);

    // A reservation port returning an already retained person is still not
    // permission to assign that body a second character.
    other.roles[0]!.reservedName = { given: 'Another', family: 'Character' };
    vi.spyOn(sim, 'reserveNPC').mockReturnValue(person);
    expect(resolver.cast(other, TUE_03, options).blocked?.reason).toContain('already plays a different character');
  });
});
