/**
 * Story pass: one focused backbone call writes the whole main line and side
 * premises together (generating the backbone at once is what keeps quests
 * consistent with each other). Raw text is kept before validation; a failed
 * parse gets one repair round, then E_LLM.
 */

import { readFileSync } from 'node:fs';
import { QuestError } from '../errors.js';
import type { LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import { parseStory, StoryParseError } from './parseStory.js';
import type { StoryPassResult } from './schema.js';
import { WorldBrief } from './worldBrief.js';

export interface StoryPassInput {
  world: NamedWorld;
  types: NPCTypeSet;
  llm: LLMPort;
  /** Defaults to the named world's theme. */
  theme?: string;
}

const prompt = (file: string) => readFileSync(new URL(`./prompts/${file}`, import.meta.url), 'utf8');

export class StoryPass {
  async run(input: StoryPassInput): Promise<StoryPassResult> {
    const theme = input.theme ?? input.world.meta.naming.theme;
    const system = prompt('story-pass.md');
    const brief = `The city's theme:\n${theme}\n\n${new WorldBrief(input.world, input.types).render()}`;

    const raw = await input.llm.complete({ system, prompt: brief });
    try {
      return { document: parseStory(raw, theme), raw };
    } catch (error) {
      if (!(error instanceof StoryParseError)) throw error;
    }

    const repairPrompt = `${brief}\n\n[Your previous answer]\n${raw}\n\n${prompt('story-repair.md')}`;
    const repaired = await input.llm.complete({ system, prompt: repairPrompt });
    try {
      return { document: parseStory(repaired, theme), raw: repaired };
    } catch (error) {
      if (error instanceof StoryParseError) {
        throw new QuestError('E_LLM', `story output unusable after repair: ${error.message}`, { raw: repaired });
      }
      throw error;
    }
  }
}
