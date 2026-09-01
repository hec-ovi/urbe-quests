/**
 * The only world view the story pass sees: names, kinds and tiers, no
 * geometry, no statistics. Context isolation is the point.
 */

import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';

export class WorldBrief {
  constructor(
    private readonly world: NamedWorld,
    private readonly types: NPCTypeSet,
  ) {}

  render(): string {
    const lines: string[] = ['Districts:'];
    for (const district of this.world.districts) {
      lines.push(`- ${district.name} (${district.kind}, ${district.tier.replace('_', ' ')})`);
      const places = this.world.parcels.filter((p) => p.districtId === district.id && p.name !== undefined);
      for (const place of places) {
        lines.push(`  - ${place.name} (${place.type.replace('_', ' ')})`);
      }
    }
    lines.push('', 'People of this city (types):');
    for (const type of this.types.types) {
      lines.push(`- ${type.label}: ${type.boilerplate}`);
    }
    return lines.join('\n');
  }
}
