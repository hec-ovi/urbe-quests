/**
 * The self-questioning pass of translation: one text-only call turns a story
 * arc into a plan (cast, artifacts, acts, steps with whose want drives each)
 * that the tool loop then follows. Prose in, prose out, no tools.
 */

import { QuestError } from '../errors.js';
import { promptLoader } from '../prompts.js';
import type { LLMPort } from '../ports/llm.js';
import { WorldBrief } from '../story/worldBrief.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import { renderAssignment } from './renderAssignment.js';
import type { QuestAssignment } from './schema.js';

export interface PlanInput {
  assignment: QuestAssignment;
  world: NamedWorld;
  types: NPCTypeSet;
  llm: LLMPort;
}

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class TranslationPlanner {
  async plan(input: PlanInput): Promise<string> {
    const body = [
      renderAssignment(input.assignment),
      `The arc to translate:\n${input.assignment.arc}`,
      new WorldBrief(input.world, input.types).render(),
    ].join('\n\n');
    const plan = (await input.llm.complete({ system: prompt('translate-plan.md'), prompt: body })).trim();
    if (plan.length === 0) throw new QuestError('E_LLM', `empty translation plan for ${input.assignment.title}`);
    return plan;
  }
}
