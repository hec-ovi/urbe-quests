/**
 * One person, one character, across the whole set. Each questline casts on its
 * own while it builds; this recasts the finished set in one fixed order (main,
 * then sides in situation order): a person already playing a part is held back
 * from the next one, and a character the set has already cast (same role id
 * and type, borrowed from the same script) keeps the person it has. Each
 * questline is published where its people are; one the city cannot staff is
 * published with its reason and a word to the caller.
 */

import { CastResolver } from '../builder/CastResolver.js';
import { DEFAULT_REFERENCE_TIME } from '../builder/QuestlineBuilder.js';
import { StoryVenues } from '../builder/StoryVenues.js';
import type { TranslationResult } from '../builder/schema.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import type { SideQuest } from './schema.js';

export interface CastInput {
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  /** The parcels the story may use; a character's post outside it moves no step. */
  parcels?: readonly string[];
  referenceTimeMin?: number;
  /** Told about a questline that keeps a role the city cannot fill. */
  warn?: (message: string) => void;
}

export class UniqueCast {
  constructor(private readonly input: CastInput) {}

  apply(main: TranslationResult, side: SideQuest[]): { main: TranslationResult; side: SideQuest[] } {
    const { world, types, sim } = this.input;
    const venues = new StoryVenues(world, types, this.input.parcels);
    const resolver = new CastResolver(sim, venues);
    const referenceTimeMin = this.input.referenceTimeMin ?? DEFAULT_REFERENCE_TIME;
    const options = { taken: new Set<string>(), characters: new Map<string, string>() };
    const recast = <T extends TranslationResult>(result: T): T => {
      const { cast, posts, blocked } = resolver.cast(result.definition, referenceTimeMin, options);
      if (blocked !== undefined) this.input.warn?.(`${result.definition.id} is blocked: ${blocked.reason}`);
      const definition = venues.pin(result.definition, new Map(Object.entries(posts)));
      return { ...result, definition, cast };
    };
    return { main: recast(main), side: side.map(recast) };
  }
}
