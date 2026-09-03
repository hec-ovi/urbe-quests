import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';
import type { PlaceTarget, QuestlineDefinition } from '../schema.js';
import stateSchema from '../schema/questline-state.schema.json' with { type: 'json' };
import guidanceSchema from '../schema/step-guidance.schema.json' with { type: 'json' };

const TIME = 600;

function definition(destination: PlaceTarget = { stationId: 'station_central' }): QuestlineDefinition {
  return {
    id: 'q_transit_trace',
    title: 'Transit trace',
    premise: 'Follow a signal from the depot to the correct platform.',
    roles: [],
    items: [],
    facts: [],
    acts: [{ actId: 'a_trace', title: 'Trace', summary: 'Follow the two locations.' }],
    steps: [
      {
        stepId: 's_depot',
        actId: 'a_trace',
        narrative: { description: 'Check the depot.', playerHint: 'Go to the depot.', stake: 'The trail cools with every departure.' },
        target: { kind: 'goto', place: { parcelId: 'p4' } },
        gives: [],
        needs: [],
        conditions: [],
        effects: [{ kind: 'setFlag', flag: 'depot_checked' }],
        next: [{ toStepId: 's_platform', when: [] }],
        branching: 'parallel',
      },
      {
        stepId: 's_platform',
        actId: 'a_trace',
        narrative: { description: 'The platform holds the answer.', playerHint: 'Reach the platform.', stake: 'Missing it leaves the witness exposed.' },
        target: { kind: 'goto', place: destination },
        gives: [],
        needs: [],
        conditions: [],
        effects: [],
        next: [],
        branching: 'parallel',
        endingId: 'e_found',
      },
    ],
    endings: [{ endingId: 'e_found', title: 'Found', epilogue: 'The trail resolves at the platform.' }],
    flags: ['depot_checked'],
    entryStepIds: ['s_depot'],
  };
}

function runtime(destination?: PlaceTarget): QuestlineRuntime {
  return new QuestlineRuntime(definition(destination), {}, simulation('guidance-state'));
}

function simulation(seed: string): StubSimulation {
  const { world, types } = loadFixtureWorld('neon-bay');
  return new StubSimulation({ seed, world, types });
}

describe('route guidance through the runtime entry point', () => {
  it('projects parcel, station, and stop destinations and completes transit arrivals exactly', () => {
    const validate = new Ajv2020({ strict: true }).compile(guidanceSchema);
    const stationRuntime = runtime();
    expect(stationRuntime.stepGuidance('s_depot', TIME)).toEqual({
      questId: 'q_transit_trace', stepId: 's_depot', place: { kind: 'parcel', id: 'p4' }, destination: { kind: 'parcel', id: 'p4' },
    });
    stationRuntime.advance({ kind: 'arrivedAt', parcelId: 'p4' }, TIME);
    const station = stationRuntime.stepGuidance('s_platform', TIME);
    expect(station).toEqual({
      questId: 'q_transit_trace', stepId: 's_platform', place: { kind: 'station', id: 'station_central' },
      destination: { kind: 'station', id: 'station_central' },
    });
    expect(validate(station), JSON.stringify(validate.errors)).toBe(true);
    expect(stationRuntime.advance({ kind: 'arrivedAt', stationId: 'station_central' }, TIME).endingId).toBe('e_found');

    const stopRuntime = runtime({ stopId: 'stop_market' });
    stopRuntime.advance({ kind: 'arrivedAt', parcelId: 'p4' }, TIME);
    expect(stopRuntime.stepGuidance('s_platform', TIME)).toEqual(expect.objectContaining({
      destination: { kind: 'stop', id: 'stop_market' },
    }));
    expect(stopRuntime.advance({ kind: 'arrivedAt', stopId: 'stop_market' }, TIME).endingId).toBe('e_found');
  });

  it('reports area targets that cannot form a route request', () => {
    const districtRuntime = runtime({ districtId: 'd1' });
    expect(districtRuntime.stepGuidance('s_platform', TIME)).toEqual({
      questId: 'q_transit_trace', stepId: 's_platform', place: { kind: 'district', id: 'd1' }, reason: 'district-area',
    });
  });
});

describe('saved state through the runtime entry point', () => {
  it('validates serialized state and restores its exact history', () => {
    const current = runtime();
    current.advance({ kind: 'arrivedAt', parcelId: 'p4' }, TIME);
    const saved = current.serialize();
    const validate = new Ajv2020({ strict: true }).compile(stateSchema);
    expect(validate(saved), JSON.stringify(validate.errors)).toBe(true);
    expect(QuestlineRuntime.restore(definition(), {}, simulation('restore-state'), saved).serialize()).toEqual(saved);
  });

  it('rejects forged steps, flags, branches, and endings', () => {
    const sim = simulation('forged-state');
    const def = definition();
    const restore = (state: unknown) => QuestlineRuntime.restore(def, {}, sim, state);

    expect(() => restore({ activeStepIds: ['s_ghost'], completedStepIds: [], flags: [] })).toThrowError(/unknown step s_ghost/);
    expect(() => restore({ activeStepIds: ['s_platform'], completedStepIds: ['s_depot'], flags: [] })).toThrowError(/flags do not match/);
    expect(() => restore({ activeStepIds: [], completedStepIds: ['s_platform'], flags: [] })).toThrowError(/was not reachable/);
    expect(() => restore({ activeStepIds: [], completedStepIds: ['s_depot', 's_platform'], flags: ['depot_checked'], endingId: 'missing' })).toThrowError(/unknown ending missing/);
  });
});
