/** Writes related side-story situations from a completed script. */

import { promptLoader } from '../prompts.js';
import type { LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import { parseSituations } from './parseSituations.js';
import { renderScript } from './renderScript.js';
import { completeWithRepair } from './repairLoop.js';
import type { SituationMinimums, SituationsPassResult, StoryScript } from './schema.js';
import { WorldBrief } from './worldBrief.js';

export interface SituationsPassInput {
  script: StoryScript;
  world: NamedWorld;
  types: NPCTypeSet;
  llm: LLMPort;
  minimums?: Partial<SituationMinimums>;
}

export const DEFAULT_SITUATION_MINIMUMS: SituationMinimums = { situations: 3 };

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class SituationsPass {
  async run(input: SituationsPassInput): Promise<SituationsPassResult> {
    const minimums = { ...DEFAULT_SITUATION_MINIMUMS, ...input.minimums };
    const brief = prompt('pass-input.md#situations', {
      story: renderScript(input.script),
      theme: input.world.meta.naming.theme,
      world: new WorldBrief(input.world, input.types).render(),
    });

    const { value, raw } = await completeWithRepair({
      llm: input.llm,
      system: prompt('situations-pass.md', minimums),
      prompt: brief,
      parse: (text) => parseSituations(text, minimums, [input.script.title]),
      repair: (problems) => prompt('situations-repair.md', { shortfalls: problems.map((p) => `- ${p}`).join('\n') }),
      stage: 'situations',
    });
    return { situations: value, raw };
  }
}
