/** Builds a planned questline through agent tools, validates it and resolves its cast. */

import { QuestError } from '../errors.js';
import { promptLoader } from '../prompts.js';
import type { AgentPort, AgentTurn } from '../ports/llm.js';
import type { QuestlineDefinition, ResolvedCast, StepKind } from '../flow/schema.js';
import { auditStagings, scopedScenes, type SceneStaging } from '../handoff/SceneStagings.js';
import type { SceneryCapabilities } from '../handoff/schema.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { CastResolver } from './CastResolver.js';
import { mechanicVars, playableKinds, stepCatalog } from './mechanics.js';
import { manifestSize, type PlanManifest } from './PlanManifest.js';
import { QuestlineDraft } from './QuestlineDraft.js';
import { StoryVenues } from './StoryVenues.js';
import { renderAssignment } from './renderAssignment.js';
import type { BuildProgress, QuestAssignment } from './schema.js';
import { ToolDispatcher } from './ToolDispatcher.js';
import { WorldCatalog } from './WorldCatalog.js';
import { WorldTargetAudit } from './WorldTargetAudit.js';

export interface BuildInput {
  assignment: QuestAssignment;
  /** Translation plan from the planner: what to build, in prose, manifest included. */
  plan: string;
  manifest: PlanManifest;
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  agent: AgentPort;
  /** The parcels the story may use; every place lands inside it. Omitted, the whole world is open. */
  parcels?: readonly string[];
  /** The step kinds the host can play; omitted, every kind. A step of another kind is refused. */
  mechanics?: readonly StepKind[];
  /** The scenery the host stages: the agent gets stage_scene, and every investigation step shows its clue on a staged scene. */
  scenery?: SceneryCapabilities;
  /** Simulation time used to resolve on-duty cast; defaults to Tuesday 10:00. */
  referenceTimeMin?: number;
  /** Overrides the budget the plan sets (two rounds per planned piece plus eight). */
  maxRounds?: number;
  progress?: (event: BuildProgress) => void;
}

export interface BuildResult {
  /** As it ships: pinned where its cast works, its staged scenes' ids scoped to it. */
  definition: QuestlineDefinition;
  cast: ResolvedCast;
  /** The scenes it stages, in the order they were first staged, under `<questId>.<sceneId>`. */
  scenes: SceneStaging[];
}

/** Tuesday 10:00, when a story names no hour of its own. */
export const DEFAULT_REFERENCE_TIME = 1 * 1440 + 600;
/** One round per planned piece at the slowest, as many again for facts, refusals and fixes, and room to finish. */
const roundBudget = (planned: number) => 2 * planned + 8;
/** How many times a text-only reply is answered with a nudge back to the tools before the build fails. */
const MAX_NUDGES = 3;

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class QuestlineBuilder {
  async build(input: BuildInput): Promise<BuildResult> {
    const kinds = playableKinds(input.mechanics);
    const vars = mechanicVars(kinds);
    const staging = input.scenery !== undefined ? prompt('staging.md#build') : '';
    const system = [prompt('builder-system.md', { ...vars, staging }), stepCatalog(kinds), prompt('artifact-catalog.md', vars)].join('\n\n');
    const userPrompt = this.renderPrompt(input);
    const venues = new StoryVenues(input.world, input.types, input.parcels);
    const draft = new QuestlineDraft(input.manifest, new WorldTargetAudit(input.world, input.types), venues, input.scenery);
    const dispatcher = new ToolDispatcher(draft, kinds, input.scenery);
    const transcript: AgentTurn[] = [];
    const title = input.assignment.title;
    const maxRounds = input.maxRounds ?? roundBudget(manifestSize(input.manifest));
    const report = (round: number, note: string, refusals: string[] = []) =>
      input.progress?.({ title, round, maxRounds, ...draft.progress(), note, refusals });

    let definition: QuestlineDefinition | undefined;
    let nudges = 0;
    for (let round = 1; round <= maxRounds && definition === undefined; round++) {
      const reply = await input.agent.step({ system, prompt: userPrompt, tools: dispatcher.tools, transcript });
      if (reply.kind === 'done') {
        // Words instead of tools: a model summarizing what it thinks it did. Send it back with what is missing, a few times.
        if (nudges >= MAX_NUDGES) throw new QuestError('E_LLM', `builder agent stopped without finishing ${title}: ${this.standing(draft)}`);
        nudges += 1;
        transcript.push({ role: 'assistant', text: reply.text });
        transcript.push({ role: 'user', text: prompt('builder-nudge.md', { missing: this.nudgeLine(draft) }) });
        report(round, 'words instead of tools, nudged');
        continue;
      }
      transcript.push({ role: 'assistant', calls: reply.calls });
      const results: { tool: string; result: string }[] = [];
      for (const call of reply.calls) {
        const outcome = dispatcher.dispatch(call);
        results.push({ tool: call.tool, result: outcome.result });
        if (outcome.finished !== undefined) definition = outcome.finished;
      }
      transcript.push({ role: 'tool', results });
      const refused = results.filter((r) => r.result.startsWith('error:')).map((r) => r.result);
      report(round, `${reply.calls.map((c) => c.tool).join(', ')}${refused.length > 0 ? ` (${refused.length} refused)` : ''}`, refused);
    }
    if (definition === undefined) {
      throw new QuestError('E_LLM', `builder agent did not finish ${title} within ${maxRounds} rounds: ${this.standing(draft)}`);
    }

    const result = new CastResolver(input.sim, venues).cast(definition, input.referenceTimeMin ?? DEFAULT_REFERENCE_TIME);
    // A questline nobody can staff is not a questline to hand on: the build says so here.
    if (result.blocked !== undefined) throw new QuestError('E_CAST', result.blocked.reason, result.blocked);
    // Where a step happens is decided here, while it is built, so the shipped questline is the one truth.
    const shipped = scopedScenes(venues.pin(definition, new Map(Object.entries(result.posts))), draft.scenes);
    if (input.scenery !== undefined) this.checkPinnedScenes(shipped.definition, shipped.stagings, input.scenery);
    return { definition: shipped.definition, cast: result.cast, scenes: shipped.stagings };
  }

  /** Pinning moves steps to where their people work; each scene still stands where its clues are found. */
  private checkPinnedScenes(definition: QuestlineDefinition, stagings: readonly SceneStaging[], scenery: SceneryCapabilities): void {
    try {
      auditStagings(definition, stagings, scenery);
    } catch (error) {
      if (!(error instanceof QuestError)) throw error;
      throw new QuestError('E_HANDOFF', `the cast's workplaces move a step away from its scene: ${error.message}`, error.detail);
    }
  }

  private nudgeLine(draft: QuestlineDraft): string {
    const missing = draft.missingLine();
    return missing === undefined
      ? prompt('missing-work.md#complete')
      : prompt('missing-work.md#pending', { missing: `${missing.charAt(0).toUpperCase()}${missing.slice(1)}` });
  }

  private standing(draft: QuestlineDraft): string {
    const { committed, planned } = draft.progress();
    return `${committed} of ${planned} planned pieces in`;
  }

  private renderPrompt(input: BuildInput): string {
    return prompt('build-input.md', {
      assignment: renderAssignment(input.assignment),
      plan: input.plan,
      world: new WorldCatalog(input.world, input.types).render(),
    }).trim();
  }
}
