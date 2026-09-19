/**
 * What a building is called and who works in it. Parcel types carry the venue
 * word a place record falls back to when the world has no name, the staffing
 * roles the interior publishes for that kind of building
 * (../../interior/schemas/npc.schema.json), and the posts those roles are held
 * on. Quests picks story venues and story hours from this table.
 */

import type { NamedWorld, NPCType, NPCTypeCategory, ParcelType } from './types/named-world.js';

/** Interior's published staffing vocabulary. */
export type StaffRole =
  | 'receptionist' | 'security' | 'vendor' | 'barista' | 'waiter' | 'cook' | 'clerk'
  | 'office_worker' | 'executive' | 'cleaner' | 'resident' | 'trainer' | 'guest';

/** The shifts a post is held on, in the simulation's weekly minutes (0 = Monday). */
export type Post = 'day' | 'evening';

export interface PostWindow {
  days: number[];
  startMin: number;
  endMin: number;
}

export const POST_WINDOWS: Record<Post, PostWindow> = {
  day: { days: [0, 1, 2, 3, 4, 5], startMin: 480, endMin: 960 },
  evening: { days: [0, 1, 2, 3, 4, 5, 6], startMin: 960, endMin: 1410 },
};

export interface Venue {
  /** What to call the place when the world gives it no name. */
  word: string;
  roles: StaffRole[];
  posts: Post[];
}

export const VENUES: Record<ParcelType, Venue> = {
  residential: { word: 'apartment block', roles: ['resident', 'cleaner', 'security'], posts: ['day'] },
  hotel: { word: 'hotel', roles: ['receptionist', 'waiter', 'security', 'cleaner', 'guest'], posts: ['day', 'evening'] },
  offices: { word: 'office building', roles: ['office_worker', 'receptionist', 'clerk', 'security', 'cleaner'], posts: ['day'] },
  corpo: { word: 'corporate tower', roles: ['executive', 'office_worker', 'receptionist', 'security', 'cleaner'], posts: ['day'] },
  hospital: { word: 'hospital', roles: ['receptionist', 'clerk', 'security', 'cleaner'], posts: ['day', 'evening'] },
  clinic: { word: 'clinic', roles: ['receptionist', 'clerk', 'cleaner'], posts: ['day'] },
  police: { word: 'police station', roles: ['security', 'clerk', 'office_worker'], posts: ['day', 'evening'] },
  military: { word: 'compound', roles: ['security', 'clerk', 'office_worker'], posts: ['day', 'evening'] },
  factory: { word: 'factory', roles: ['clerk', 'office_worker', 'security', 'cleaner'], posts: ['day', 'evening'] },
  commerce: { word: 'shop', roles: ['vendor', 'clerk', 'cleaner'], posts: ['day', 'evening'] },
  mall: { word: 'mall', roles: ['vendor', 'clerk', 'security', 'cleaner', 'guest'], posts: ['day', 'evening'] },
  restaurant: { word: 'restaurant', roles: ['waiter', 'cook', 'vendor', 'cleaner'], posts: ['day', 'evening'] },
  coffee_shop: { word: 'coffee shop', roles: ['barista', 'vendor', 'cleaner'], posts: ['day', 'evening'] },
};

/** Staffing an NPC type can hold, by the category Naming gave it. */
const CATEGORY_ROLES: Record<NPCTypeCategory, StaffRole[]> = {
  vendor: ['vendor', 'barista', 'waiter', 'cook', 'clerk'],
  worker: ['office_worker', 'executive', 'clerk', 'receptionist', 'cook', 'cleaner'],
  authority: ['security'],
  resident: ['resident'],
  street: [],
  transit: [],
};

/** Canonical order, so reading a role out of story text is deterministic. */
const ROLE_WORDS: [StaffRole, string[]][] = [
  ['barista', ['barista']],
  ['waiter', ['waiter', 'waitress', 'server']],
  ['cook', ['cook', 'chef', 'kitchen hand']],
  ['vendor', ['vendor', 'seller', 'stallholder', 'shopkeeper']],
  ['clerk', ['clerk', 'cashier', 'teller']],
  ['receptionist', ['receptionist', 'front desk']],
  ['security', ['security', 'guard', 'officer', 'bouncer']],
  ['executive', ['executive', 'director', 'ceo', 'boss']],
  ['office_worker', ['office worker', 'analyst', 'clerk typist', 'desk worker']],
  ['cleaner', ['cleaner', 'janitor', 'sweeper']],
  ['trainer', ['trainer', 'coach']],
  ['resident', ['resident', 'tenant', 'neighbour', 'neighbor']],
  ['guest', ['guest', 'lodger']],
];

export const venueOf = (type: ParcelType): Venue => VENUES[type];

/** Staffing this NPC type can hold, narrowed to the one its own words name when they do. */
export function staffRoles(type: NPCType, text = ''): StaffRole[] {
  const allowed = CATEGORY_ROLES[type.category];
  const haystack = `${type.type} ${type.label} ${text}`.toLowerCase().replace(/_/g, ' ');
  const named = ROLE_WORDS.find(([role, words]) => allowed.includes(role) && words.some((word) => haystack.includes(word)));
  return named === undefined ? allowed : [named[0]];
}

/** Does this kind of building publish a post any of those roles can hold? */
export const staffs = (parcelType: ParcelType, roles: StaffRole[]): boolean =>
  roles.some((role) => VENUES[parcelType].roles.includes(role));

/** The name a place record carries: the world's own name, else the venue word for what it is. */
export function venueName(world: NamedWorld, place: Record<string, unknown>): string {
  const id = (key: string): string | undefined => (typeof place[key] === 'string' ? (place[key] as string) : undefined);
  const parcelId = id('parcelId');
  if (parcelId !== undefined) {
    const parcel = world.parcels.find((p) => p.id === parcelId);
    return parcel?.name ?? (parcel === undefined ? parcelId : VENUES[parcel.type].word);
  }
  const districtId = id('districtId');
  if (districtId !== undefined) {
    return world.districts.find((d) => d.id === districtId)?.name ?? districtId;
  }
  const stationId = id('stationId');
  if (stationId !== undefined) {
    const stations = [...(world.transit?.trainStations ?? []), ...(world.transit?.subwayStations ?? [])];
    return stations.find((s) => s.id === stationId)?.name ?? 'station';
  }
  const stopId = id('stopId');
  if (stopId !== undefined) {
    return (world.transit?.busStops ?? []).find((s) => s.id === stopId)?.name ?? 'bus stop';
  }
  return 'unknown place';
}
