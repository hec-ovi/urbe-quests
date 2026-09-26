/**
 * Plain words for places in dialog prose: the world's names where it has
 * them, descriptions of what a place is where it has none, never an id.
 */

import type { Tier } from '../world/types/named-world.js';
import { VENUES } from '../world/venues.js';
import type { DialogWorld } from './schema.js';

const TIERS: Record<Tier, string> = { poor: 'poor', mid: 'modest', rich: 'well-off', high_rich: 'wealthy' };
const KINDS: Record<DialogWorld['districts'][number]['kind'], string> = {
  downtown: 'downtown',
  commercial: 'commercial',
  residential: 'residential',
  industrial: 'industrial',
  mixed: 'mixed-use',
};

export class PlaceWords {
  constructor(private readonly world: DialogWorld) {}

  /** "Static Cafe in Kanaal Market", "an apartment block in a poor residential district". */
  parcel(parcelId: string): string {
    const parcel = this.world.parcels.find((p) => p.id === parcelId);
    if (!parcel) return 'a place outside the city';
    return `${parcel.name ?? this.building(parcelId)} in ${this.district(parcel.districtId)}`;
  }

  /** What kind of building a parcel is: "a coffee shop". */
  building(parcelId: string): string {
    const type = this.world.parcels.find((p) => p.id === parcelId)?.type;
    return type === undefined ? 'a place' : withArticle(VENUES[type]?.word ?? type.replace(/_/g, ' '));
  }

  /** A district's name, else what it is: "a poor industrial district". */
  district(districtId: string): string {
    const district = this.world.districts.find((d) => d.id === districtId);
    if (!district) return 'the city';
    return district.name ?? withArticle(`${TIERS[district.tier]} ${KINDS[district.kind]} district`);
  }

  /** The districts the world has named, in world order. */
  namedDistricts(): string[] {
    return this.world.districts.flatMap((d) => (d.name === undefined ? [] : [d.name]));
  }

  /** A stop or station's name, when the world gives it one. */
  stop(stopId: string): string | undefined {
    const transit = this.world.transit ?? {};
    return [...(transit.busStops ?? []), ...(transit.trainStations ?? []), ...(transit.subwayStations ?? [])]
      .find((stop) => stop.id === stopId)?.name;
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
