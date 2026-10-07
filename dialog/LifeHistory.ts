/**
 * A person's life so far, told from their simulation record: where they
 * grew up, the work they did before and do now, two or three things that
 * shaped them, what they care about, one thing they keep to themselves, and
 * how they feel about the city. Every choice is drawn from the person's id,
 * so the same person always gets the same life, and a host keeps the text in
 * their memory once told so it never changes after. Nothing in it names a
 * relative the simulation's household does not hold: people from their past
 * are colleagues, neighbours, teachers and friends, unnamed.
 */

import { promptLoader } from '../prompts.js';
import type { NPCTypeCategory } from '../world/types/named-world.js';
import type { NPCInstance } from '../world/types/simulation.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export type Disposition = 'hostile' | 'wary' | 'neutral' | 'friendly';

export interface LifeInput {
  /** The district the person lives in, in words: its name, else what it is. */
  district: string;
  /** Their place of work as the dialog names it, when they have a building job. */
  workplace?: string;
  category?: NPCTypeCategory;
  disposition: Disposition;
}

/** The items of a `- ` list section of life.md, with `{{name}}` values filled in. */
function items(section: string, vars: Record<string, string | number> = {}): string[] {
  return prompt(`life.md#${section}`, vars)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
}

/** A stable number in [0, 1) for the person and one choice about them. */
function draw(npcId: string, slot: string): number {
  let hash = 2166136261;
  for (const char of `${npcId}|${slot}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

function pick<T>(list: T[], npcId: string, slot: string): T {
  return list[Math.floor(draw(npcId, slot) * list.length)]!;
}

/** `count` different items of a list, in a stable order of their own. */
function some<T>(list: T[], npcId: string, slot: string, count: number): T[] {
  return [...list].map((item, index) => ({ item, at: draw(npcId, `${slot}#${index}`) })).sort((a, b) => a.at - b.at).slice(0, count).map((entry) => entry.item);
}

const YEARS = (years: number) => (years <= 1 ? 'about a year' : `${years} years`);

/** Which list of past jobs fits the person's kind of work. */
const JOBS: Record<NPCTypeCategory, string> = {
  resident: 'jobs-worker',
  worker: 'jobs-worker',
  vendor: 'jobs-vendor',
  authority: 'jobs-authority',
  transit: 'jobs-transit',
  street: 'jobs-street',
};

/** The person's life so far as a short paragraph for their context, the same every time for the same person. */
export function lifeHistory(npc: NPCInstance, input: LifeInput): string {
  const id = npc.npcId;
  const age = npc.age ?? 35;
  const lines: string[] = [prompt('life.md#heading').trim()];

  // Where they grew up.
  const roots = draw(id, 'roots');
  const moved = Math.min(Math.max(16, age - 1), 16 + Math.floor(draw(id, 'moved-at') * 14));
  if (roots < 0.4 || age < 18) lines.push(pick(items('grew-here', { district: input.district }), id, 'grew'));
  else if (roots < 0.7) lines.push(pick(items('grew-city', { district: input.district, age: moved }), id, 'grew'));
  else lines.push(pick(items('grew-away', { age: moved }), id, 'grew'));

  // The work they did and do.
  const past = items(JOBS[input.category ?? 'resident'] ?? 'jobs-worker');
  const job = npc.job ?? npc.transitJob;
  const working = Math.max(0, age - 18);
  if (job) {
    const years = Math.max(1, Math.min(working, 1 + Math.floor(draw(id, 'years') * 12)));
    const role = withArticle(job.role.replace(/_/g, ' '));
    const place = input.workplace ?? ('parcelId' in job ? 'your workplace' : 'the transit lines');
    lines.push(items('job-now', { role, place, years: YEARS(years) })[0]!);
    const before = some(past.filter((entry) => !entry.endsWith(job.role.replace(/_/g, ' '))), id, 'before', working - years > 6 ? 2 : working - years > 1 ? 1 : 0);
    if (before.length === 1) lines.push(items('job-before-one', { first: before[0]! })[0]!);
    if (before.length === 2) lines.push(items('job-before-two', { first: before[0]!, second: before[1]! })[0]!);
  } else if (age >= 65) {
    lines.push(items('job-retired', { first: pick(past, id, 'last') })[0]!);
  } else if (working > 0) {
    lines.push(items('job-none', { first: pick(past, id, 'last'), years: YEARS(1 + Math.floor(draw(id, 'idle') * 3)) })[0]!);
  }

  // What shaped them.
  const young = pick(items('memory-young'), id, 'young');
  const grown = age >= 22 ? some(items('memory-adult'), id, 'grown', draw(id, 'memories') < 0.5 ? 1 : 2) : [];
  lines.push(`What stays with you: ${[young, ...grown].join('; ')}.`);

  // What they care about: the people they live with first.
  const partner = npc.family.find((member) => member.relation === 'partner');
  const child = npc.family.find((member) => member.relation === 'child');
  const cares = [
    ...(partner ? items('care-partner', { name: partner.name.given }) : []),
    ...(child ? items('care-child', { name: child.name.given }) : []),
    // Somebody who lives with others does not long to be left alone at home.
    ...some(items('cares').filter((care) => npc.family.length === 0 || care !== 'being left alone'), id, 'cares', partner || child ? 1 : 2),
  ];
  lines.push(`What you care about: ${listed(cares)}.`);

  lines.push(items('secret-heading', { secret: pick(items('secrets'), id, 'secret') })[0]!);
  lines.push(pick(items(`city-${input.disposition}`), id, 'city'));
  return lines.join('\n');
}

function withArticle(phrase: string): string {
  return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

function listed(list: string[]): string {
  if (list.length < 3) return list.join(' and ');
  return `${list.slice(0, -1).join('; ')}; and ${list.at(-1)}`;
}
