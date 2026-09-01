/** Committed story texts, so every later stage runs without a model. */

import { readFileSync } from 'node:fs';

export type FixtureStoryName = 'cyberpunk';

export interface FixtureStory {
  /** Raw script pass text. */
  script: string;
  /** Raw situations pass text. */
  situations: string;
}

export function loadFixtureStory(name: FixtureStoryName): FixtureStory {
  const read = (file: string) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
  return { script: read(`${name}.script.md`), situations: read(`${name}.situations.md`) };
}
