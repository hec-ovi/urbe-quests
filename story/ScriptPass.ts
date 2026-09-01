/**
 * Step one of questline creation: from the creation prompt and the named
 * world, one text-only call writes the whole story as a film script
 * (characters with background and voice, four movements of passages that
 * turn). Minimums are enforced in code; a shortfall gets one repair round.
 */

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
}

export const DEFAULT_SCRIPT_MINIMUMS: ScriptMinimums = { characters: 5, passagesPerMovement: 2 };

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class ScriptPass {
  async run(input: ScriptPassInput): Promise<ScriptPassResult> {
    const creationPrompt = input.prompt ?? input.world.meta.naming.theme;
    const minimums = { ...DEFAULT_SCRIPT_MINIMUMS, ...input.minimums };
    const brief = [
      `Creation prompt:\n${creationPrompt}`,
      `The city's character:\n${input.world.meta.naming.theme}`,
      new WorldBrief(input.world, input.types).render(),
    ].join('\n\n');

    const { value, raw } = await completeWithRepair({
      llm: input.llm,
      system: prompt('script-pass.md', minimums),
      prompt: brief,
      parse: (text) => parseScript(text, creationPrompt, minimums),
      repair: (problems) => prompt('script-repair.md', { shortfalls: problems.map((p) => `- ${p}`).join('\n') }),
      stage: 'script',
    });
    return { script: value, raw };
  }
}
