/**
 * Consumed slice of ../simulation's query surface (simulation/src/schemas/npc.ts
 * and crowd.ts). Mirror types plus the SimulationPort interface every quests box
 * codes against; the real CitySimulation satisfies it structurally.
 *
 * Time convention (simulation contract): integer minutes since world epoch,
 * Monday 00:00. Day = floor(t / 1440) % 7, 0 = Monday. Routines repeat weekly.
 */

export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_WEEK = 7;

export type Activity =
  | 'sleeping'
  | 'home'
  | 'working'
  | 'commuting'
  | 'shopping'
  | 'leisure'
  | 'transit_wait';

export type PlaceRef =
  | { kind: 'edge'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'parcel'; id: string }
  | { kind: 'route'; id: string };

export interface NPCName {
  given: string;
  family: string;
}

export interface Shift {
  /** Minute of day; endMin < startMin spans midnight. */
  startMin: number;
  endMin: number;
  /** Work days, 0 = Monday. */
  days: number[];
  kind: 'day' | 'evening' | 'night' | 'rotating';
}

export interface Job {
  parcelId: string;
  role: string;
  shift: Shift;
}

/** Station or vehicle employment. */
export interface TransitJob {
  place: { kind: 'stop' | 'route'; id: string };
  role: string;
  shift: Shift;
}

export interface FamilyMember {
  npcId: string;
  relation: 'partner' | 'child' | 'parent' | 'sibling' | 'roommate';
  name: NPCName;
  instantiated: boolean;
}

export interface RoutineEntry {
  /** Days this entry applies, 0 = Monday. */
  days: number[];
  startMin: number;
  endMin: number;
  activity: Activity;
  place: PlaceRef;
}

export interface NPCFlags {
  dead: boolean;
  custom: string[];
}

export interface NPCInstance {
  npcId: string;
  name: NPCName;
  gender?: 'male' | 'female';
  /** Whole years. */
  age?: number;
  /** Two to four plain words, such as `wary` or `chatty`. */
  traits?: string[];
  type: string;
  home: { parcelId: string; unit: number };
  /** Building employment. */
  job?: Job;
  /** Station or vehicle employment; absent for building workers. */
  transitJob?: TransitJob;
  family: FamilyMember[];
  /** Weekly plan; entries cover the full week with no gaps. */
  routine: RoutineEntry[];
  flags: NPCFlags;
}

export interface BehaviorState {
  mode: 'interior' | 'street' | 'transit' | 'home';
  activity: Activity;
  place: PlaceRef;
  interrupted: boolean;
}

export interface VendorQuery {
  parcelId?: string;
  type?: string;
  role?: string;
  timeMin: number;
}

export interface NPCQuery {
  type?: string;
  districtId?: string;
  parcelId?: string;
  flag?: string;
  includeDead?: boolean;
}

export interface ReservedSpec {
  name: NPCName;
  type: string;
  homeDistrictId?: string;
  jobParcelId?: string;
  role?: string;
}

export type FlagOp =
  | { kind: 'resign' }
  | { kind: 'promote'; toParcelId?: string }
  | { kind: 'die' }
  | { kind: 'custom'; tag: string };

export type SimulationErrorCode =
  | 'E_INVALID_INPUT'
  | 'E_UNKNOWN_ID'
  | 'E_STALE_HANDLE'
  | 'E_NO_MATCH'
  | 'E_DEAD'
  | 'E_CONFLICT'
  | 'E_TIME';

export class SimulationError extends Error {
  constructor(
    readonly code: SimulationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SimulationError';
  }
}

/** The simulation surface the quests layer consumes. */
export interface SimulationPort {
  getNPCVendor(query: VendorQuery): NPCInstance;
  getNPC(npcId: string): NPCInstance;
  findNPCs(query: NPCQuery): NPCInstance[];
  reserveNPC(spec: ReservedSpec): NPCInstance;
  behaviorAt(npcId: string, timeMin: number): BehaviorState;
  interrupt(npcId: string, timeMin: number): void;
  resume(npcId: string, timeMin: number): void;
  applyFlag(npcId: string, op: FlagOp): void;
}
