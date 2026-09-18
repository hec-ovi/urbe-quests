/**
 * Contract-surface tests for quests/world: fixture loading, the Atlas
 * projection, and the stub simulation's semantics.
 */

import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, namedWorldFromAtlas, SimulationError, StubSimulation } from '../index.js';

const TUE_10 = 1 * 1440 + 600;
const TUE_03 = 1 * 1440 + 180;

function makeSim(seed = 'test-seed') {
  const { world, types } = loadFixtureWorld('neon-bay');
  return new StubSimulation({ seed, world, types });
}

describe('fixtures', () => {
  it('loads both era worlds with named districts and typed NPC sets', () => {
    for (const name of ['neon-bay', 'aldermoor'] as const) {
      const { world, types } = loadFixtureWorld(name);
      expect(world.districts.length).toBeGreaterThan(0);
      expect(world.districts.every((d) => d.name.length > 0)).toBe(true);
      expect(types.types.every((t) => t.boilerplate.length > 0)).toBe(true);
      expect(types.namePool.given.length).toBeGreaterThanOrEqual(20);
      expect(types.namePool.family.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('labels an Atlas world without naming and keeps its transit identities', () => {
    const world = namedWorldFromAtlas(
      {
        meta: { seed: 'plain-atlas' },
        districts: [{ id: 'd0', kind: 'downtown', tier: 'rich' }],
        parcels: [{ id: 'p0', districtId: 'd0', type: 'offices', tier: 'rich' }],
        transit: {
          busStops: [{ id: 'stop_1', districtId: 'd0' }],
          trainStations: [{ id: 'train_1', districtId: 'd0', name: 'Central Rail' }],
          subwayStations: [{ id: 'subway_1', districtId: 'd0', name: 'Central Below' }],
        },
      },
      'noir city',
    );

    expect(world.meta.naming).toEqual({ theme: 'noir city', namedAt: 'derived-from-atlas' });
    expect(world.districts[0]!.name).toBe('downtown d0');
    expect(world.transit?.busStops).toEqual([{ id: 'stop_1', districtId: 'd0' }]);
    expect(world.transit?.trainStations?.[0]?.name).toBe('Central Rail');
    expect(world.transit?.subwayStations?.[0]?.id).toBe('subway_1');
  });
});

describe('StubSimulation', () => {
  it('resolves a vendor by type on a gapless weekly routine, identically for the same seed', () => {
    const barista = makeSim().getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    expect(barista.type).toBe('cafe_barista');
    expect(barista.job?.parcelId).toBe('p4');
    for (let day = 0; day < 7; day++) {
      const intervals = barista.routine.filter((entry) => entry.days.includes(day));
      expect(intervals[0]?.startMin).toBe(0);
      expect(intervals.at(-1)?.endMin).toBe(1440);
      expect(intervals.slice(1).every((entry, index) => entry.startMin === intervals[index]!.endMin)).toBe(true);
    }

    const again = makeSim().getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    expect(again.name).toEqual(barista.name);
    expect(again.home).toEqual(barista.home);
  });

  it('reports behavior from the routine, tracks interrupt and resume, and reserves a fixed identity once', () => {
    const sim = makeSim();
    const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    const working = sim.behaviorAt(barista.npcId, TUE_10);
    expect(working.activity).toBe('working');
    expect(working.place).toEqual({ kind: 'parcel', id: 'p4' });
    sim.interrupt(barista.npcId, TUE_10);
    expect(sim.behaviorAt(barista.npcId, TUE_10).interrupted).toBe(true);
    sim.resume(barista.npcId, TUE_10);
    expect(sim.behaviorAt(barista.npcId, TUE_10).interrupted).toBe(false);

    const spec = { name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' };
    const reserved = sim.reserveNPC(spec);
    expect(reserved.name).toEqual(spec.name);
    expect(reserved.job?.parcelId).toBe('p1');
    expect(() => sim.reserveNPC(spec)).toThrowError(expect.objectContaining({ code: 'E_CONFLICT' }));
  });

  it('applies flags: resign clears the job, custom tags are queryable, death ends every query', () => {
    const sim = makeSim();
    const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    sim.applyFlag(barista.npcId, { kind: 'resign' });
    const jobless = sim.getNPC(barista.npcId);
    expect(jobless.job).toBeUndefined();
    expect(jobless.routine.some((e) => e.activity === 'working')).toBe(false);
    sim.applyFlag(barista.npcId, { kind: 'custom', tag: 'quest_ally' });
    expect(sim.findNPCs({ flag: 'quest_ally' })).toHaveLength(1);

    sim.applyFlag(barista.npcId, { kind: 'die' });
    expect(() => sim.getNPCVendor({ parcelId: 'p4', type: 'cafe_barista', timeMin: TUE_10 })).toThrowError(SimulationError);
    expect(() => sim.behaviorAt(barista.npcId, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_DEAD' }));
    expect(() => sim.applyFlag(barista.npcId, { kind: 'resign' })).toThrowError(expect.objectContaining({ code: 'E_DEAD' }));
    expect(sim.findNPCs({ type: 'cafe_barista' })).toHaveLength(0);
    expect(sim.findNPCs({ type: 'cafe_barista', includeDead: true })).toHaveLength(1);
  });

  it('rejects an empty query, an unknown identity, an invalid time and nobody on duty', () => {
    const sim = makeSim();
    expect(() => sim.getNPCVendor({ timeMin: TUE_10 })).toThrowError(expect.objectContaining({ code: 'E_INVALID_INPUT' }));
    expect(() => sim.getNPC('npc_nope')).toThrowError(expect.objectContaining({ code: 'E_UNKNOWN_ID' }));
    expect(() => sim.getNPCVendor({ type: 'cafe_barista', timeMin: -1 })).toThrowError(expect.objectContaining({ code: 'E_TIME' }));
    expect(() => sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_03 })).toThrowError(expect.objectContaining({ code: 'E_NO_MATCH' }));
  });
});
