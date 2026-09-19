/**
 * Contract-surface tests for the authored interaction mechanics: exact
 * completion events, ordered evidence, branch endings, replay and validation.
 */

import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';
import type { QuestlineDefinition, QuestStep, ResolvedCast } from '../schema.js';

const TUE_10 = 1 * 1440 + 600;
const P4 = { parcelId: 'p4', name: 'Static Cafe' };
const P7 = { parcelId: 'p7', name: 'Grey Market Exchange' };
const P1 = { parcelId: 'p1', name: 'Helix Dynamics Tower' };

const step = (input: Partial<QuestStep> & Pick<QuestStep, 'stepId' | 'actId' | 'target'>): QuestStep => ({
  narrative: { description: `Authored action ${input.stepId}.`, playerHint: `Complete ${input.stepId}.`, stake: 'The next consequence depends on it.' },
  wantedByRoleId: 'witness',
  gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel', ...input,
});

const flagged = (flag: string, next: string[], rest: Partial<QuestStep> = {}): Partial<QuestStep> => ({
  effects: [{ kind: 'setFlag', flag }],
  next: next.map((toStepId) => ({ toStepId, when: [] })),
  ...rest,
});

const information = (itemId: string, description: string) => ({ itemId, name: itemId, description, kind: 'information' as const });

/** Two ordered clues, a hacked terminal, an opened door, a freed witness, a ride, then a choice of endings. */
function expandedDefinition(): QuestlineDefinition {
  return {
    id: 'q_signal_room',
    title: 'The Signal Room',
    premise: 'Trace a staged blackout, free its witness, and decide whether to expose or disable the machinery behind it.',
    roles: [{ roleId: 'witness', npcType: 'cafe_barista', persona: 'Memorizes every outage and trusts physical records.' }],
    items: [
      information('burn_pattern', 'Where the blackout began.'),
      information('relay_route', 'What connects the scene to the control terminal.'),
      information('entry_code', 'The code recovered from the hacked terminal.'),
    ],
    facts: [],
    acts: [
      { actId: 'a_scene', title: 'The scene', summary: 'Inspect two ordered clues.' },
      { actId: 'a_release', title: 'The witness', summary: 'Open the room and bring the witness out.' },
      { actId: 'a_choice', title: 'The choice', summary: 'Travel to the source and choose its fate.' },
    ],
    steps: [
      step({ stepId: 's_burn', actId: 'a_scene',
        target: { kind: 'investigation', sceneId: 'scene_blackout', evidenceId: 'wall_burn', evidenceItemId: 'burn_pattern', subjectRoleIds: ['witness'], place: P4, completionFlag: 'burn_inspected' },
        ...flagged('burn_inspected', [], { gives: ['burn_pattern'], next: [{ toStepId: 's_relay', when: [{ kind: 'flagSet', flag: 'burn_inspected' }] }] }) }),
      step({ stepId: 's_relay', actId: 'a_scene',
        target: { kind: 'investigation', sceneId: 'scene_blackout', evidenceId: 'relay_scoring', evidenceItemId: 'relay_route', subjectRoleIds: ['witness'], place: P4, completionFlag: 'relay_inspected' },
        ...flagged('relay_inspected', ['s_hack'], { gives: ['relay_route'], needs: ['burn_pattern'] }) }),
      step({ stepId: 's_hack', actId: 'a_scene',
        target: { kind: 'hacking', targetId: 'terminal_service_4', place: P4, completionFlag: 'terminal_hacked' },
        ...flagged('terminal_hacked', ['s_access'], { gives: ['entry_code'], needs: ['relay_route'] }) }),
      step({ stepId: 's_access', actId: 'a_release',
        target: { kind: 'access', accessPointId: 'door_service_4', credentialItemId: 'entry_code', place: P4, completionFlag: 'door_open' },
        ...flagged('door_open', ['s_release'], { needs: ['entry_code'] }) }),
      step({ stepId: 's_release', actId: 'a_release',
        target: { kind: 'rescue', roleId: 'witness', releaseTargetId: 'restraint_witness_4', place: P4, completionFlag: 'witness_released' },
        ...flagged('witness_released', ['s_escort']) }),
      step({ stepId: 's_escort', actId: 'a_release',
        target: { kind: 'escort', roleId: 'witness', routeId: 'route_cafe_market', mode: 'follow-player', from: P4, to: P7, completionFlag: 'witness_safe' },
        ...flagged('witness_safe', ['s_ride'], { conditions: [{ kind: 'flagSet', flag: 'witness_released' }] }) }),
      step({ stepId: 's_ride', actId: 'a_choice',
        target: { kind: 'transportation', journeyId: 'ride_market_tower', mode: 'ride-hail', from: P7, to: P1, passengerRoleIds: [], cargoItemIds: [], completionFlag: 'ride_complete' },
        ...flagged('ride_complete', ['s_sabotage', 's_report']) }),
      step({ stepId: 's_sabotage', actId: 'a_choice', endingId: 'e_disabled',
        target: { kind: 'sabotage', targetId: 'relay_primary', place: P1, completionFlag: 'relay_disabled' },
        ...flagged('relay_disabled', []) }),
      step({ stepId: 's_report', actId: 'a_choice', target: { kind: 'goto', place: { parcelId: 'p8', name: 'Precinct 9' } }, endingId: 'e_reported' }),
    ],
    endings: [
      { endingId: 'e_disabled', title: 'Dark relay', epilogue: 'The relay stops and its owners lose the live trail.' },
      { endingId: 'e_reported', title: 'Public evidence', epilogue: 'The ordered evidence enters the public record.' },
    ],
    flags: ['burn_inspected', 'relay_inspected', 'terminal_hacked', 'door_open', 'witness_released', 'witness_safe', 'ride_complete', 'relay_disabled'],
    entryStepIds: ['s_burn'],
  };
}

function setup(seed = 'expanded-mechanics') {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed, world, types });
  const witness = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const cast: ResolvedCast = { witness: witness.npcId };
  return { sim, cast, witnessId: witness.npcId };
}

/** Every completion event up to the ending choice, each repeating its authored identities. */
function runToChoice(runtime: QuestlineRuntime, witnessId: string): void {
  runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'wall_burn', place: P4 }, TUE_10);
  runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'relay_scoring', place: P4 }, TUE_10);
  runtime.advance({ kind: 'hacked', targetId: 'terminal_service_4', place: P4 }, TUE_10);
  runtime.advance({ kind: 'accessed', accessPointId: 'door_service_4', credentialItemId: 'entry_code', place: P4 }, TUE_10);
  runtime.advance({ kind: 'released', npcId: witnessId, releaseTargetId: 'restraint_witness_4', place: P4 }, TUE_10);
  runtime.advance({ kind: 'escorted', npcId: witnessId, routeId: 'route_cafe_market', mode: 'follow-player', from: P4, to: { parcelId: 'p7' } }, TUE_10);
  runtime.advance({
    kind: 'transported', journeyId: 'ride_market_tower', mode: 'ride-hail', from: { parcelId: 'p7' }, to: { parcelId: 'p1' },
    passengerNpcIds: [], cargoItemIds: [],
  }, TUE_10);
}

describe('expanded authored mechanics', () => {
  it('runs ordered evidence, hacking, access, release, follow, ride-hail, sabotage, and a branch ending', () => {
    const { sim, cast, witnessId } = setup();
    const runtime = new QuestlineRuntime(expandedDefinition(), cast, sim);

    expect(runtime.stepPlace('s_burn', TUE_10)).toEqual({ kind: 'parcel', id: 'p4' });
    expect(() => runtime.advance(
      { kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'wrong_clue', place: P4 },
      TUE_10,
    )).toThrowError(expect.objectContaining({ code: 'E_WRONG_STATE' }));

    runToChoice(runtime, witnessId);
    expect(runtime.inventory()).toEqual(new Set(['burn_pattern', 'relay_route', 'entry_code']));
    expect(runtime.activeSteps().map((candidate) => candidate.stepId)).toEqual(['s_sabotage', 's_report']);

    const result = runtime.advance({ kind: 'sabotaged', targetId: 'relay_primary', place: { parcelId: 'p1' } }, TUE_10);
    expect(result.endingId).toBe('e_disabled');
    expect(runtime.flags()).toContain('relay_disabled');
    expect(runtime.status()).toBe('completed');
  });

  it('replays deterministically after restore and preserves the alternate ending', () => {
    const first = setup();
    const runtime = new QuestlineRuntime(expandedDefinition(), first.cast, first.sim);
    runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'wall_burn', place: P4 }, TUE_10);
    const restored = QuestlineRuntime.restore(expandedDefinition(), first.cast, first.sim, runtime.serialize());
    restored.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'relay_scoring', place: P4 }, TUE_10);
    restored.advance({ kind: 'hacked', targetId: 'terminal_service_4', place: P4 }, TUE_10);
    restored.advance({ kind: 'accessed', accessPointId: 'door_service_4', credentialItemId: 'entry_code', place: P4 }, TUE_10);
    restored.advance({ kind: 'released', npcId: first.witnessId, releaseTargetId: 'restraint_witness_4', place: P4 }, TUE_10);
    restored.advance({ kind: 'escorted', npcId: first.witnessId, routeId: 'route_cafe_market', mode: 'follow-player', from: P4, to: { parcelId: 'p7' } }, TUE_10);
    restored.advance({ kind: 'transported', journeyId: 'ride_market_tower', mode: 'ride-hail', from: { parcelId: 'p7' }, to: { parcelId: 'p1' }, passengerNpcIds: [], cargoItemIds: [] }, TUE_10);
    restored.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_10);

    const second = setup('expanded-replay');
    const replay = new QuestlineRuntime(expandedDefinition(), second.cast, second.sim);
    runToChoice(replay, second.witnessId);
    replay.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_10);

    expect(restored.serialize()).toEqual(replay.serialize());
    expect(restored.ending()?.endingId).toBe('e_reported');
    expect(restored.flags().has('relay_disabled')).toBe(false);
  });

  it('rejects mechanic definitions that omit exact evidence, prerequisite, consequence, or cast references', () => {
    const { sim, cast } = setup();

    const physicalEvidence = expandedDefinition();
    physicalEvidence.items.find((item) => item.itemId === 'burn_pattern')!.kind = 'document';
    expect(() => new QuestlineRuntime(physicalEvidence, cast, sim)).toThrowError(/evidence item burn_pattern is not information/);

    const missingCredential = expandedDefinition();
    missingCredential.steps.find((candidate) => candidate.stepId === 's_access')!.needs = [];
    expect(() => new QuestlineRuntime(missingCredential, cast, sim)).toThrowError(/does not need credential item entry_code/);

    const missingConsequence = expandedDefinition();
    missingConsequence.steps.find((candidate) => candidate.stepId === 's_sabotage')!.effects = [];
    expect(() => new QuestlineRuntime(missingConsequence, cast, sim)).toThrowError(/completion flag relay_disabled is not set/);

    const unknownCast = expandedDefinition();
    const ride = unknownCast.steps.find((candidate) => candidate.stepId === 's_ride')!;
    if (ride.target.kind !== 'transportation') throw new Error('fixture target changed');
    ride.target.passengerRoleIds = ['missing_role'];
    expect(() => new QuestlineRuntime(unknownCast, cast, sim)).toThrowError(/unknown role missing_role/);
  });
});
