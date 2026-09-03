/**
 * Contract-surface tests for quests/flow: validation, schedule gating,
 * branching, endings, death rules, persistence.
 */

import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { QuestlineDefinition, ResolvedCast } from '../schema.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';

const TUE_10 = 1 * 1440 + 600;
const TUE_03 = 1 * 1440 + 180;

function definition(): QuestlineDefinition {
  return {
    id: 'q_chip',
    title: 'The Static Chip',
    premise: 'A barista overheard something worth killing for and burned it onto a chip.',
    roles: [
      { roleId: 'barista', npcType: 'cafe_barista', persona: 'Nervy, owes money, trusts nobody twice.' },
      { roleId: 'exec', npcType: 'corpo_exec', persona: 'Collects leverage the way others collect art.' },
    ],
    items: [
      { itemId: 'chip', name: 'Scorched data chip', description: 'The barista burned the purge talk onto it; it is her only leverage.', kind: 'device', atParcelId: 'p7' },
    ],
    facts: [
      { factId: 'f_overheard', roleId: 'barista', text: 'I heard two Helix men plan a purge over espresso.' },
      { factId: 'f_buyer', roleId: 'exec', text: 'I will pay for the chip, no questions.', gateFlag: 'has_chip' },
    ],
    acts: [
      { actId: 'a1', title: 'Setup', summary: 'Find the chip trail.' },
      { actId: 'a2', title: 'Resolution', summary: 'Decide who gets the truth.' },
    ],
    steps: [
      {
        stepId: 's_talk',
        actId: 'a1',
        narrative: { description: 'The barista wants to talk, but only behind the counter.', playerHint: 'Visit the Static Cafe while it is open.', stake: 'If nobody carries this, she carries it alone.' },
        wantedByRoleId: 'barista',
        target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' },
        gives: [],
        needs: [],
        conditions: [],
        effects: [],
        next: [
          { toStepId: 's_pickup', when: [] },
          { toStepId: 's_meet', when: [] },
        ],
        branching: 'parallel',
      },
      {
        stepId: 's_pickup',
        actId: 'a1',
        narrative: { description: 'The chip is stashed at the Grey Market Exchange.', playerHint: 'Pick up the chip.', stake: 'Without the chip her word is a rumor.' },
        wantedByRoleId: 'barista',
        target: { kind: 'pickup', itemId: 'chip' },
        gives: [],
        needs: [],
        conditions: [],
        effects: [{ kind: 'setFlag', flag: 'has_chip' }],
        next: [{ toStepId: 's_meet', when: [] }],
        branching: 'parallel',
      },
      {
        stepId: 's_meet',
        actId: 'a2',
        narrative: { description: 'The exec knows you are sniffing around.', playerHint: 'Meet the executive.', stake: 'Leverage is only worth what someone will pay to bury.' },
        wantedByRoleId: 'exec',
        target: { kind: 'talk', roleId: 'exec' },
        gives: [],
        needs: [],
        conditions: [],
        effects: [],
        next: [
          { toStepId: 's_handover', when: [{ kind: 'flagSet', flag: 'has_chip' }] },
          { toStepId: 's_report', when: [] },
        ],
        branching: 'exclusive',
      },
      {
        stepId: 's_handover',
        actId: 'a2',
        narrative: { description: 'Money for silence.', playerHint: 'Deliver the chip to Helix Dynamics Tower.', stake: 'The purge stays quiet and so does the barista.' },
        wantedByRoleId: 'exec',
        target: { kind: 'deliver', itemId: 'chip', place: { parcelId: 'p1' } },
        gives: [],
        needs: [],
        conditions: [],
        effects: [],
        next: [],
        branching: 'parallel',
        endingId: 'e_sold',
      },
      {
        stepId: 's_report',
        actId: 'a2',
        narrative: { description: 'No chip, no leverage; the law is what is left.', playerHint: 'Go to Precinct 9.', stake: 'A file is the only thing the tower cannot buy back.' },
        wantedByRoleId: 'barista',
        target: { kind: 'goto', place: { parcelId: 'p8' } },
        gives: [],
        needs: [],
        conditions: [],
        effects: [],
        next: [],
        branching: 'parallel',
        endingId: 'e_clean',
      },
    ],
    endings: [
      { endingId: 'e_sold', title: 'Sold Out', epilogue: 'The purge happens anyway, better dressed.' },
      { endingId: 'e_clean', title: 'On the Record', epilogue: 'The precinct opens a file nobody reads. Yet.' },
    ],
    flags: ['has_chip'],
    entryStepIds: ['s_talk'],
  };
}

function setup() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'flow-test', world, types });
  const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const exec = sim.reserveNPC({ name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' });
  const cast: ResolvedCast = { barista: barista.npcId, exec: exec.npcId };
  return { sim, cast, baristaId: barista.npcId, execId: exec.npcId };
}

describe('FlowValidator via runtime construction', () => {
  it('rejects a structurally broken flow with E_INVALID_FLOW', () => {
    const bad = definition();
    bad.steps[0]!.next.push({ toStepId: 's_ghost', when: [] });
    const { sim, cast } = setup();
    expect(() => new QuestlineRuntime(bad, cast, sim)).toThrowError(expect.objectContaining({ code: 'E_INVALID_FLOW' }));
  });

  it('rejects a cast missing a role with E_CAST', () => {
    const { sim, cast } = setup();
    expect(() => new QuestlineRuntime(definition(), { barista: cast['barista']! }, sim)).toThrowError(
      expect.objectContaining({ code: 'E_CAST' }),
    );
  });

  it('rejects an exclusive branch whose unconditional fallback shadows a later outcome', () => {
    const bad = definition();
    bad.steps[2]!.next.reverse();
    const { sim, cast } = setup();
    expect(() => new QuestlineRuntime(bad, cast, sim)).toThrowError(/unconditional exclusive edge shadows/);
  });
});

describe('QuestlineRuntime', () => {
  it('gates a talk step on the NPC schedule: unavailable off-shift, available on-shift, windows derived from the routine', () => {
    const { sim, cast, baristaId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    expect(runtime.stepAvailability('s_talk', TUE_03).available).toBe(false);
    expect(() => runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_03)).toThrowError(
      expect.objectContaining({ code: 'E_UNAVAILABLE' }),
    );
    expect(runtime.stepAvailability('s_talk', TUE_10)).toEqual({ available: true });
    const windows = runtime.windows('s_talk')!;
    expect(windows.flatMap((w) => w.days).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(windows.every((w) => w.startMin === 480 && w.endMin === 960)).toBe(true);
  });

  it('runs the chip path: parallel activation, flag effect, exclusive branch, ending', () => {
    const { sim, cast, baristaId, execId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    const talked = runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    expect(talked.activatedStepIds).toEqual(['s_pickup', 's_meet']);
    runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10);
    expect(runtime.flags().has('has_chip')).toBe(true);
    const met = runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    expect(met.activatedStepIds).toEqual(['s_handover']);
    const done = runtime.advance({ kind: 'delivered', itemId: 'chip', parcelId: 'p1' }, TUE_10);
    expect(done.endingId).toBe('e_sold');
    expect(runtime.status()).toBe('completed');
    expect(runtime.ending()?.title).toBe('Sold Out');
    expect(() => runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_WRONG_STATE' }),
    );
  });

  it('takes the other exclusive branch when the flag is missing', () => {
    const { sim, cast, baristaId, execId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    const met = runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    expect(met.activatedStepIds).toEqual(['s_report']);
    expect(() => runtime.advance({ kind: 'delivered', itemId: 'chip', parcelId: 'p1' }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_WRONG_STATE' }),
    );
    const done = runtime.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_10);
    expect(done.endingId).toBe('e_clean');
  });

  it('rejects events that match no active step with E_WRONG_STATE', () => {
    const { sim, cast } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    expect(() => runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_WRONG_STATE' }),
    );
  });

  it('resolves the place each step points at: the pinned parcel, the item, the delivery, and the person live', () => {
    const { sim, cast, execId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);

    expect(runtime.stepPlace('s_talk', TUE_10)).toEqual({ kind: 'parcel', id: 'p4' });
    expect(runtime.stepPlace('s_pickup', TUE_10)).toEqual({ kind: 'parcel', id: 'p7' });
    expect(runtime.stepPlace('s_handover', TUE_10)).toEqual({ kind: 'parcel', id: 'p1' });
    // s_meet pins no parcel: the exec is wherever the simulation has him at that minute.
    expect(runtime.stepPlace('s_meet', TUE_10)).toEqual(sim.behaviorAt(execId, TUE_10).place);
    expect(runtime.stepPlace('s_meet', TUE_03)).toEqual(sim.behaviorAt(execId, TUE_03).place);

    sim.applyFlag(execId, { kind: 'die' });
    expect(runtime.stepPlace('s_meet', TUE_10)).toBeUndefined();
  });

  it('stalls when the only active step targets a dead NPC', () => {
    const { sim, cast, baristaId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    sim.applyFlag(baristaId, { kind: 'die' });
    expect(runtime.stepAvailability('s_talk', TUE_10)).toEqual({ available: false, reason: 'role_dead' });
    expect(runtime.status()).toBe('stalled');
  });

  it('survives serialize/restore mid-quest', () => {
    const { sim, cast, baristaId, execId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10);
    const restored = QuestlineRuntime.restore(definition(), cast, sim, runtime.serialize());
    expect(restored.flags().has('has_chip')).toBe(true);
    restored.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    const done = restored.advance({ kind: 'delivered', itemId: 'chip', parcelId: 'p1' }, TUE_10);
    expect(done.endingId).toBe('e_sold');
  });

  it('gates a step on held items and derives the inventory from pickups, gives and deliveries', () => {
    const { sim, cast, baristaId, execId } = setup();
    const def = definition();
    def.items.push({ itemId: 'name', name: 'The buyer\'s name', description: 'Who pays for the purge; the barista heard it.', kind: 'information' });
    def.steps[0]!.gives = ['name'];
    def.steps[2]!.needs = ['name', 'chip'];
    const runtime = new QuestlineRuntime(def, cast, sim);
    runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    expect(runtime.inventory()).toEqual(new Set(['name']));
    expect(runtime.stepAvailability('s_meet', TUE_10)).toEqual({ available: false, reason: 'missing_item' });
    expect(() => runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_UNAVAILABLE' }),
    );
    runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10);
    expect(runtime.stepAvailability('s_meet', TUE_10)).toEqual({ available: true });
    runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    runtime.advance({ kind: 'delivered', itemId: 'chip', parcelId: 'p1' }, TUE_10);
    expect(runtime.inventory()).toEqual(new Set(['name']));
  });

  it('rejects handling information as a physical item with E_INVALID_FLOW', () => {
    const { sim, cast } = setup();
    const def = definition();
    def.items[0]!.kind = 'information';
    expect(() => new QuestlineRuntime(def, cast, sim)).toThrowError(expect.objectContaining({ code: 'E_INVALID_FLOW' }));
  });

  it('completes an assassinate step and records the death in the simulation', () => {
    const { sim } = setup();
    const mark = sim.reserveNPC({ name: { given: 'Odo', family: 'Grell' }, type: 'corpo_exec', jobParcelId: 'p3' });
    const def: QuestlineDefinition = {
      id: 'q_hit',
      title: 'A Quiet Retirement',
      premise: 'Someone at the Crown Exchange signed one memo too many.',
      roles: [{ roleId: 'mark', npcType: 'corpo_exec', persona: 'Polite. Guilty.' }],
      items: [],
      facts: [],
      acts: [{ actId: 'a1', title: 'The Job', summary: 'Do it.' }],
      steps: [
        {
          stepId: 's_kill',
          actId: 'a1',
          narrative: { description: 'No witnesses.', playerHint: 'Find the mark.', stake: 'Every memo he signs empties another floor.' },
          target: { kind: 'assassinate', roleId: 'mark' },
          gives: [],
        needs: [],
        conditions: [],
          effects: [],
          next: [],
          branching: 'parallel',
          endingId: 'e_done',
        },
      ],
      endings: [{ endingId: 'e_done', title: 'Retired', epilogue: 'The memo stops circulating.' }],
      flags: [],
      entryStepIds: ['s_kill'],
    };
    const runtime = new QuestlineRuntime(def, { mark: mark.npcId }, sim);
    const done = runtime.advance({ kind: 'killed', npcId: mark.npcId }, TUE_10);
    expect(done.endingId).toBe('e_done');
    expect(sim.getNPC(mark.npcId).flags.dead).toBe(true);
  });
});
