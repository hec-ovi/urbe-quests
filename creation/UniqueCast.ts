/**
 * One person, one character, across the whole set. Each questline casts on its
 * own while it builds; this recasts the finished set in one fixed order (main,
 * then sides in situation order): a person already playing a part is held back
 * from the next one, and a character the set has already cast (same role id
 * and type, borrowed from the same script) keeps the person it has.
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
  referenceTimeMin?: number;
}

export class UniqueCast {
  constructor(private readonly input: CastInput) {}

  apply(main: TranslationResult, side: SideQuest[]): { main: TranslationResult; side: SideQuest[] } {
    const { world, types, sim } = this.input;
    const resolver = new CastResolver(sim, new StoryVenues(world, types));
    const referenceTimeMin = this.input.referenceTimeMin ?? DEFAULT_REFERENCE_TIME;
    const options = { taken: new Set<string>(), characters: new Map<string, string>() };
    const recast = <T extends TranslationResult>(result: T): T => ({
      ...result,
      cast: resolver.resolve(result.definition, referenceTimeMin, options),
    });
    return { main: recast(main), side: side.map(recast) };
  }
}
