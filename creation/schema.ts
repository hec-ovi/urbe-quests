/** Questline creation: one prompt in, the story, its questline and its side quests out. */

import type { BuildProgress, TranslationResult } from '../builder/schema.js';
import type { AgentPort, LLMPort } from '../ports/llm.js';
import type { ScriptMinimums, ScriptPassResult, SituationMinimums, SituationsPassResult } from '../story/schema.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';

/** One port per stage, so the engine can serve each from a different model (frontier or local). */
export interface StagePorts {
  /** Text only: the film script. */
  script: LLMPort;
  /** Text only: the side situations. */
  situations: LLMPort;
  /** Text only: the translation plan per questline. */
  plan: LLMPort;
  /** Tool loop: the flow tool build per questline. */
  build: AgentPort;
}

export interface CreationInput {
  /** The user's creation prompt, e.g. "create a dark cynical sci fi cyberpunk story". */
  prompt: string;
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  ports: StagePorts;
  minimums?: { script?: Partial<ScriptMinimums>; situations?: Partial<SituationMinimums> };
  referenceTimeMin?: number;
  maxRounds?: number;
  /** Told about a side quest that failed to build and was dropped. */
  warn?: (message: string) => void;
  /** Told as each stage lands and each build round passes, so a long run shows where it is. */
  progress?: (event: CreationProgress) => void;
}

export type CreationProgress =
  | { kind: 'script'; result: ScriptPassResult }
  | { kind: 'situations'; result: SituationsPassResult }
  | { kind: 'build'; questline: 'main' | string; build: BuildProgress }
  /** A questline finished: the main line, or the side quest of that situation id. */
  | { kind: 'questline'; questline: 'main' | string; result: TranslationResult };

export interface SideQuest extends TranslationResult {
  situationId: string;
}

export interface CreationResult {
  script: ScriptPassResult;
  situations: SituationsPassResult;
  /** The main story line as one questline. */
  main: TranslationResult;
  /** One questline per situation, in situation order. */
  side: SideQuest[];
}
