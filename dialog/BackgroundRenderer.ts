/**
 * Renders an NPC's deterministic simulation background (who they are, what
 * they look like, home, work, family, their day, how they take to strangers)
 * as second-person prose facts. This is the mathematical life the persona is
 * layered on; nothing here is invented.
 */

import { promptLoader } from '../prompts.js';
import { dispositionOf } from '../world/disposition.js';
import type { NPCTypeCategory } from '../world/types/named-world.js';
import type { NPCInstance, RoutineEntry } from '../world/types/simulation.js';
import { listed, ordinal, PlaceWords, withArticle } from './places.js';
import type { DialogLook } from './schema.js';
import { clock, dayName } from './time.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

/** What people call someone of this gender: a child, a teenager, an adult. */
const NOUNS = { male: ['boy', 'teenage boy', 'man'], female: ['girl', 'teenage girl', 'woman'] } as const;
/** How a day's stretch reads: "asleep at home", "at work at Static Cafe". */
const DOING: Partial<Record<RoutineEntry['activity'], string>> = {
  sleeping: 'asleep at home',
  home: 'at home',
  working: 'at work',
  shopping: 'out shopping',
  leisure: 'out on your own time',
};

export interface BackgroundOptions {
  /** The minute now: the day it falls on is the day the background tells. */
  timeMin?: number;
  look?: DialogLook;
  /** The person's type category, which colours how they take to strangers. */
  category?: NPCTypeCategory;
}

export class BackgroundRenderer {
  constructor(private readonly places: PlaceWords) {}

  render(npc: NPCInstance, options: BackgroundOptions = {}): string {
    const who = person(npc);
    const lines = [who === undefined ? prompt('background.md#identity', { ...npc.name }) : prompt('background.md#person', { ...npc.name, who })];
    if (npc.traits !== undefined && npc.traits.length > 0) lines.push(prompt('background.md#traits', { traits: listed(npc.traits) }));
    if (options.look) lines.push(look(options.look));
    lines.push(this.home(npc));
    lines.push(this.work(npc));
    for (const member of npc.family) {
      lines.push(prompt('background.md#family', { ...member.name, relation: member.relation }));
    }
    const leisure = new Set(
      npc.routine
        .filter((e) => (e.activity === 'leisure' || e.activity === 'shopping') && e.place.kind === 'parcel')
        .map((e) => this.places.place({ kind: 'parcel', id: e.place.id })),
    );
    if (leisure.size > 0) {
      lines.push(prompt('background.md#leisure', { places: [...leisure].join('; ') }));
    }
    if (options.timeMin !== undefined) {
      const today = this.today(npc, options.timeMin);
      if (today) lines.push(today);
    }
    lines.push(prompt(`background.md#disposition-${dispositionOf(npc, options.category)}`));
    return lines.join('\n');
  }

  /** The building, its street and, in a building the game opened, the apartment with its number and floor. */
  private home(npc: NPCInstance): string {
    const home = this.places.addressed({ kind: 'parcel', id: npc.home.parcelId });
    const apartment = npc.home.apartment;
    if (!apartment) return prompt('background.md#home', { home, unit: npc.home.unit });
    const floor = ordinal(apartment.floor);
    return apartment.number === undefined
      ? prompt('background.md#home-dwelling', { home, floor })
      : prompt('background.md#home-apartment', { home, floor, number: apartment.number });
  }

  /** Where and when this person works: a building with its street, a stop or station, or the transit lines. */
  private work(npc: NPCInstance): string {
    const job = npc.job ?? npc.transitJob;
    if (job === undefined) return prompt('background.md#jobless');
    const shift = {
      role: job.role.replace(/_/g, ' '),
      days: this.days(job.shift.days),
      hours: `${clock(job.shift.startMin)} to ${clock(job.shift.endMin)}`,
    };
    const place = 'parcelId' in job
      ? this.places.addressed({ kind: 'parcel', id: job.parcelId })
      : job.place.kind === 'stop' ? this.places.place({ kind: 'stop', id: job.place.id }) : undefined;
    return place === undefined ? prompt('background.md#route-job', shift) : prompt('background.md#job', { ...shift, place });
  }

  /**
   * The day `timeMin` falls on, stretch by stretch: "asleep at home until
   * 06:40; at work at Static Cafe from 08:00 to 16:00; ...". Walks and rides
   * between the stretches are left out.
   */
  private today(npc: NPCInstance, timeMin: number): string | undefined {
    const day = Math.floor(timeMin / 1440) % 7;
    const stretches: Array<{ words: string; startMin: number; endMin: number }> = [];
    for (const entry of npc.routine.filter((e) => e.days.includes(day)).sort((a, b) => a.startMin - b.startMin)) {
      const doing = DOING[entry.activity];
      if (!doing) continue;
      const at = entry.place.kind === 'parcel' || entry.place.kind === 'stop'
        ? this.places.short({ kind: entry.place.kind, id: entry.place.id })
        : undefined;
      const home = entry.place.kind === 'parcel' && entry.place.id === npc.home.parcelId;
      const words = entry.activity === 'sleeping' || entry.activity === 'home' || home || !at ? doing : `${doing} at ${at}`;
      const last = stretches.at(-1);
      if (last && last.words === words) last.endMin = entry.endMin;
      else stretches.push({ words, startMin: entry.startMin, endMin: entry.endMin });
    }
    if (stretches.length === 0) return undefined;
    const plan = stretches.map(({ words, startMin, endMin }) => {
      if (startMin <= 0 && endMin >= 1440) return `${words} all day`;
      if (startMin <= 0) return `${words} until ${clock(endMin)}`;
      if (endMin >= 1440) return `${words} from ${clock(startMin)}`;
      return `${words} from ${clock(startMin)} to ${clock(endMin)}`;
    });
    return prompt('background.md#today', { day: dayName(day), plan: plan.join('; ') });
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

/** The look line: height and build, face, hair, skin and eyes, then what they wear. */
function look(words: DialogLook): string {
  return prompt('background.md#look', {
    height: words.height,
    build: words.build,
    face: words.face.length > 0 ? `, ${listed(words.face)}` : '',
    hair: words.hair,
    skin: words.skin,
    eyes: words.eyes,
    wearing: listed(words.wearing),
    fabric: words.fabric ? `; your clothes are ${words.fabric}` : '',
  });
}
