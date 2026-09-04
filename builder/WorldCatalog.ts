/**
 * The world view the builder agent gets: named places WITH their ids (steps
 * need them) and the NPC type vocabulary. Still no geometry, no statistics.
 */

import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';

export class WorldCatalog {
  constructor(
    private readonly world: NamedWorld,
    private readonly types: NPCTypeSet,
  ) {}

  render(): string {
    const lines: string[] = ['Districts and places (use these ids):'];
    for (const district of this.world.districts) {
      lines.push(`- ${district.name} [districtId ${district.id}] (${district.kind}, ${district.tier.replace('_', ' ')})`);
      for (const parcel of this.world.parcels.filter((p) => p.districtId === district.id)) {
        const name = parcel.name ?? `unnamed ${parcel.type.replace('_', ' ')}`;
        lines.push(`  - ${name} [parcelId ${parcel.id}] (${parcel.type.replace('_', ' ')})`);
      }
    }
    const transit = this.world.transit;
    if (transit !== undefined) {
      lines.push('', 'Transit places (use these ids):');
      for (const stop of transit.busStops ?? []) lines.push(`- ${stop.name ?? 'bus stop'} [stopId ${stop.id}]`);
      for (const station of [...(transit.trainStations ?? []), ...(transit.subwayStations ?? [])]) {
        lines.push(`- ${station.name ?? 'station'} [stationId ${station.id}]`);
      }
    }
    lines.push('', 'NPC types (bind roles to these, never to ids or coordinates):');
    for (const type of this.types.types) {
      lines.push(`- ${type.type} (${type.label}, ${type.category}): ${type.boilerplate}`);
      for (const example of type.examples ?? []) lines.push(`  example: ${example}`);
    }
    return lines.join('\n');
  }
}
