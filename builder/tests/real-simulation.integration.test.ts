/**
 * Integration proof that the SimulationPort mirror matches the real
 * ../simulation library: questline cast resolution, routines and behavior run
 * against createSimulation instead of the stub. Skipped when the simulation
 * repo is not checked out next to this one (standalone runs stay green).
 */

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityBlueprint, NPCTypeSet as SimNPCTypeSet } from '../../../simulation/src/index.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { QuestlineRuntime } from '../../flow/QuestlineRuntime.js';
import { loadFixtureWorld } from '../../world/index.js';
import type { SimulationPort } from '../../world/types/simulation.js';
import { CastResolver } from '../CastResolver.js';

const SIM_ENTRY = new URL('../../../simulation/src/index.ts', import.meta.url);
const TUE_10 = 1 * 1440 + 600;

const ZERO_COUNTS = {
  residential: 0, hotel: 0, offices: 0, corpo: 0, hospital: 0, clinic: 0, police: 0,
  military: 0, factory: 0, commerce: 0, mall: 0, restaurant: 0, coffee_shop: 0,
};

function square(x: number, z: number, size = 20): [number, number][] {
  return [[x, z], [x + size, z], [x + size, z + size], [x, z + size]];
}

/** Minimal blueprint satisfying simulation's contract schema, mirroring neon-bay ids. */
function miniBlueprint(): CityBlueprint {
  return {
    meta: { version: '0.2', seed: 'neon-bay-1' },
    districts: [
      { id: 'd1', kind: 'downtown', tier: 'high_rich', boundary: square(0, 0, 100), maxFloors: 60 },
      { id: 'd2', kind: 'commercial', tier: 'mid', boundary: square(100, 0, 100), maxFloors: 20 },
      { id: 'd3', kind: 'residential', tier: 'poor', boundary: square(200, 0, 100), maxFloors: 8 },
    ],
    streets: {
      edges: [
        {
          id: 'e1',
          class: 'street',
          path: [[0, 50], [300, 50]] as [number, number][],
          sidewalk: { left: 2, right: 2 },
          districtIds: ['d1', 'd2', 'd3'],
        },
      ],
    },
    parcels: [
      { id: 'p1', districtId: 'd1', type: 'corpo', tier: 'high_rich', footprint: square(10, 10), access: { edgeId: 'e1', point: [20, 50] }, envelope: { minFloors: 10, maxFloors: 60, floorHeight: 4 } },
      { id: 'p4', districtId: 'd2', type: 'coffee_shop', tier: 'mid', footprint: square(110, 10), access: { edgeId: 'e1', point: [120, 50] }, envelope: { minFloors: 1, maxFloors: 3, floorHeight: 3 } },
      { id: 'p9', districtId: 'd3', type: 'residential', tier: 'poor', footprint: square(210, 10), access: { edgeId: 'e1', point: [220, 50] }, envelope: { minFloors: 4, maxFloors: 8, floorHeight: 2.6 } },
      { id: 'p10', districtId: 'd3', type: 'residential', tier: 'poor', footprint: square(240, 10), access: { edgeId: 'e1', point: [250, 50] }, envelope: { minFloors: 4, maxFloors: 8, floorHeight: 2.6 } },
    ],
    transit: { busStops: [], busRoutes: [], trainStations: [], trainLines: [], subwayStations: [], subwayLines: [] },
    stats: {
      population: 400,
      parcelCounts: { ...ZERO_COUNTS, corpo: 1, coffee_shop: 1, residential: 2 },
      perDistrict: [
        { districtId: 'd1', population: 20, parcelCounts: { ...ZERO_COUNTS, corpo: 1 } },
        { districtId: 'd2', population: 30, parcelCounts: { ...ZERO_COUNTS, coffee_shop: 1 } },
        { districtId: 'd3', population: 350, parcelCounts: { ...ZERO_COUNTS, residential: 2 } },
      ],
    },
  };
}

/** Neon-bay types shaped for simulation: district-name grounding stripped (the placeholder blueprint has no names). */
function simTypeSet(): SimNPCTypeSet {
  const { types } = loadFixtureWorld('neon-bay');
  return {
    meta: types.meta,
    types: types.types.map((t) => ({ ...t, grounding: { parcelTypes: t.grounding.parcelTypes, tiers: t.grounding.tiers } })),
    namePool: types.namePool,
  };
}

const DEF: QuestlineDefinition = {
  id: 'q_port_proof',
  title: 'Port of Call',
  premise: 'One barista, one reserved executive, one real simulation.',
  roles: [
    { roleId: 'informer', npcType: 'cafe_barista', persona: 'Hears everything.' },
    { roleId: 'buyer', npcType: 'corpo_exec', persona: 'Buys everything.', reservedName: { given: 'Vela', family: 'Marsh' } },
  ],
  items: [],
  facts: [{ factId: 'f_buyer', roleId: 'buyer', text: 'The tower always pays.' }],
  acts: [{ actId: 'a1', title: 'Proof', summary: 'Resolve the cast.' }],
  steps: [
    {
      stepId: 's_talk',
      actId: 'a1',
      narrative: { description: 'Coffee first.', playerHint: 'Talk to the barista at work.', stake: 'She hears everything and nobody asks.' },
      wantedByRoleId: 'informer',
      target: { kind: 'talk', roleId: 'informer', atParcelId: 'p4' },
      gives: [],
      needs: [],
      conditions: [],
      effects: [],
      next: [],
      branching: 'parallel',
      endingId: 'e_done',
    },
  ],
  endings: [{ endingId: 'e_done', title: 'Proven', epilogue: 'The port holds.' }],
  flags: [],
  entryStepIds: ['s_talk'],
};

describe.skipIf(!existsSync(SIM_ENTRY))('real simulation integration', () => {
  it('resolves a questline cast against createSimulation and drives runtime availability from real routines', async () => {
    const { createSimulation } = await import('../../../simulation/src/index.js');
    // Direct structural assignment: tsc proves the port mirror matches the real library.
    const sim: SimulationPort = createSimulation({
      seed: 'port-proof',
      blueprint: miniBlueprint(),
      npcTypes: simTypeSet(),
    });

    const cast = new CastResolver(sim).resolve(DEF, TUE_10);
    const informer = sim.getNPC(cast['informer']!);
    expect(informer.type).toBe('cafe_barista');
    expect(informer.job?.parcelId).toBe('p4');
    expect(informer.routine.length).toBeGreaterThan(0);

    const buyer = sim.getNPC(cast['buyer']!);
    expect(buyer.name).toEqual({ given: 'Vela', family: 'Marsh' });

    const runtime = new QuestlineRuntime(DEF, cast, sim);
    const windows = runtime.windows('s_talk');
    expect(windows).toBeDefined();
    expect(windows!.length).toBeGreaterThan(0);

    const behavior = sim.behaviorAt(informer.npcId, TUE_10);
    expect(['interior', 'street', 'transit', 'home']).toContain(behavior.mode);
  });
});
