/**
 * How a person takes to the player before anything is said: a disposition
 * read from the plain traits Simulation draws and from the kind of person
 * their type is. Code decides it; the dialog context tells the NPC, and a
 * host that cannot ask the model decides a companion request by it.
 */

import type { NPCTypeCategory } from './types/named-world.js';

export type Disposition = 'hostile' | 'wary' | 'neutral' | 'friendly';

/** Where a request would take the person: their own home is private, their work less so, a public place least. */
export type RequestPrivacy = 'home' | 'work' | 'public' | 'follow';

/** Warmth each trait lends: open and kind people warm to a stranger, guarded and hard ones do not. */
const WARMTH: Record<string, number> = {
  warm: 1, kind: 1, friendly: 1, helpful: 1, cheerful: 1, open: 1, generous: 1, chatty: 0.5, talkative: 0.5, sweet: 1,
  patient: 0.5, calm: 0.5, fair: 0.5, curious: 0.5, playful: 0.5, bright: 0.5, dependable: 0.5, steady: 0.25,
  wary: -1, guarded: -1, suspicious: -1.5, watchful: -0.5, blunt: -0.5, brusque: -1, gruff: -1, stern: -1,
  stubborn: -0.5, proud: -0.5, sharp: -0.5, scrappy: -0.5, streetwise: -0.5, tired: -0.25, dry: -0.25, shy: -0.5,
};
/** What a kind of person brings to a stranger: an officer is guarded, a vendor is used to serving. */
const CATEGORY: Partial<Record<NPCTypeCategory, number>> = { authority: -1, street: -0.5, vendor: 0.5 };

/**
 * A person's disposition toward the player: the sum of their traits' warmth
 * and their category's, hostile at -2 or below, wary below zero, friendly
 * from 1, neutral between.
 */
export function dispositionOf(person: { traits?: string[] }, category?: NPCTypeCategory): Disposition {
  const warmth = (person.traits ?? []).reduce((sum, trait) => sum + (WARMTH[trait.toLowerCase()] ?? 0), 0) + (category ? CATEGORY[category] ?? 0 : 0);
  if (warmth <= -2) return 'hostile';
  if (warmth < 0) return 'wary';
  if (warmth >= 1) return 'friendly';
  return 'neutral';
}

/**
 * Whether a person of this disposition goes along with a request when
 * nobody can ask them: a friendly one shows anything and comes along, a
 * neutral one walks the player to a public place or their work and comes
 * along, a wary one only points out a public place, a hostile one does
 * nothing. The model, when there is one, decides in the person's own words
 * with the same rules and how the talk has gone.
 */
export function willingTo(disposition: Disposition, privacy: RequestPrivacy): boolean {
  if (disposition === 'friendly') return true;
  if (disposition === 'neutral') return privacy !== 'home';
  if (disposition === 'wary') return privacy === 'public';
  return false;
}
