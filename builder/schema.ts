/** Translation inputs and outputs: a story arc in, a plan and a cast questline out. */

import type { QuestlineDefinition, ResolvedCast } from '../flow/schema.js';

/** The slice of story one questline is built from. */
export interface QuestAssignment {
  title: string;
  /** The larger story in short, so this questline orbits it. */
  synopsis: string;
  /** Character cards in prose: role, background, want, voice. */
  characters: string;
  /** The prose to translate: the whole script's movements, or one situation. */
  arc: string;
}

export interface TranslationResult {
  /** The text-only translation plan the build followed. */
  plan: string;
  definition: QuestlineDefinition;
  cast: ResolvedCast;
}
