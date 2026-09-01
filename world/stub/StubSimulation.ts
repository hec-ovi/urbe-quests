/**
 * Deterministic in-memory implementation of the SimulationPort slice the quests
 * layer consumes, faithful to ../simulation/CONTRACT.md semantics: lazy
 * instantiation, stable identities, dead NPCs never match queries, staffing via
 * day (Mon-Sat 08:00-16:00) and evening (daily 16:00-23:30) shifts.
 */

import type { NamedParcel, NamedWorld, NamePool, NPCType, NPCTypeSet } from '../types/named-world.js';
import type {
  BehaviorState,
  FlagOp,
  FamilyMember,
  Job,
  NPCInstance,
  NPCName,
  NPCQuery,
  ReservedSpec,
  Shift,
  SimulationPort,
  VendorQuery,
} from '../types/simulation.js';
import { MINUTES_PER_DAY, DAYS_PER_WEEK, SimulationError } from '../types/simulation.js';
import { Rng } from './rng.js';
import { RoutineBuilder } from './routines.js';

const DAY_SHIFT: Shift = { startMin: 480, endMin: 960, days: [0, 1, 2, 3, 4, 5], kind: 'day' };
const EVENING_SHIFT: Shift = { startMin: 960, endMin: 1410, days: [0, 1, 2, 3, 4, 5, 6], kind: 'evening' };

export interface StubSimulationInput {
  seed: string;
  world: NamedWorld;
  types: NPCTypeSet;
}

export class StubSimulation implements SimulationPort {
  private readonly seed: string;
  private readonly world: NamedWorld;
  private readonly types: NPCType[];
  private readonly namePool: NamePool;
  private readonly npcs = new Map<string, NPCInstance>();
  private readonly slots = new Map<string, string>();
  private readonly interrupted = new Set<string>();
  private counter = 0;

  constructor(input: StubSimulationInput) {
    this.seed = input.seed;
    this.world = input.world;
    this.types = input.types.types;
    this.namePool = input.types.namePool;
  }

  getNPCVendor(query: VendorQuery): NPCInstance {
    const parcels = this.vendorParcels(query);
    const type = this.workerType(query, parcels);
    const role = query.role ?? type.type;
    const shift = this.shiftOnDuty(query.timeMin);
    if (!shift) {
      throw new SimulationError('E_NO_MATCH', `nobody on duty at t=${query.timeMin}`);
    }
    for (const parcel of parcels) {
      const slotKey = `${parcel.id}:${role}:${shift.kind}`;
      const existingId = this.slots.get(slotKey);
      if (existingId !== undefined) {
        const existing = this.npcs.get(existingId)!;
        if (existing.flags.dead) continue;
        return existing;
      }
      const npc = this.instantiateWorker(parcel, type, role, shift, slotKey);
      return npc;
    }
    throw new SimulationError('E_NO_MATCH', 'no living worker matches the query');
  }

  getNPC(npcId: string): NPCInstance {
    const npc = this.npcs.get(npcId);
    if (!npc) throw new SimulationError('E_UNKNOWN_ID', `unknown npc ${npcId}`);
    return npc;
  }

  findNPCs(query: NPCQuery): NPCInstance[] {
    return [...this.npcs.values()].filter((npc) => {
      if (npc.flags.dead && !query.includeDead) return false;
      if (query.type !== undefined && npc.type !== query.type) return false;
      if (query.flag !== undefined && !npc.flags.custom.includes(query.flag)) return false;
      if (query.parcelId !== undefined && npc.home.parcelId !== query.parcelId && npc.job?.parcelId !== query.parcelId) return false;
      if (query.districtId !== undefined) {
        const home = this.parcel(npc.home.parcelId);
        if (home.districtId !== query.districtId) return false;
      }
      return true;
    });
  }

  reserveNPC(spec: ReservedSpec): NPCInstance {
    const duplicate = [...this.npcs.values()].some(
      (npc) => npc.name.given === spec.name.given && npc.name.family === spec.name.family && npc.type === spec.type,
    );
    if (duplicate) {
      throw new SimulationError('E_CONFLICT', `an NPC named ${spec.name.given} ${spec.name.family} of type ${spec.type} already exists`);
    }
    const type = this.typeByName(spec.type);
    const rng = new Rng(`${this.seed}:reserve:${spec.name.given}:${spec.name.family}`);
    const job: Job | undefined = spec.jobParcelId
      ? { parcelId: this.parcel(spec.jobParcelId).id, role: spec.role ?? type.type, shift: DAY_SHIFT }
      : undefined;
    return this.createInstance({ name: spec.name, type, job, homeDistrictId: spec.homeDistrictId, rng });
  }

  behaviorAt(npcId: string, timeMin: number): BehaviorState {
    const npc = this.living(npcId);
    if (timeMin < 0) throw new SimulationError('E_TIME', `negative time ${timeMin}`);
    const day = Math.floor(timeMin / MINUTES_PER_DAY) % DAYS_PER_WEEK;
    const minute = timeMin % MINUTES_PER_DAY;
    const entry = npc.routine.find((e) => e.days.includes(day) && minute >= e.startMin && minute < e.endMin);
    if (!entry) throw new SimulationError('E_TIME', `routine gap for ${npcId} at t=${timeMin}`);
    const mode =
      entry.activity === 'sleeping' || entry.activity === 'home'
        ? 'home'
        : entry.activity === 'commuting'
          ? 'street'
          : entry.activity === 'transit_wait'
            ? 'transit'
            : 'interior';
    return { mode, activity: entry.activity, place: entry.place, interrupted: this.interrupted.has(npcId) };
  }

  interrupt(npcId: string, _timeMin: number): void {
    this.living(npcId);
    this.interrupted.add(npcId);
  }

  resume(npcId: string, _timeMin: number): void {
    this.living(npcId);
    this.interrupted.delete(npcId);
  }

  applyFlag(npcId: string, op: FlagOp): void {
    const npc = this.living(npcId);
    switch (op.kind) {
      case 'resign': {
        npc.job = undefined;
        npc.routine = this.routineFor(npc);
        return;
      }
      case 'promote': {
        if (!npc.job) throw new SimulationError('E_CONFLICT', `promote on jobless npc ${npcId}`);
        npc.job.role = `senior_${npc.job.role}`;
        if (op.toParcelId !== undefined) npc.job.parcelId = this.parcel(op.toParcelId).id;
        npc.routine = this.routineFor(npc);
        return;
      }
      case 'die': {
        npc.flags.dead = true;
        this.interrupted.delete(npcId);
        return;
      }
      case 'custom': {
        if (!npc.flags.custom.includes(op.tag)) npc.flags.custom.push(op.tag);
        return;
      }
    }
  }

  private living(npcId: string): NPCInstance {
    const npc = this.getNPC(npcId);
    if (npc.flags.dead) throw new SimulationError('E_DEAD', `npc ${npcId} is dead`);
    return npc;
  }

  private parcel(parcelId: string): NamedParcel {
    const parcel = this.world.parcels.find((p) => p.id === parcelId);
    if (!parcel) throw new SimulationError('E_UNKNOWN_ID', `unknown parcel ${parcelId}`);
    return parcel;
  }

  private typeByName(type: string): NPCType {
    const found = this.types.find((t) => t.type === type);
    if (!found) throw new SimulationError('E_UNKNOWN_ID', `unknown npc type ${type}`);
    return found;
  }

  private shiftOnDuty(timeMin: number): Shift | undefined {
    if (timeMin < 0) throw new SimulationError('E_TIME', `negative time ${timeMin}`);
    const day = Math.floor(timeMin / MINUTES_PER_DAY) % DAYS_PER_WEEK;
    const minute = timeMin % MINUTES_PER_DAY;
    return [DAY_SHIFT, EVENING_SHIFT].find((s) => s.days.includes(day) && minute >= s.startMin && minute < s.endMin);
  }

  /** Parcels a vendor query can staff, in stable world order. */
  private vendorParcels(query: VendorQuery): NamedParcel[] {
    if (query.parcelId !== undefined) return [this.parcel(query.parcelId)];
    if (query.type === undefined) {
      throw new SimulationError('E_INVALID_INPUT', 'vendor query needs parcelId or type');
    }
    const type = this.typeByName(query.type);
    const districts = new Map(this.world.districts.map((d) => [d.id, d]));
    const matches = this.world.parcels.filter((p) => {
      const g = type.grounding;
      if (g.parcelTypes !== undefined && g.parcelTypes.length > 0 && !g.parcelTypes.includes(p.type)) return false;
      if (g.tiers !== undefined && g.tiers.length > 0 && !g.tiers.includes(p.tier)) return false;
      if (g.districts !== undefined && g.districts.length > 0) {
        const district = districts.get(p.districtId);
        if (!district || !g.districts.includes(district.name)) return false;
      }
      return p.type !== 'residential';
    });
    if (matches.length === 0) throw new SimulationError('E_NO_MATCH', `no parcel matches type ${query.type}`);
    return matches;
  }

  private workerType(query: VendorQuery, parcels: NamedParcel[]): NPCType {
    if (query.type !== undefined) return this.typeByName(query.type);
    const parcelTypes = new Set(parcels.map((p) => p.type));
    const found = this.types.find(
      (t) => t.category !== 'resident' && (t.grounding.parcelTypes ?? []).some((pt) => parcelTypes.has(pt)),
    );
    if (!found) throw new SimulationError('E_NO_MATCH', 'no npc type staffs this parcel');
    return found;
  }

  private instantiateWorker(parcel: NamedParcel, type: NPCType, role: string, shift: Shift, slotKey: string): NPCInstance {
    const rng = new Rng(`${this.seed}:${slotKey}`);
    const name: NPCName = { given: rng.pick(this.namePool.given), family: rng.pick(this.namePool.family) };
    const job: Job = { parcelId: parcel.id, role, shift };
    const npc = this.createInstance({ name, type, job, rng });
    this.slots.set(slotKey, npc.npcId);
    return npc;
  }

  private createInstance(args: {
    name: NPCName;
    type: NPCType;
    job?: Job;
    homeDistrictId?: string;
    rng: Rng;
  }): NPCInstance {
    const { name, type, job, homeDistrictId, rng } = args;
    const home = this.pickHome(type, homeDistrictId, rng);
    const npcId = `npc_${++this.counter}`;
    const npc: NPCInstance = {
      npcId,
      name,
      type: type.type,
      home: { parcelId: home.id, unit: rng.int(40) + 1 },
      job,
      family: this.makeFamily(name, rng),
      routine: [],
      flags: { dead: false, custom: [] },
    };
    npc.routine = this.routineFor(npc, rng);
    this.npcs.set(npcId, npc);
    return npc;
  }

  private pickHome(type: NPCType, homeDistrictId: string | undefined, rng: Rng): NamedParcel {
    const residential = this.world.parcels.filter((p) => p.type === 'residential');
    if (residential.length === 0) throw new SimulationError('E_INVALID_INPUT', 'world has no residential parcels');
    if (homeDistrictId !== undefined) {
      const inDistrict = residential.filter((p) => p.districtId === homeDistrictId);
      if (inDistrict.length === 0) throw new SimulationError('E_NO_MATCH', `no residential parcel in district ${homeDistrictId}`);
      return rng.pick(inDistrict);
    }
    const tiers = type.grounding.tiers ?? [];
    const inTier = tiers.length > 0 ? residential.filter((p) => tiers.includes(p.tier)) : [];
    return rng.pick(inTier.length > 0 ? inTier : residential);
  }

  private makeFamily(name: NPCName, rng: Rng): FamilyMember[] {
    const relations = ['partner', 'child', 'sibling', 'roommate'] as const;
    const count = rng.int(3);
    const family: FamilyMember[] = [];
    for (let i = 0; i < count; i++) {
      family.push({
        npcId: `npc_stub_${++this.counter}`,
        relation: relations[rng.int(relations.length)]!,
        name: { given: rng.pick(this.namePool.given), family: name.family },
        instantiated: false,
      });
    }
    return family;
  }

  private routineFor(npc: NPCInstance, rng?: Rng): typeof npc.routine {
    const leisureCandidates = this.world.parcels.filter((p) =>
      p.type === 'commerce' || p.type === 'restaurant' || p.type === 'mall' || p.type === 'coffee_shop',
    );
    const pickRng = rng ?? new Rng(`${this.seed}:leisure:${npc.npcId}`);
    const leisure = leisureCandidates.length > 0 ? pickRng.pick(leisureCandidates) : this.parcel(npc.home.parcelId);
    return new RoutineBuilder(npc.home.parcelId, leisure.id).build(npc.job);
  }
}
