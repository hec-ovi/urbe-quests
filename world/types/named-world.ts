/**
 * Compatible consumer projections of Naming's named-world and NPC type set outputs.
 * Naming output fits directly; the local pre-naming Atlas fallback supplies only
 * the fields Quests reads.
 */

export type Tier = 'poor' | 'mid' | 'rich' | 'high_rich';

export type ParcelType =
  | 'residential'
  | 'hotel'
  | 'offices'
  | 'corpo'
  | 'hospital'
  | 'clinic'
  | 'police'
  | 'military'
  | 'factory'
  | 'commerce'
  | 'mall'
  | 'restaurant'
  | 'coffee_shop'
  | 'park';

export interface NamedDistrict {
  id: string;
  kind: 'downtown' | 'commercial' | 'residential' | 'industrial' | 'mixed';
  tier: Tier;
  name: string;
}

export interface NamedParcel {
  id: string;
  districtId: string;
  type: ParcelType;
  tier: Tier;
  name?: string;
  /** Atlas lot outline in world XZ, carried through Naming; dialog measures what is near a person with it. */
  lot?: [number, number][];
  /** Atlas access: the street edge the lot fronts and the point where it meets it. */
  access?: { edgeId: string; point: [number, number] };
}

/** Named world's transit identities. Geometry stays in Atlas and Connections. */
export interface NamedTransitEntity {
  id: string;
  districtId?: string;
  name?: string;
  /** Atlas stop or station position in world XZ, when the world carries it. */
  position?: [number, number];
}

export interface NamedTransit {
  busStops?: NamedTransitEntity[];
  busRoutes?: NamedTransitEntity[];
  trainStations?: NamedTransitEntity[];
  trainLines?: NamedTransitEntity[];
  subwayStations?: NamedTransitEntity[];
  subwayLines?: NamedTransitEntity[];
}

export interface NamedWorld {
  meta: {
    seed: string | number;
    naming: { theme: string; model?: string; namedAt: string };
  };
  districts: NamedDistrict[];
  parcels: NamedParcel[];
  /** Naming preserves only transit collections present in the source world. */
  transit?: NamedTransit;
}

export type NPCTypeCategory = 'resident' | 'worker' | 'vendor' | 'authority' | 'transit' | 'street';

export interface NPCType {
  type: string;
  label: string;
  category: NPCTypeCategory;
  boilerplate: string;
  examples?: string[];
  grounding: { districts?: string[]; parcelTypes?: ParcelType[]; tiers?: Tier[] };
  weight: number;
}

export type NameGender = 'male' | 'female' | 'neutral';

/** Themed personal name pool; names repeat across NPCs by design. Min 20 each. */
export interface NamePool {
  given: string[];
  /** Required by Naming output; optional only for Quests' standalone fallback fixtures. */
  givenByGender?: Record<NameGender, string[]>;
  family: string[];
}

export interface NPCTypeSet {
  meta: { theme: string; worldSeed: string | number; createdAt: string; model?: string };
  types: NPCType[];
  namePool: NamePool;
}

/** Atlas fields consumed when Quests materializes before a Naming pass exists. */
export interface AtlasQuestWorld {
  meta: { seed: string | number };
  districts: Array<Omit<NamedDistrict, 'name'> & { name?: string }>;
  parcels: NamedParcel[];
  transit?: NamedTransit;
}
