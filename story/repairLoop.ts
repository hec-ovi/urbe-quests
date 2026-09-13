/** Parses a text response, allows one repair and retains unusable output in E_LLM. */

import { promptLoader } from '../prompts.js';

import { QuestError } from '../errors.js';
import type { LLMPort } from '../ports/llm.js';
import { ProseShortfall } from './headings.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export interface RepairLoopInput<T> {
  llm: LLMPort;
  system: string;
  prompt: string;
  parse: (raw: string) => T;
  /** Renders the repair instructions for the listed problems. */
  repair: (problems: string[]) => string;
  stage: string;
}

export async function completeWithRepair<T>(input: RepairLoopInput<T>): Promise<{ value: T; raw: string }> {
  const raw = await input.llm.complete({ system: input.system, prompt: input.prompt });
  const first = attempt(input.parse, raw);
  if (first.value !== undefined) return { value: first.value, raw };

  const repairPrompt = prompt('repair-input.md', { request: input.prompt, answer: raw, repair: input.repair(first.problems) }).trim();
  const repaired = await input.llm.complete({ system: input.system, prompt: repairPrompt });
  const second = attempt(input.parse, repaired);
  if (second.value !== undefined) return { value: second.value, raw: repaired };
  throw new QuestError('E_LLM', `${input.stage} output unusable after repair: ${second.problems.join('; ')}`, {
    stage: input.stage,
    raw: repaired,
    problems: second.problems,
  });
}

function attempt<T>(parse: (raw: string) => T, raw: string): { value?: T; problems: string[] } {
  try {
    return { value: parse(raw), problems: [] };
  } catch (error) {
    if (error instanceof ProseShortfall) return { problems: error.problems };
    throw error;
  }
}
