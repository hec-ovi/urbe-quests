/** Translation inputs and outputs: a story arc in, a plan and a cast questline out. */

import type { QuestlineDefinition, ResolvedCast } from '../flow/schema.js';
import type { SceneStaging } from '../handoff/SceneStagings.js';

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
  /** The text-only translation plan the build followed, manifest included. */
  plan: string;
  definition: QuestlineDefinition;
  cast: ResolvedCast;
  /** The scenes the questline stages; empty unless the host declares scenery. */
  scenes: SceneStaging[];
}

/** One build round as the loop saw it, for a host's log. */
export interface BuildProgress {
  /** The assignment title. */
  title: string;
  round: number;
  maxRounds: number;
  /** Planned pieces (roles, items, acts, endings, steps) added so far, against the plan's total. */
  committed: number;
  planned: number;
  /** The tools called this round (with refusals counted), or what happened instead. */
  note: string;
  /** This round's refused calls as the agent read them, so a host log says why a build stalls. */
  refusals: string[];
}
