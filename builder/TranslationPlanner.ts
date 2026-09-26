/** Writes a prose plan and validates its closing ID manifest, with one repair attempt. */

import type { StepKind } from '../flow/schema.js';
import { promptLoader } from '../prompts.js';
import type { LLMPort } from '../ports/llm.js';
import { completeWithRepair } from '../story/repairLoop.js';
import { WorldBrief } from '../story/worldBrief.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import { mechanicVars, playableKinds, stepCatalog } from './mechanics.js';
import { parsePlanManifest, type PlanManifest } from './PlanManifest.js';
import { renderAssignment } from './renderAssignment.js';
import type { QuestAssignment } from './schema.js';

export interface PlanInput {
  assignment: QuestAssignment;
  world: NamedWorld;
  types: NPCTypeSet;
  llm: LLMPort;
  /** The step kinds the host can play; omitted, every kind. The plan sees only their catalog sections. */
  mechanics?: readonly StepKind[];
}

export interface PlanResult {
  /** The plan text, manifest included, as the builder reads it. */
  text: string;
  manifest: PlanManifest;
}

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class TranslationPlanner {
  async plan(input: PlanInput): Promise<PlanResult> {
    const kinds = playableKinds(input.mechanics);
    const body = prompt('plan-input.md', {
      assignment: renderAssignment(input.assignment),
      arc: input.assignment.arc,
      world: new WorldBrief(input.world, input.types).render(),
    }).trim();
    const { value, raw } = await completeWithRepair({
      llm: input.llm,
      system: [prompt('translate-plan.md', mechanicVars(kinds)), stepCatalog(kinds)].join('\n\n'),
      prompt: body,
      parse: parsePlanManifest,
      repair: (problems) => prompt('translate-plan-repair.md', { shortfalls: problems.map((p) => `- ${p}`).join('\n') }),
      stage: `plan (${input.assignment.title})`,
    });
    return { text: raw.trim(), manifest: value };
  }
}
