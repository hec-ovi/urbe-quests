/**
 * Renders an NPC's deterministic simulation background (who they are, home,
 * job, family, routine) as second-person prose facts. This is the
 * mathematical life the persona is layered on; nothing here is invented.
 */

import { promptLoader } from '../prompts.js';
import type { NPCInstance } from '../world/types/simulation.js';
import { listed, PlaceWords, withArticle } from './places.js';
import { clock, dayName } from './time.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

/** What people call someone of this gender: a child, a teenager, an adult. */
const NOUNS = { male: ['boy', 'teenage boy', 'man'], female: ['girl', 'teenage girl', 'woman'] } as const;

export class BackgroundRenderer {
  constructor(private readonly places: PlaceWords) {}

  render(npc: NPCInstance): string {
    const who = person(npc);
    const lines = [who === undefined ? prompt('background.md#identity', { ...npc.name }) : prompt('background.md#person', { ...npc.name, who })];
    if (npc.traits !== undefined && npc.traits.length > 0) lines.push(prompt('background.md#traits', { traits: listed(npc.traits) }));
    lines.push(prompt('background.md#home', { home: this.places.parcel(npc.home.parcelId), unit: npc.home.unit }));
    if (npc.job) {
      const days = this.days(npc.job.shift.days);
      const hours = `${clock(npc.job.shift.startMin)} to ${clock(npc.job.shift.endMin)}`;
      lines.push(prompt('background.md#job', { place: this.places.parcel(npc.job.parcelId), role: npc.job.role.replace(/_/g, ' '), days, hours }));
    } else {
      lines.push(prompt('background.md#jobless'));
    }
    for (const member of npc.family) {
      lines.push(prompt('background.md#family', { ...member.name, relation: member.relation }));
    }
    const leisure = new Set(
      npc.routine
        .filter((e) => (e.activity === 'leisure' || e.activity === 'shopping') && e.place.kind === 'parcel')
        .map((e) => this.places.parcel(e.place.id)),
    );
    if (leisure.size > 0) {
      lines.push(prompt('background.md#leisure', { places: [...leisure].join('; ') }));
    }
    return lines.join('\n');
  }

  private days(days: number[]): string {
    if (days.length === 7) return 'every day';
    return listed(days.map(dayName));
  }
}

/** "a 42-year-old woman", "a man", "42 years old", or nothing when Simulation gave neither fact. */
function person(npc: NPCInstance): string | undefined {
  const { age, gender } = npc;
  const noun = gender && NOUNS[gender][age === undefined || age >= 18 ? 2 : age >= 13 ? 1 : 0];
  if (age === undefined) return noun && withArticle(noun);
  return noun ? withArticle(`${age}-year-old ${noun}`) : `${age} years old`;
}
