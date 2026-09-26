/** Writes and validates a narrative script from semantic city context. */

import { promptLoader } from '../prompts.js';
import type { LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import { parseScript } from './parseScript.js';
import { completeWithRepair } from './repairLoop.js';
import type { ScriptMinimums, ScriptPassResult } from './schema.js';
import { WorldBrief } from './worldBrief.js';

export interface ScriptPassInput {
  world: NamedWorld;
  types: NPCTypeSet;
  llm: LLMPort;
  /** The creation prompt ("create a dark cynical cyberpunk story"); defaults to the world's theme. */
  prompt?: string;
  minimums?: Partial<ScriptMinimums>;
  /** The host stands what a scene leaves in a place: the story may write such places as they are found. */
  stagesScenes?: boolean;
}

export const DEFAULT_SCRIPT_MINIMUMS: ScriptMinimums = { characters: 5, passagesPerMovement: 2 };

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class ScriptPass {
  async run(input: ScriptPassInput): Promise<ScriptPassResult> {
    const creationPrompt = input.prompt ?? input.world.meta.naming.theme;
    const minimums = { ...DEFAULT_SCRIPT_MINIMUMS, ...input.minimums };
    const brief = prompt('pass-input.md#script', {
      creationPrompt,
      theme: input.world.meta.naming.theme,
      world: new WorldBrief(input.world, input.types).render(),
    });

    const { value, raw } = await completeWithRepair({
      llm: input.llm,
      system: prompt('script-pass.md', { ...minimums, staging: input.stagesScenes === true ? prompt('staging.md') : '' }),
      prompt: brief,
      parse: (text) => parseScript(text, creationPrompt, minimums),
      repair: (problems) => prompt('script-repair.md', { shortfalls: problems.map((p) => `- ${p}`).join('\n') }),
      stage: 'script',
    });
    return { script: value, raw };
  }
}
