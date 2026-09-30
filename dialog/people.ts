/**
 * Who a person knows among the people the city holds, and where those people
 * are, decided by code from the host's own simulation: the people they work
 * with, live with and live beside, each with their work and hours and where
 * they are now as the host knows it; and, for a player's line that names
 * someone, whether this person knows who that is. Nothing here asks a model,
 * and nothing here imports a node API: a browser host runs it over its own
 * simulation and hands the result to the talk request as `people`.
 */

import type { BehaviorState, FamilyMember, NPCInstance, NPCName } from '../world/types/simulation.js';

/** Where a known person is now, as the host knows it. */
export type DialogWhereabouts =
  | { kind: 'here' }
  | { kind: 'place'; place: { kind: 'parcel' | 'stop'; id: string } }
  | { kind: 'home' }
  | { kind: 'street' }
  | { kind: 'transit' }
  | { kind: 'unknown' };

/** One person this NPC knows. */
export interface DialogPerson {
  npcId: string;
  /** The name they go by: a story's name for a cast person. */
  name: NPCName;
  relation: 'coworker' | 'household' | 'neighbour';
  /** Their family tie to the NPC, for household. */
  kin?: FamilyMember['relation'];
  /** Where and when they work: a building or a stop, their role, days (0 Monday) and hours. */
  job?: { place: { kind: 'parcel' | 'stop'; id: string }; role: string; days: number[]; startMin: number; endMin: number };
  now: DialogWhereabouts;
  /** The player's line names them. */
  asked?: boolean;
}

/** The people segment's facts: who the NPC knows, and the names the player asked about that it does not know. */
export interface DialogPeople {
  known: DialogPerson[];
  /** The words of the player's line that name somebody this NPC does not know, as the player wrote them. */
  unknown: string[];
}

export interface PeopleInput {
  /** The person talking. */
  npc: NPCInstance;
  timeMin: number;
  /** The player's line at hand. */
  line?: string;
  /** Every person the host's simulation holds (established people). */
  people: NPCInstance[];
  /** Story names of cast people, by npcId. */
  names?: Record<string, NPCName>;
  /** The npcIds the host sees in the same building as the NPC, or near them in the street, now. */
  present?: string[];
  /** The simulation's behaviour: where somebody's day has them now. */
  behaviorAt(npcId: string, timeMin: number): BehaviorState | null;
}

/** Most coworkers and neighbours a person lists; family and anyone the player names always count. */
const MOST_COWORKERS = 6;
const MOST_NEIGHBOURS = 3;
/** Words too short or too common to be a name. */
const COMMON = new Set(['the', 'and', 'you', 'doc', 'mrs', 'miss', 'sir', 'dr', 'mr', 'ms', 'who', 'where', 'what', 'for', 'looking', 'find', 'know', 'seen', 'here', 'there', 'she', 'him', 'her', 'his', 'this', 'that', 'with', 'about']);

/**
 * The people `npc` knows and where they are, and the names in the player's
 * line it does not know. Coworkers share its workplace (or its stop),
 * household is its family the host has established, neighbours share its
 * building. A person the host sees near the NPC is `here`; one the host holds
 * away from their day (with the player, held by a story) is `unknown`; any
 * other is where their day has them.
 */
export function peopleKnown(input: PeopleInput): DialogPeople {
  const { npc, timeMin } = input;
  const present = new Set(input.present ?? []);
  const nameOf = (person: NPCInstance): NPCName => input.names?.[person.npcId] ?? person.name;
  const whereabouts = (person: NPCInstance): DialogWhereabouts => {
    if (present.has(person.npcId)) return { kind: 'here' };
    const behavior = input.behaviorAt(person.npcId, timeMin);
    if (!behavior || behavior.interrupted) return { kind: 'unknown' };
    if (behavior.mode === 'home') return { kind: 'home' };
    if (behavior.mode === 'transit') return { kind: 'transit' };
    if (behavior.place.kind === 'parcel' || behavior.place.kind === 'stop') return { kind: 'place', place: { kind: behavior.place.kind, id: behavior.place.id } };
    return { kind: 'street' };
  };
  const others = input.people.filter((person) => person.npcId !== npc.npcId && !person.flags.dead);
  const workplace = placeOfWork(npc);
  const kin = new Map(npc.family.map((member) => [member.npcId, member.relation]));
  const coworkers = others.filter((person) => workplace !== undefined && sameWork(placeOfWork(person), workplace));
  const household = others.filter((person) => kin.has(person.npcId));
  const neighbours = others.filter((person) => !kin.has(person.npcId) && person.home.parcelId === npc.home.parcelId);

  const mentioned = mentions(input.line ?? '', others.map((person) => ({ person, name: nameOf(person) })));
  const known: DialogPerson[] = [];
  const add = (person: NPCInstance, relation: DialogPerson['relation']) => {
    if (known.some((entry) => entry.npcId === person.npcId)) return;
    const job = person.job
      ? { place: { kind: 'parcel' as const, id: person.job.parcelId }, role: person.job.role, shift: person.job.shift }
      : person.transitJob?.place.kind === 'stop'
        ? { place: { kind: 'stop' as const, id: person.transitJob.place.id }, role: person.transitJob.role, shift: person.transitJob.shift }
        : undefined;
    known.push({
      npcId: person.npcId,
      name: nameOf(person),
      relation,
      ...(relation === 'household' ? { kin: kin.get(person.npcId)! } : {}),
      ...(job ? { job: { place: job.place, role: job.role, days: [...job.shift.days], startMin: job.shift.startMin, endMin: job.shift.endMin } } : {}),
      now: whereabouts(person),
      ...(mentioned.people.has(person.npcId) ? { asked: true } : {}),
    });
  };
  const byName = (a: NPCInstance, b: NPCInstance) => fullName(nameOf(a)).localeCompare(fullName(nameOf(b))) || a.npcId.localeCompare(b.npcId);
  const asked = (list: NPCInstance[]) => list.filter((person) => mentioned.people.has(person.npcId));
  for (const person of household.sort(byName)) add(person, 'household');
  for (const person of asked(coworkers)) add(person, 'coworker');
  for (const person of asked(neighbours)) add(person, 'neighbour');
  for (const person of coworkers.sort(byName).slice(0, MOST_COWORKERS)) add(person, 'coworker');
  for (const person of neighbours.sort(byName).slice(0, MOST_NEIGHBOURS)) add(person, 'neighbour');
  // A name the player uses that only strangers carry is somebody this person does not know.
  const knownIds = new Set(known.map((person) => person.npcId));
  const unknown = [...mentioned.words.entries()]
    .filter(([, ids]) => ![...ids].some((id) => knownIds.has(id)))
    .map(([word]) => word);
  return { known, unknown };
}

/** Where a person works: a building, or the stop a station post stands at. */
function placeOfWork(person: NPCInstance): string | undefined {
  if (person.job) return `parcel:${person.job.parcelId}`;
  if (person.transitJob?.place.kind === 'stop') return `stop:${person.transitJob.place.id}`;
  return undefined;
}

function sameWork(a: string | undefined, b: string): boolean {
  return a === b;
}

/**
 * The people a line names: every word of three letters or more that is
 * somebody's given or family name, as the player wrote it, and who carries it.
 */
function mentions(line: string, people: Array<{ person: NPCInstance; name: NPCName }>): { people: Set<string>; words: Map<string, Set<string>> } {
  const words = new Map<string, Set<string>>();
  const found = new Set<string>();
  const spoken = line.match(/[\p{L}'-]+/gu) ?? [];
  for (const word of spoken) {
    const key = word.toLowerCase();
    if (key.length < 3 || COMMON.has(key)) continue;
    for (const { person, name } of people) {
      if (name.given.toLowerCase() !== key && name.family.toLowerCase() !== key) continue;
      found.add(person.npcId);
      const ids = words.get(word) ?? new Set<string>();
      ids.add(person.npcId);
      words.set(word, ids);
    }
  }
  // A family name shared with the given name that matched is the same person, not a second one asked about.
  return { people: found, words };
}

function fullName(name: NPCName): string {
  return `${name.given} ${name.family}`;
}
