/**
 * One prose call, parsed by code; a shortfall gets one repair round that lists
 * every problem, then E_LLM with the raw text kept in detail.
 */

import { QuestError } from '../errors.js';
import type { LLMPort } from '../ports/llm.js';
import { ProseShortfall } from './headings.js';

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

  const repairPrompt = `${input.prompt}\n\n[Your previous answer]\n${raw}\n\n${input.repair(first.problems)}`;
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
