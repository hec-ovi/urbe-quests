/**
 * The self-questioning pass of translation: one text-only call turns a story
 * arc into a plan (cast, artifacts, acts, steps with whose want drives each)
 * that closes with a manifest of ids. Prose in, prose out, no tools; the
 * manifest is parsed by code, with one repair round when it is missing.
 */

import { promptLoader } from '../prompts.js';
import type { LLMPort } from '../ports/llm.js';
import { completeWithRepair } from '../story/repairLoop.js';
import { WorldBrief } from '../story/worldBrief.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import { parsePlanManifest, type PlanManifest } from './PlanManifest.js';
import { renderAssignment } from './renderAssignment.js';
import type { QuestAssignment } from './schema.js';

export interface PlanInput {
  assignment: QuestAssignment;
  world: NamedWorld;
  types: NPCTypeSet;
  llm: LLMPort;
}

export interface PlanResult {
  /** The plan text, manifest included, as the builder reads it. */
  text: string;
  manifest: PlanManifest;
}

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class TranslationPlanner {
  async plan(input: PlanInput): Promise<PlanResult> {
    const body = [
      renderAssignment(input.assignment),
      `The arc to translate:\n${input.assignment.arc}`,
      new WorldBrief(input.world, input.types).render(),
    ].join('\n\n');
    const { value, raw } = await completeWithRepair({
      llm: input.llm,
      system: prompt('translate-plan.md'),
      prompt: body,
      parse: parsePlanManifest,
      repair: (problems) => prompt('translate-plan-repair.md', { shortfalls: problems.map((p) => `- ${p}`).join('\n') }),
      stage: `plan (${input.assignment.title})`,
    });
    return { text: raw.trim(), manifest: value };
  }
}
