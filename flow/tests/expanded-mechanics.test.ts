import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';
import type { QuestlineDefinition, ResolvedCast } from '../schema.js';

const TUE_10 = 1 * 1440 + 600;

function expandedDefinition(): QuestlineDefinition {
  return {
    id: 'q_signal_room',
    title: 'The Signal Room',
    premise: 'Trace a staged blackout, free its witness, and decide whether to expose or disable the machinery behind it.',
    roles: [{ roleId: 'witness', npcType: 'cafe_barista', persona: 'Memorizes every outage and trusts physical records.' }],
    items: [
      { itemId: 'burn_pattern', name: 'Burn pattern', description: 'A fixed clue showing where the blackout began.', kind: 'information' },
      { itemId: 'relay_route', name: 'Relay route', description: 'A second clue connecting the scene to the control terminal.', kind: 'information' },
      { itemId: 'entry_code', name: 'Service entry code', description: 'The exact code recovered from the hacked terminal.', kind: 'information' },
    ],
    facts: [],
    acts: [
      { actId: 'a_scene', title: 'The scene', summary: 'Inspect two ordered clues.' },
      { actId: 'a_release', title: 'The witness', summary: 'Open the room and bring the witness out.' },
      { actId: 'a_choice', title: 'The choice', summary: 'Travel to the source and choose its fate.' },
    ],
    steps: [
      step({
        stepId: 's_burn',
        actId: 'a_scene',
        target: {
          kind: 'investigation', sceneId: 'scene_blackout', evidenceId: 'wall_burn', evidenceItemId: 'burn_pattern',
          subjectRoleIds: ['witness'], place: { parcelId: 'p4' }, completionFlag: 'burn_inspected',
        },
        gives: ['burn_pattern'],
        effects: [{ kind: 'setFlag', flag: 'burn_inspected' }],
        next: [{ toStepId: 's_relay', when: [{ kind: 'flagSet', flag: 'burn_inspected' }] }],
      }),
      step({
        stepId: 's_relay',
        actId: 'a_scene',
        target: {
          kind: 'investigation', sceneId: 'scene_blackout', evidenceId: 'relay_scoring', evidenceItemId: 'relay_route',
          subjectRoleIds: ['witness'], place: { parcelId: 'p4' }, completionFlag: 'relay_inspected',
        },
        gives: ['relay_route'],
        needs: ['burn_pattern'],
        effects: [{ kind: 'setFlag', flag: 'relay_inspected' }],
        next: [{ toStepId: 's_hack', when: [] }],
      }),
      step({
        stepId: 's_hack',
        actId: 'a_scene',
        target: { kind: 'hacking', targetId: 'terminal_service_4', place: { parcelId: 'p4' }, completionFlag: 'terminal_hacked' },
        gives: ['entry_code'],
        needs: ['relay_route'],
        effects: [{ kind: 'setFlag', flag: 'terminal_hacked' }],
        next: [{ toStepId: 's_access', when: [] }],
      }),
      step({
        stepId: 's_access',
        actId: 'a_release',
        target: {
          kind: 'access', accessPointId: 'door_service_4', credentialItemId: 'entry_code',
          place: { parcelId: 'p4' }, completionFlag: 'door_open',
        },
        needs: ['entry_code'],
        effects: [{ kind: 'setFlag', flag: 'door_open' }],
        next: [{ toStepId: 's_release', when: [] }],
      }),
      step({
        stepId: 's_release',
        actId: 'a_release',
        target: {
          kind: 'rescue', roleId: 'witness', releaseTargetId: 'restraint_witness_4',
          place: { parcelId: 'p4' }, completionFlag: 'witness_released',
        },
        effects: [{ kind: 'setFlag', flag: 'witness_released' }],
        next: [{ toStepId: 's_escort', when: [] }],
      }),
      step({
        stepId: 's_escort',
        actId: 'a_release',
        target: {
          kind: 'escort', roleId: 'witness', routeId: 'route_cafe_market', mode: 'follow-player',
          from: { parcelId: 'p4' }, to: { parcelId: 'p7' }, completionFlag: 'witness_safe',
        },
        conditions: [{ kind: 'flagSet', flag: 'witness_released' }],
        effects: [{ kind: 'setFlag', flag: 'witness_safe' }],
        next: [{ toStepId: 's_ride', when: [] }],
      }),
      step({
        stepId: 's_ride',
        actId: 'a_choice',
        target: {
          kind: 'transportation', journeyId: 'ride_market_tower', mode: 'ride-hail',
          from: { parcelId: 'p7' }, to: { parcelId: 'p1' }, passengerRoleIds: [], cargoItemIds: [],
          completionFlag: 'ride_complete',
        },
        effects: [{ kind: 'setFlag', flag: 'ride_complete' }],
        next: [{ toStepId: 's_sabotage', when: [] }, { toStepId: 's_report', when: [] }],
      }),
      step({
        stepId: 's_sabotage',
        actId: 'a_choice',
        target: { kind: 'sabotage', targetId: 'relay_primary', place: { parcelId: 'p1' }, completionFlag: 'relay_disabled' },
        effects: [{ kind: 'setFlag', flag: 'relay_disabled' }],
        next: [],
        endingId: 'e_disabled',
      }),
      step({
        stepId: 's_report',
        actId: 'a_choice',
        target: { kind: 'goto', place: { parcelId: 'p8' } },
        next: [],
        endingId: 'e_reported',
      }),
    ],
    endings: [
      { endingId: 'e_disabled', title: 'Dark relay', epilogue: 'The relay stops and its owners lose the live trail.' },
      { endingId: 'e_reported', title: 'Public evidence', epilogue: 'The ordered evidence enters the public record.' },
    ],
    flags: ['burn_inspected', 'relay_inspected', 'terminal_hacked', 'door_open', 'witness_released', 'witness_safe', 'ride_complete', 'relay_disabled'],
    entryStepIds: ['s_burn'],
  };
}

type StepInput = Omit<QuestlineDefinition['steps'][number], 'narrative' | 'wantedByRoleId' | 'gives' | 'needs' | 'conditions' | 'effects' | 'next' | 'branching'> &
  Partial<Pick<QuestlineDefinition['steps'][number], 'gives' | 'needs' | 'conditions' | 'effects' | 'next' | 'branching' | 'endingId'>>;

function step(input: StepInput): QuestlineDefinition['steps'][number] {
  return {
    narrative: { description: `Authored action ${input.stepId}.`, playerHint: `Complete ${input.stepId}.`, stake: 'The next consequence depends on this exact action.' },
    wantedByRoleId: 'witness',
    gives: [],
    needs: [],
    conditions: [],
    effects: [],
    next: [],
    branching: 'parallel',
    ...input,
  };
}

function setup() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'expanded-mechanics', world, types });
  const witness = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const cast: ResolvedCast = { witness: witness.npcId };
  return { sim, cast, witnessId: witness.npcId };
}

function runToChoice(runtime: QuestlineRuntime, witnessId: string): void {
  runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'wall_burn', place: { parcelId: 'p4' } }, TUE_10);
  runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'relay_scoring', place: { parcelId: 'p4' } }, TUE_10);
  runtime.advance({ kind: 'hacked', targetId: 'terminal_service_4', place: { parcelId: 'p4' } }, TUE_10);
  runtime.advance({ kind: 'accessed', accessPointId: 'door_service_4', credentialItemId: 'entry_code', place: { parcelId: 'p4' } }, TUE_10);
  runtime.advance({ kind: 'released', npcId: witnessId, releaseTargetId: 'restraint_witness_4', place: { parcelId: 'p4' } }, TUE_10);
  runtime.advance({ kind: 'escorted', npcId: witnessId, routeId: 'route_cafe_market', mode: 'follow-player', from: { parcelId: 'p4' }, to: { parcelId: 'p7' } }, TUE_10);
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
      { kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'wrong_clue', place: { parcelId: 'p4' } },
      TUE_10,
    )).toThrowError(expect.objectContaining({ code: 'E_WRONG_STATE' }));

    runToChoice(runtime, witnessId);
    expect(runtime.inventory()).toEqual(new Set(['burn_pattern', 'relay_route', 'entry_code']));
    expect(runtime.activeSteps().map((candidate) => candidate.stepId)).toEqual(['s_sabotage', 's_report']);
    expect(runtime.stepPlace('s_sabotage', TUE_10)).toEqual({ kind: 'parcel', id: 'p1' });

    const result = runtime.advance({ kind: 'sabotaged', targetId: 'relay_primary', place: { parcelId: 'p1' } }, TUE_10);
    expect(result.endingId).toBe('e_disabled');
    expect(runtime.flags()).toContain('relay_disabled');
    expect(runtime.status()).toBe('completed');
  });

  it('replays deterministically after restore and preserves the alternate ending', () => {
    const first = setup();
    const runtime = new QuestlineRuntime(expandedDefinition(), first.cast, first.sim);
    runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'wall_burn', place: { parcelId: 'p4' } }, TUE_10);
    runtime.advance({ kind: 'investigated', sceneId: 'scene_blackout', evidenceId: 'relay_scoring', place: { parcelId: 'p4' } }, TUE_10);
    const restored = QuestlineRuntime.restore(expandedDefinition(), first.cast, first.sim, runtime.serialize());
    restored.advance({ kind: 'hacked', targetId: 'terminal_service_4', place: { parcelId: 'p4' } }, TUE_10);
    restored.advance({ kind: 'accessed', accessPointId: 'door_service_4', credentialItemId: 'entry_code', place: { parcelId: 'p4' } }, TUE_10);
    restored.advance({ kind: 'released', npcId: first.witnessId, releaseTargetId: 'restraint_witness_4', place: { parcelId: 'p4' } }, TUE_10);
    restored.advance({ kind: 'escorted', npcId: first.witnessId, routeId: 'route_cafe_market', mode: 'follow-player', from: { parcelId: 'p4' }, to: { parcelId: 'p7' } }, TUE_10);
    restored.advance({ kind: 'transported', journeyId: 'ride_market_tower', mode: 'ride-hail', from: { parcelId: 'p7' }, to: { parcelId: 'p1' }, passengerNpcIds: [], cargoItemIds: [] }, TUE_10);
    restored.advance({ kind: 'arrivedAt', parcelId: 'p8' }, TUE_10);

    const second = setup();
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
