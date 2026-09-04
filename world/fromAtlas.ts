import { WorldContextNormalizer } from './WorldContextNormalizer.js';
import type { AtlasQuestWorld, NamedWorld } from './types/named-world.js';

export type { AtlasQuestWorld } from './types/named-world.js';

/** Deterministic fallback for recorded creation when the naming pass is absent. */
export function namedWorldFromAtlas(world: AtlasQuestWorld, theme: string): NamedWorld {
  return new WorldContextNormalizer().world(world, theme);
}
