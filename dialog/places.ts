/**
 * Plain words for places in dialog prose: the world's names where it has
 * them, descriptions of what a place is where it has none, never an id.
 */

import type { NamedParcel, NamedTransitEntity, Tier } from '../world/types/named-world.js';
import { StreetNames, toPath, type StreetSpot } from '../world/streets.js';
import { VENUES } from '../world/venues.js';
import type { DialogHere, DialogWorld } from './schema.js';

/** A place dialog can speak of: a building parcel, or a stop or station. */
export interface PlaceKey {
  kind: 'parcel' | 'stop';
  id: string;
}

interface Place {
  name?: string;
  /** What it is: "a coffee shop", "a subway station". */
  what: string;
  /** Where it is: a district's name or description. */
  where: string;
}

const TIERS: Record<Tier, string> = { poor: 'poor', mid: 'modest', rich: 'well-off', high_rich: 'wealthy' };
const KINDS: Record<DialogWorld['districts'][number]['kind'], string> = {
  downtown: 'downtown',
  commercial: 'commercial',
  residential: 'residential',
  industrial: 'industrial',
  mixed: 'mixed-use',
};
const STOPS = { busStops: 'a bus stop', trainStations: 'a train station', subwayStations: 'a subway station' } as const;
const UNKNOWN: Record<PlaceKey['kind'], string> = { parcel: 'a place outside the city', stop: 'a transit stop' };
/** How far around a person the places they would mention reach, in metres. */
const AROUND = 100;
/** Most places a person names around them. */
const AROUND_COUNT = 6;
/** A building this near a person's feet is the one they stand at. */
const AT_BUILDING = 12;
/** Compass points from north (-z), clockwise. */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Where a person stands and what is around them, in words: see PlaceWords.surroundings. */
export interface Surroundings {
  /** "on Third Street near the corner of First Avenue, in Kanaal Market". */
  where: string;
  /** "inside Static Cafe, a coffee shop, on the ground floor" or "outside Static Cafe, a coffee shop". */
  at?: string;
  /** "Kanaal Mall, a mall, about 40 metres to the north". */
  around: string[];
}

export class PlaceWords {
  readonly streets: StreetNames;

  constructor(private readonly world: DialogWorld) {
    this.streets = new StreetNames(world.streets, world.meta.gridAngle ?? 0);
  }

  /**
   * A building with its street: "Static Cafe, a coffee shop on Third Street
   * near the corner of First Avenue, in Kanaal Market". Without street
   * geometry, as `named`.
   */
  addressed(key: PlaceKey): string {
    const place = this.find(key);
    if (!place) return UNKNOWN[key.kind];
    const street = this.streetOf(key);
    if (!street) return this.place(key);
    const what = `${place.what} ${street}`;
    return place.name === undefined ? `${what}, in ${place.where}` : `${place.name}, ${what}, in ${place.where}`;
  }

  /** A place by the name the player sees on it: "Static Cafe", else what it is, "a coffee shop". */
  short(key: PlaceKey): string {
    const place = this.find(key);
    return place ? place.name ?? place.what : UNKNOWN[key.kind];
  }

  /** "Third Street, in Kanaal Market": a street by its StreetNames id, or undefined. */
  street(id: string): string | undefined {
    const street = this.streets.byId(id);
    if (!street) return undefined;
    const edge = this.world.streets?.edges.find((candidate) => street.edgeIds.includes(candidate.id));
    const mid = edge?.path[Math.floor(edge.path.length / 2)];
    const district = mid ? this.districtAt(mid[0], mid[1]) : undefined;
    return district ? `${street.name}, in ${district}` : street.name;
  }

  /**
   * Where a point is, in words: the street and the corner nearest it, the
   * building it is in or stands at, and the places within AROUND metres by
   * name and kind, with how far and which way.
   */
  surroundings(here: DialogHere): Surroundings | undefined {
    const spot = this.streets.near(here.x, here.z);
    const districtId = this.parcelAt(here.x, here.z, 0)?.districtId ?? this.nearestParcel(here.x, here.z)?.districtId;
    const district = this.district(districtId);
    if (!spot && districtId === undefined) return undefined;
    const where = spot ? `${spotWords(spot)}, in ${district}` : `in ${district}`;
    const inside = here.parcelId === undefined ? undefined : this.world.parcels.find((p) => p.id === here.parcelId);
    const beside = inside ? undefined : this.parcelAt(here.x, here.z, AT_BUILDING);
    const floor = here.floor === undefined ? '' : here.floor === 0 ? ', on the ground floor' : `, on the ${ordinal(here.floor)} floor`;
    const at = inside ? `inside ${this.label(inside)}${floor}` : beside ? `outside ${this.label(beside)}` : undefined;
    const skip = new Set([inside?.id, beside?.id]);
    const closed = new Set(this.world.closed ?? []);
    const near: Array<{ words: string; metres: number }> = [];
    for (const parcel of this.world.parcels) {
      // A building nobody can go into is no place to mention going to.
      if (skip.has(parcel.id) || !parcel.lot || closed.has(parcel.id)) continue;
      if (parcel.type === 'residential' && parcel.name === undefined) continue;
      const metres = toLot(parcel.lot, [here.x, here.z]);
      if (metres > AROUND) continue;
      near.push({ words: `${this.label(parcel)}, ${away(metres, here, centre(parcel.lot))}`, metres });
    }
    for (const [collection, what] of Object.entries(STOPS) as [keyof typeof STOPS, string][]) {
      for (const stop of this.world.transit?.[collection] ?? []) {
        if (!stop.position) continue;
        const metres = Math.hypot(stop.position[0] - here.x, stop.position[1] - here.z);
        if (metres > AROUND) continue;
        near.push({ words: `${stop.name === undefined ? what : `${stop.name}, ${what}`}, ${away(metres, here, stop.position)}`, metres });
      }
    }
    near.sort((a, b) => a.metres - b.metres || a.words.localeCompare(b.words));
    return { where, ...(at ? { at } : {}), around: near.slice(0, AROUND_COUNT).map((entry) => entry.words) };
  }

  /** " on Third Street near the corner of First Avenue" for a building or stop, or undefined without streets. */
  private streetOf(key: PlaceKey): string | undefined {
    if (key.kind === 'parcel') {
      const parcel = this.world.parcels.find((p) => p.id === key.id);
      const point = parcel?.access?.point ?? (parcel?.lot ? centre(parcel.lot) : undefined);
      const spot = point && this.streets.near(point[0], point[1], parcel?.access?.edgeId);
      return spot ? spotWords(spot) : undefined;
    }
    for (const collection of Object.keys(STOPS) as (keyof typeof STOPS)[]) {
      const stop = this.world.transit?.[collection]?.find((s) => s.id === key.id);
      const spot = stop?.position && this.streets.near(stop.position[0], stop.position[1]);
      if (spot) return spotWords(spot);
    }
    return undefined;
  }

  /** "Static Cafe, a coffee shop" or "a coffee shop". */
  private label(parcel: NamedParcel): string {
    const what = withArticle(VENUES[parcel.type]?.word ?? parcel.type.replace(/_/g, ' '));
    return parcel.name === undefined ? what : `${parcel.name}, ${what}`;
  }

  /** The parcel whose lot holds the point or lies within `reach` of it, nearest first. */
  private parcelAt(x: number, z: number, reach: number): NamedParcel | undefined {
    let best: { parcel: NamedParcel; metres: number } | undefined;
    for (const parcel of this.world.parcels) {
      if (!parcel.lot) continue;
      const metres = toLot(parcel.lot, [x, z]);
      if (metres <= reach && (!best || metres < best.metres)) best = { parcel, metres };
    }
    return best?.parcel;
  }

  private nearestParcel(x: number, z: number): NamedParcel | undefined {
    return this.parcelAt(x, z, Infinity);
  }

  private districtAt(x: number, z: number): string | undefined {
    const parcel = this.nearestParcel(x, z);
    return parcel ? this.district(parcel.districtId) : undefined;
  }

  /** "Static Cafe in Kanaal Market", "an apartment block in a poor residential district", "a bus stop in Rustfields". */
  place(key: PlaceKey): string {
    const place = this.find(key);
    return place ? `${place.name ?? place.what} in ${place.where}` : UNKNOWN[key.kind];
  }

  /** The place under the name the player knows, then what and where it is: "the precinct, a police station in Kanaal Market". */
  named(key: PlaceKey, name?: string): string {
    const place = this.find(key);
    if (!place) return name ?? UNKNOWN[key.kind];
    const called = name ?? place.name;
    return called === undefined ? `${place.what} in ${place.where}` : `${called}, ${place.what} in ${place.where}`;
  }

  /** The districts the world has named, in world order. */
  namedDistricts(): string[] {
    return this.world.districts.flatMap((d) => (d.name === undefined ? [] : [d.name]));
  }

  private find(key: PlaceKey): Place | undefined {
    if (key.kind === 'parcel') {
      const parcel = this.world.parcels.find((p) => p.id === key.id);
      if (!parcel) return undefined;
      const what = withArticle(VENUES[parcel.type]?.word ?? parcel.type.replace(/_/g, ' '));
      return { ...(parcel.name === undefined ? {} : { name: parcel.name }), what, where: this.district(parcel.districtId) };
    }
    for (const [collection, what] of Object.entries(STOPS) as [keyof typeof STOPS, string][]) {
      const stop: NamedTransitEntity | undefined = this.world.transit?.[collection]?.find((s) => s.id === key.id);
      if (stop) return { ...(stop.name === undefined ? {} : { name: stop.name }), what, where: this.district(stop.districtId) };
    }
    return undefined;
  }

  /** A district's name, else what it is: "a poor industrial district". */
  private district(districtId: string | undefined): string {
    const district = this.world.districts.find((d) => d.id === districtId);
    if (!district) return 'the city';
    return district.name ?? withArticle(`${TIERS[district.tier]} ${KINDS[district.kind]} district`);
  }
}

/** "a man", "an office building", "an 18-year-old": the article as it is spoken. */
export function withArticle(phrase: string): string {
  return `${/^([aeiou]|8|11\D|18\D)/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

/** "quiet", "quiet and warm", "quiet, warm and curious". */
export function listed(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "on Third Street near the corner of First Avenue", "in an alley off Third Street", "on Third Street". */
function spotWords(spot: StreetSpot): string {
  const on = spot.alley ? `in an alley off ${spot.street.name}` : `on ${spot.street.name}`;
  if (!spot.cross) return on;
  return spot.crossMetres !== undefined && spot.crossMetres < 25
    ? `${on} at the corner of ${spot.cross.name}`
    : `${on} near the corner of ${spot.cross.name}`;
}

/** "about 40 metres to the north", "right beside you". */
function away(metres: number, here: DialogHere, [x, z]: [number, number]): string {
  if (metres < 8) return 'right beside you';
  const turns = Math.atan2(x - here.x, here.z - z) / (2 * Math.PI);
  const point = COMPASS[(Math.round(turns * COMPASS.length) + COMPASS.length) % COMPASS.length];
  return `about ${Math.max(10, Math.round(metres / 10) * 10)} metres to the ${point}`;
}

/** "second", "tenth", "21st". */
export function ordinal(n: number): string {
  const words = ['ground', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  if (n < words.length) return words[n]!;
  const tens = n % 100;
  const end = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${end}`;
}

function centre(lot: [number, number][]): [number, number] {
  const sum = lot.reduce((acc, [x, z]) => [acc[0] + x, acc[1] + z], [0, 0]);
  return [sum[0] / lot.length, sum[1] / lot.length];
}

/** 0 inside the lot, else the distance to its outline. */
function toLot(lot: [number, number][], point: [number, number]): number {
  return inside(lot, point) ? 0 : toPath([...lot, lot[0]!], point);
}

function inside(polygon: [number, number][], [x, z]: [number, number]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

