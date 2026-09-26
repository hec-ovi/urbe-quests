/**
 * Plain words for places in dialog prose: the world's names where it has
 * them, descriptions of what a place is where it has none, never an id.
 */

import type { NamedTransitEntity, Tier } from '../world/types/named-world.js';
import { VENUES } from '../world/venues.js';
import type { DialogWorld } from './schema.js';

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

export class PlaceWords {
  constructor(private readonly world: DialogWorld) {}

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
