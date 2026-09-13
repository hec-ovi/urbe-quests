/**
 * Renders an NPC's deterministic simulation background (home, job, family,
 * routine) as second-person prose facts. This is the mathematical life the
 * persona is layered on; nothing here is invented.
 */

import { promptLoader } from '../prompts.js';
import type { NamedWorld } from '../world/types/named-world.js';
import type { NPCInstance } from '../world/types/simulation.js';
import { clock, dayName } from './time.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class BackgroundRenderer {
  constructor(private readonly world: NamedWorld) {}

  render(npc: NPCInstance): string {
    const lines: string[] = [];
    lines.push(prompt('background.md#identity', { ...npc.name, home: this.place(npc.home.parcelId), unit: npc.home.unit }));
    if (npc.job) {
      const days = this.days(npc.job.shift.days);
      const hours = `${clock(npc.job.shift.startMin)} to ${clock(npc.job.shift.endMin)}`;
      lines.push(prompt('background.md#job', { place: this.place(npc.job.parcelId), role: npc.job.role.replace(/_/g, ' '), days, hours }));
    } else {
      lines.push(prompt('background.md#jobless'));
    }
    for (const member of npc.family) {
      lines.push(prompt('background.md#family', { ...member.name, relation: member.relation }));
    }
    const leisure = new Set(
      npc.routine
        .filter((e) => (e.activity === 'leisure' || e.activity === 'shopping') && e.place.kind === 'parcel')
        .map((e) => this.place(e.place.id)),
    );
    if (leisure.size > 0) {
      lines.push(prompt('background.md#leisure', { places: [...leisure].join(', ') }));
    }
    return lines.join('\n');
  }

  private place(parcelId: string): string {
    const parcel = this.world.parcels.find((p) => p.id === parcelId);
    if (!parcel) return 'a place outside the city';
    const district = this.world.districts.find((d) => d.id === parcel.districtId);
    const name = parcel.name ?? `a ${parcel.type.replace('_', ' ')}`;
    return district ? `${name} in ${district.name}` : name;
  }

  private days(days: number[]): string {
    if (days.length === 7) return 'every day';
    return days.map(dayName).join(', ');
  }
}
