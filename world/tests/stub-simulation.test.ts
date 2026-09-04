/**
 * Contract-surface tests for quests/world: fixture loading and the stub
 * simulation's semantics (determinism, staffing schedule, liveness, flags).
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

  it('derives stable district labels from an Atlas world when naming is absent', () => {
    const world = namedWorldFromAtlas(
      {
        meta: { seed: 'plain-atlas' },
        districts: [{ id: 'd0', kind: 'downtown', tier: 'rich' }],
        parcels: [{ id: 'p0', districtId: 'd0', type: 'offices', tier: 'rich' }],
      },
      'noir city',
    );
    expect(world.meta.naming).toEqual({ theme: 'noir city', namedAt: 'derived-from-atlas' });
    expect(world.districts[0]!.name).toBe('downtown d0');
  });

  it('preserves transit identities for quest destinations without copying geometry into the quest contract', () => {
    const world = namedWorldFromAtlas(
      {
        meta: { seed: 'transit-atlas' },
        districts: [{ id: 'd0', kind: 'downtown', tier: 'rich' }],
        parcels: [],
        transit: {
          busStops: [{ id: 'stop_1', districtId: 'd0' }],
          busRoutes: [{ id: 'bus_1', name: 'Night Loop' }],
          trainStations: [{ id: 'train_1', districtId: 'd0', name: 'Central Rail' }],
          trainLines: [{ id: 'rail_1', name: 'Harbor Line' }],
          subwayStations: [{ id: 'subway_1', districtId: 'd0', name: 'Central Below' }],
          subwayLines: [{ id: 'metro_1', name: 'Flood Line' }],
        },
      },
      'noir transit city',
    );

    expect(world.transit?.busStops).toEqual([{ id: 'stop_1', districtId: 'd0' }]);
    expect(world.transit?.trainStations?.[0]?.name).toBe('Central Rail');
    expect(world.transit?.subwayStations?.[0]?.id).toBe('subway_1');
  });
});

describe('StubSimulation', () => {
  it('resolves a vendor by type during work hours, with a gapless weekly routine', () => {
    const sim = makeSim();
    const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    expect(barista.type).toBe('cafe_barista');
    expect(barista.job?.parcelId).toBe('p4');
    for (let day = 0; day < 7; day++) {
      for (const minute of [0, 419, 480, 959, 1200, 1439]) {
        const entry = barista.routine.find((e) => e.days.includes(day) && minute >= e.startMin && minute < e.endMin);
        expect(entry, `day ${day} minute ${minute}`).toBeDefined();
      }
    }
  });

  it('is deterministic: same seed and call order produce the same NPC', () => {
    const a = makeSim().getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    const b = makeSim().getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    expect(a.name).toEqual(b.name);
    expect(a.home).toEqual(b.home);
  });

  it('throws E_NO_MATCH when nobody is on duty', () => {
    const sim = makeSim();
    expect(() => sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_03 })).toThrowError(
      expect.objectContaining({ code: 'E_NO_MATCH' }),
    );
  });

  it('reports behavior from the routine and tracks interrupt/resume', () => {
    const sim = makeSim();
    const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    const working = sim.behaviorAt(barista.npcId, TUE_10);
    expect(working.activity).toBe('working');
    expect(working.place).toEqual({ kind: 'parcel', id: 'p4' });
    sim.interrupt(barista.npcId, TUE_10);
    expect(sim.behaviorAt(barista.npcId, TUE_10).interrupted).toBe(true);
    sim.resume(barista.npcId, TUE_10);
    expect(sim.behaviorAt(barista.npcId, TUE_10).interrupted).toBe(false);
  });

  it('reserves a fixed-identity NPC and rejects a duplicate reservation', () => {
    const sim = makeSim();
    const spec = { name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' };
    const reserved = sim.reserveNPC(spec);
    expect(reserved.name).toEqual(spec.name);
    expect(reserved.job?.parcelId).toBe('p1');
    expect(() => sim.reserveNPC(spec)).toThrowError(expect.objectContaining({ code: 'E_CONFLICT' }));
  });

  it('dead NPCs stop matching queries and reject behavior and flags', () => {
    const sim = makeSim();
    const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    sim.applyFlag(barista.npcId, { kind: 'die' });
    expect(() => sim.getNPCVendor({ parcelId: 'p4', type: 'cafe_barista', timeMin: TUE_10 })).toThrowError(
      SimulationError,
    );
    expect(() => sim.behaviorAt(barista.npcId, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_DEAD' }));
    expect(() => sim.applyFlag(barista.npcId, { kind: 'resign' })).toThrowError(
      expect.objectContaining({ code: 'E_DEAD' }),
    );
    expect(sim.findNPCs({ type: 'cafe_barista' })).toHaveLength(0);
    expect(sim.findNPCs({ type: 'cafe_barista', includeDead: true })).toHaveLength(1);
  });

  it('resign clears the job and rebuilds the routine; custom tags are queryable', () => {
    const sim = makeSim();
    const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
    sim.applyFlag(barista.npcId, { kind: 'resign' });
    const jobless = sim.getNPC(barista.npcId);
    expect(jobless.job).toBeUndefined();
    expect(jobless.routine.some((e) => e.activity === 'working')).toBe(false);
    sim.applyFlag(barista.npcId, { kind: 'custom', tag: 'quest_ally' });
    expect(sim.findNPCs({ flag: 'quest_ally' })).toHaveLength(1);
  });

  it('throws E_UNKNOWN_ID for unknown npc ids', () => {
    expect(() => makeSim().getNPC('npc_nope')).toThrowError(expect.objectContaining({ code: 'E_UNKNOWN_ID' }));
  });
});
