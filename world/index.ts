/** World box surface: mirror types, fixture loader, stub simulation. */

import { readFileSync } from 'node:fs';
import type { NamedWorld, NPCTypeSet } from './types/named-world.js';

export * from './types/named-world.js';
export * from './types/simulation.js';
export { namedWorldFromAtlas, type AtlasQuestWorld } from './fromAtlas.js';
export { StubSimulation, type StubSimulationInput } from './stub/StubSimulation.js';

export type FixtureName = 'neon-bay' | 'aldermoor';

export interface FixtureWorld {
  world: NamedWorld;
  types: NPCTypeSet;
}

export function loadFixtureWorld(name: FixtureName): FixtureWorld {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
  return { world: read(`${name}.world.json`), types: read(`${name}.types.json`) };
}
