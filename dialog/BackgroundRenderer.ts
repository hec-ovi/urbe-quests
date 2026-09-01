/**
 * Renders an NPC's deterministic simulation background (home, job, family,
 * routine) as second-person prose facts. This is the mathematical life the
 * persona is layered on; nothing here is invented.
 */

import type { NamedWorld } from '../world/types/named-world.js';
import type { NPCInstance } from '../world/types/simulation.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class BackgroundRenderer {
  constructor(private readonly world: NamedWorld) {}

  render(npc: NPCInstance): string {
    const lines: string[] = [];
    lines.push(`You are ${npc.name.given} ${npc.name.family}.`);
    lines.push(`You live at ${this.place(npc.home.parcelId)}, unit ${npc.home.unit}.`);
    if (npc.job) {
      const days = this.days(npc.job.shift.days);
      const hours = `${clock(npc.job.shift.startMin)} to ${clock(npc.job.shift.endMin)}`;
      lines.push(`You work at ${this.place(npc.job.parcelId)} as ${npc.job.role.replace(/_/g, ' ')}, ${days} from ${hours}.`);
    } else {
      lines.push('You have no job at the moment.');
    }
    for (const member of npc.family) {
      lines.push(`Your ${member.relation} is ${member.name.given} ${member.name.family}.`);
    }
    const leisure = new Set(
      npc.routine
        .filter((e) => (e.activity === 'leisure' || e.activity === 'shopping') && e.place.kind === 'parcel')
        .map((e) => this.place(e.place.id)),
    );
    if (leisure.size > 0) {
      lines.push(`In your free time you tend to be at ${[...leisure].join(', ')}.`);
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
    return days.map((d) => DAY_NAMES[d] ?? `day ${d}`).join(', ');
  }
}

function clock(minuteOfDay: number): string {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const m = String(minuteOfDay % 60).padStart(2, '0');
  return `${h}:${m}`;
}
