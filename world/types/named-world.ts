/**
 * Consumed slice of ../naming's outputs (naming/schema/world-state.schema.json
 * and naming/schema/npc-types.schema.json). Mirror types; a real naming output
 * satisfies them structurally.
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
  | 'coffee_shop';

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
}

/** Named world's transit identities. Geometry stays in Atlas and Connections. */
export interface NamedTransitEntity {
  id: string;
  districtId?: string;
  name?: string;
}

export interface NamedTransit {
  busStops: NamedTransitEntity[];
  busRoutes: NamedTransitEntity[];
  trainStations: NamedTransitEntity[];
  trainLines: NamedTransitEntity[];
  subwayStations: NamedTransitEntity[];
  subwayLines: NamedTransitEntity[];
}

export interface NamedWorld {
  meta: {
    seed: string | number;
    naming: { theme: string; model?: string; namedAt: string };
  };
  districts: NamedDistrict[];
  parcels: NamedParcel[];
  /** Optional only for compatibility with the early fixtures. Full named worlds carry it. */
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

/** Themed personal name pool; names repeat across NPCs by design. Min 20 each. */
export interface NamePool {
  given: string[];
  family: string[];
}

export interface NPCTypeSet {
  meta: { theme: string; worldSeed: string | number; createdAt: string; model?: string };
  types: NPCType[];
  namePool: NamePool;
}
