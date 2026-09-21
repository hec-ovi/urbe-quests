/**
 * Contract-surface tests for quests/flow: validation, schedule gating,
 * branching, endings, places, guidance, death rules, persistence.
 */

import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { PlaceTarget, QuestlineDefinition, QuestStep, ResolvedCast } from '../schema.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';
import stateSchema from '../schema/questline-state.schema.json' with { type: 'json' };
import guidanceSchema from '../schema/step-guidance.schema.json' with { type: 'json' };

const TUE_10 = 1 * 1440 + 600;
const TUE_03 = 1 * 1440 + 180;
const TUE_20 = 1 * 1440 + 1200;

const step = (input: Partial<QuestStep> & Pick<QuestStep, 'stepId' | 'actId' | 'target'>): QuestStep => ({
  narrative: { description: 'A beat.', playerHint: 'Do it.', stake: 'Nobody else will.' },
  gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel', ...input,
});

/** The chip line: a talk that opens two parallel steps, then an exclusive branch on the chip flag. */
function definition(reportPlace: PlaceTarget = { parcelId: 'p8', name: 'Precinct 9' }): QuestlineDefinition {
  return {
    id: 'q_chip',
    title: 'The Static Chip',
    premise: 'A barista overheard something worth killing for and burned it onto a chip.',
    roles: [
      { roleId: 'barista', npcType: 'cafe_barista', persona: 'Nervy, owes money, trusts nobody twice.' },
      { roleId: 'exec', npcType: 'corpo_exec', persona: 'Collects leverage the way others collect art.' },
    ],
    items: [
      { itemId: 'chip', name: 'Scorched data chip', description: 'Her only leverage.', kind: 'device', atParcelId: 'p7' },
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
      step({ stepId: 's_talk', actId: 'a1', wantedByRoleId: 'barista', target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' },
        next: [{ toStepId: 's_pickup', when: [] }, { toStepId: 's_meet', when: [] }] }),
      step({ stepId: 's_pickup', actId: 'a1', wantedByRoleId: 'barista', target: { kind: 'pickup', itemId: 'chip' },
        effects: [{ kind: 'setFlag', flag: 'has_chip' }], next: [{ toStepId: 's_meet', when: [] }] }),
      step({ stepId: 's_meet', actId: 'a2', wantedByRoleId: 'exec', target: { kind: 'talk', roleId: 'exec' }, branching: 'exclusive',
        next: [{ toStepId: 's_handover', when: [{ kind: 'flagSet', flag: 'has_chip' }] }, { toStepId: 's_report', when: [] }] }),
      step({ stepId: 's_handover', actId: 'a2', wantedByRoleId: 'exec', endingId: 'e_sold',
        target: { kind: 'deliver', itemId: 'chip', place: { parcelId: 'p1', name: 'Helix Dynamics Tower' } } }),
      step({ stepId: 's_report', actId: 'a2', wantedByRoleId: 'barista', target: { kind: 'goto', place: reportPlace }, endingId: 'e_clean' }),
    ],
    endings: [
      { endingId: 'e_sold', title: 'Sold Out', epilogue: 'The purge happens anyway, better dressed.' },
      { endingId: 'e_clean', title: 'On the Record', epilogue: 'The precinct opens a file nobody reads. Yet.' },
    ],
    flags: ['has_chip'],
    entryStepIds: ['s_talk'],
  };
}

function setup(seed = 'flow-test') {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed, world, types });
  const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const exec = sim.reserveNPC({ name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' });
  const cast: ResolvedCast = { barista: barista.npcId, exec: exec.npcId };
  return { sim, cast, baristaId: barista.npcId, execId: exec.npcId };
}

describe('FlowValidator and cast resolution via runtime construction', () => {
  it('rejects a broken graph, a shadowing fallback, an information pickup and a missing cast entry', () => {
    const { sim, cast } = setup();

    const ghostEdge = definition();
    ghostEdge.steps[0]!.next.push({ toStepId: 's_ghost', when: [] });
    expect(() => new QuestlineRuntime(ghostEdge, cast, sim)).toThrowError(expect.objectContaining({ code: 'E_INVALID_FLOW' }));

    const shadowed = definition();
    shadowed.steps[2]!.next.reverse();
    expect(() => new QuestlineRuntime(shadowed, cast, sim)).toThrowError(/unconditional exclusive edge shadows/);

    const information = definition();
    information.items[0]!.kind = 'information';
    expect(() => new QuestlineRuntime(information, cast, sim)).toThrowError(expect.objectContaining({ code: 'E_INVALID_FLOW' }));

    expect(() => new QuestlineRuntime(definition(), { barista: cast['barista']! }, sim)).toThrowError(
      expect.objectContaining({ code: 'E_CAST' }),
    );
  });
});

describe('QuestlineRuntime', () => {
  it('lets a live host arrange a pinned appointment without bypassing presence, time, items or death', () => {
    const { sim, cast, baristaId } = setup();
    const def = definition();
    def.steps[0]!.target = { kind: 'talk', roleId: 'barista', atParcelId: 'p8' };
    def.steps[0]!.window = { days: [1], startMin: 540, endMin: 660, label: 'meeting' };
    const runtime = new QuestlineRuntime(def, cast, sim);
    expect(runtime.stepAvailability('s_talk', TUE_10)).toEqual({ available: false, reason: 'off_duty' });
    expect(runtime.stepPlacementAvailability('s_talk', TUE_10)).toEqual({ available: true });
    expect(() => runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_UNAVAILABLE' }),
    );
    expect(runtime.stepPlacementAvailability('s_talk', TUE_03)).toEqual({ available: false, reason: 'outside_window' });
    expect(runtime.stepPlacementAvailability('s_meet', TUE_10)).toEqual({ available: false, reason: 'condition' });
    def.steps[0]!.needs = ['chip'];
    expect(new QuestlineRuntime(def, cast, sim).stepPlacementAvailability('s_talk', TUE_10))
      .toEqual({ available: false, reason: 'missing_item' });
    sim.applyFlag(baristaId, { kind: 'die' });
    expect(runtime.stepPlacementAvailability('s_talk', TUE_10)).toEqual({ available: false, reason: 'role_dead' });
  });

  it('gates steps on schedule, presence, held items and conditions, and stalls once the target is dead', () => {
    const { sim, cast, baristaId, execId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);
    expect(runtime.stepAvailability('s_talk', TUE_03)).toEqual({ available: false, reason: 'not_present' });
    expect(runtime.stepAvailability('s_meet', TUE_03)).toEqual({ available: false, reason: 'condition' });
    expect(() => runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_03)).toThrowError(
      expect.objectContaining({ code: 'E_UNAVAILABLE' }),
    );
    expect(runtime.stepAvailability('s_talk', TUE_10)).toEqual({ available: true });
    expect(runtime.stepAvailability('s_talk', TUE_20)).toEqual({ available: false, reason: 'off_duty' });
    const windows = runtime.windows('s_talk')!;
    expect(windows.flatMap((w) => w.days).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(windows.every((w) => w.startMin === 480 && w.endMin === 960)).toBe(true);

    const held = definition();
    held.items.push({ itemId: 'name', name: "The buyer's name", description: 'Who pays for the purge.', kind: 'information' });
    held.steps[0]!.gives = ['name'];
    held.steps[2]!.needs = ['name', 'chip'];
    const gated = new QuestlineRuntime(held, cast, sim);
    gated.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    expect(gated.inventory()).toEqual(new Set(['name']));
    expect(gated.stepAvailability('s_meet', TUE_10)).toEqual({ available: false, reason: 'missing_item' });
    expect(() => gated.advance({ kind: 'talkedTo', npcId: execId }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_UNAVAILABLE' }),
    );
    gated.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10);
    expect(gated.stepAvailability('s_meet', TUE_10)).toEqual({ available: true });
    gated.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    gated.advance({ kind: 'delivered', itemId: 'chip', parcelId: 'p1' }, TUE_10);
    expect(gated.inventory()).toEqual(new Set(['name']));

    sim.applyFlag(baristaId, { kind: 'die' });
    expect(runtime.stepAvailability('s_talk', TUE_10)).toEqual({ available: false, reason: 'role_dead' });
    expect(runtime.status()).toBe('stalled');
  });

  it('runs both exclusive outcomes: parallel activation, flag effect, branch, ending', () => {
    const sold = setup();
    const runtime = new QuestlineRuntime(definition(), sold.cast, sold.sim);

    const start = runtime.serialize();
    expect(() => runtime.stepAvailability('missing', TUE_10)).toThrowError(expect.objectContaining({ code: 'E_UNKNOWN_ID' }));
    expect(() => runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_WRONG_STATE' }),
    );
    expect(runtime.serialize()).toEqual(start);

    expect(runtime.advance({ kind: 'talkedTo', npcId: sold.baristaId }, TUE_10).activatedStepIds).toEqual(['s_pickup', 's_meet']);
    runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10);
    expect(runtime.flags().has('has_chip')).toBe(true);
    expect(runtime.advance({ kind: 'talkedTo', npcId: sold.execId }, TUE_10).activatedStepIds).toEqual(['s_handover']);
    expect(runtime.advance({ kind: 'delivered', itemId: 'chip', parcelId: 'p1' }, TUE_10).endingId).toBe('e_sold');
    expect(runtime.status()).toBe('completed');
    expect(runtime.ending()?.title).toBe('Sold Out');
    expect(() => runtime.advance({ kind: 'pickedUp', itemId: 'chip' }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_WRONG_STATE' }),
    );

    const clean = setup('flow-clean');
    const other = new QuestlineRuntime(definition(), clean.cast, clean.sim);
    other.advance({ kind: 'talkedTo', npcId: clean.baristaId }, TUE_10);
    expect(other.advance({ kind: 'talkedTo', npcId: clean.execId }, TUE_10).activatedStepIds).toEqual(['s_report']);
    expect(other.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_10).endingId).toBe('e_clean');
  });

  it('resolves the place each step points at: the pinned parcel, the item, the delivery, and the person live', () => {
    const { sim, cast, execId } = setup();
    const runtime = new QuestlineRuntime(definition(), cast, sim);

    expect(runtime.stepPlace('s_talk', TUE_10)).toEqual({ kind: 'parcel', id: 'p4' });
    expect(runtime.stepPlace('s_pickup', TUE_10)).toEqual({ kind: 'parcel', id: 'p7' });
    expect(runtime.stepPlace('s_handover', TUE_10)).toEqual({ kind: 'parcel', id: 'p1' });
    // s_meet pins no parcel: the exec is wherever the simulation has him at that minute.
    expect(runtime.stepPlace('s_meet', TUE_10)).toEqual(sim.behaviorAt(execId, TUE_10).place);

    sim.applyFlag(execId, { kind: 'die' });
    expect(runtime.stepPlace('s_meet', TUE_10)).toBeUndefined();
  });

  it('runs observation, work, listening, theft and an authored lethal consequence', () => {
    const { sim, baristaId } = setup();
    const mark = sim.reserveNPC({ name: { given: 'Odo', family: 'Grell' }, type: 'cafe_barista', jobParcelId: 'p4' });
    const def = definition();
    def.roles[1]!.npcType = 'cafe_barista';
    const targets: QuestStep['target'][] = [
      { kind: 'observe', districtId: 'd1' },
      { kind: 'work', atParcelId: 'p4', role: 'counter_worker' },
      { kind: 'listen', roleIds: ['barista', 'exec'], atParcelId: 'p4' },
      { kind: 'steal', itemId: 'chip', fromRoleId: 'exec' },
      { kind: 'assassinate', roleId: 'exec' },
    ];
    def.steps = targets.map((target, index) => ({
      ...def.steps[0]!, stepId: `s${index}`, target,
      next: index < targets.length - 1 ? [{ toStepId: `s${index + 1}`, when: [] }] : [],
      ...(index === targets.length - 1 ? { endingId: 'e_sold' } : {}),
    }));
    def.endings = [def.endings[0]!];
    def.entryStepIds = ['s0'];
    const runtime = new QuestlineRuntime(def, { barista: baristaId, exec: mark.npcId }, sim);
    expect(runtime.windows('s0')).toBeUndefined();
    runtime.advance({ kind: 'observed', districtId: 'd1' }, TUE_10);
    runtime.advance({ kind: 'workedShift', parcelId: 'p4' }, TUE_10);
    runtime.advance({ kind: 'overheard', npcIds: [baristaId, mark.npcId] }, TUE_10);
    runtime.advance({ kind: 'stole', itemId: 'chip' }, TUE_10);
    expect(runtime.inventory()).toContain('chip');
    expect(runtime.advance({ kind: 'killed', npcId: mark.npcId }, TUE_10).endingId).toBe('e_sold');
    expect(sim.getNPC(mark.npcId).flags.dead).toBe(true);
  });

  it('projects route-ready destinations and a closed reason for an area target', () => {
    const validate = new Ajv2020({ strict: true }).compile(guidanceSchema);
    const reach = (place: PlaceTarget) => {
      const { sim, cast, baristaId, execId } = setup();
      const runtime = new QuestlineRuntime(definition(place), cast, sim);
      runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
      runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
      return runtime;
    };

    const station = reach({ stationId: 'station_central', name: 'Central Station' });
    const guidance = station.stepGuidance('s_report', TUE_10);
    expect(guidance).toEqual({
      questId: 'q_chip', stepId: 's_report', place: { kind: 'station', id: 'station_central' },
      destination: { kind: 'station', id: 'station_central' },
    });
    expect(validate(guidance), JSON.stringify(validate.errors)).toBe(true);
    expect(station.advance({ kind: 'arrivedAt', stationId: 'station_central' }, TUE_10).endingId).toBe('e_clean');

    const stop = reach({ stopId: 'stop_market', name: 'Market Stop' });
    expect(stop.stepGuidance('s_report', TUE_10)).toEqual(expect.objectContaining({ destination: { kind: 'stop', id: 'stop_market' } }));
    expect(stop.advance({ kind: 'arrivedAt', stopId: 'stop_market' }, TUE_10).endingId).toBe('e_clean');

    expect(reach({ districtId: 'd1', name: 'The Spine' }).stepGuidance('s_report', TUE_10)).toEqual({
      questId: 'q_chip', stepId: 's_report', place: { kind: 'district', id: 'd1' }, reason: 'district-area',
    });
  });

  it('gates a step on the hour its text names and refuses a hint the runtime does not check', () => {
    const { sim, cast, baristaId, execId } = setup();
    const timed = definition();
    const report = timed.steps.find((s) => s.stepId === 's_report')!;
    report.narrative = { ...report.narrative, playerHint: 'File it during the slow hour.' };
    report.window = { label: 'slow hour', days: [0, 1, 2, 3, 4, 5, 6], startMin: 960, endMin: 1410 };

    const runtime = new QuestlineRuntime(timed, cast, sim);
    runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);

    expect(runtime.windows('s_report')).toEqual([report.window]);
    expect(runtime.stepAvailability('s_report', TUE_10)).toEqual({ available: false, reason: 'outside_window' });
    expect(() => runtime.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_UNAVAILABLE' }),
    );
    expect(runtime.stepAvailability('s_report', TUE_20)).toEqual({ available: true });
    expect(runtime.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_20).endingId).toBe('e_clean');

    const promised = definition();
    promised.steps.find((s) => s.stepId === 's_report')!.narrative.playerHint = 'File it after dark.';
    expect(() => new QuestlineRuntime(promised, cast, sim)).toThrowError(/names "after dark" with no window/);
  });

  it('validates saved state, restores its exact history, and rejects forged steps, flags, branches and endings', () => {
    const { sim, cast, baristaId } = setup();
    const current = new QuestlineRuntime(definition(), cast, sim);
    current.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    const saved = current.serialize();
    expect(new Ajv2020({ strict: true }).compile(stateSchema)(saved)).toBe(true);
    expect(QuestlineRuntime.restore(definition(), cast, sim, saved).serialize()).toEqual(saved);

    const restore = (state: unknown) => QuestlineRuntime.restore(definition(), cast, sim, state);
    expect(() => restore({ activeStepIds: ['s_ghost'], completedStepIds: [], flags: [] })).toThrowError(/unknown step s_ghost/);
    expect(() => restore({ activeStepIds: ['s_meet'], completedStepIds: ['s_talk', 's_pickup'], flags: [] }))
      .toThrowError(/flags do not match/);
    expect(() => restore({ activeStepIds: [], completedStepIds: ['s_meet'], flags: [] })).toThrowError(/was not reachable/);
    expect(() => restore({
      activeStepIds: [], completedStepIds: ['s_talk', 's_pickup', 's_meet', 's_handover'], flags: ['has_chip'], endingId: 'missing',
    })).toThrowError(/unknown ending missing/);
  });
});
