/**
 * Drives the agent through the drafting tools until the questline validates,
 * then resolves the cast. The plan's manifest bounds the work: only planned
 * ids are accepted, the round budget derives from the plan's size, and every
 * nudge names what is still missing. The agent works from the plan, the
 * character cards and the synopsis, not from the full arc: the thinking
 * happened in the plan pass.
 */

import { QuestError } from '../errors.js';
import { promptLoader } from '../prompts.js';
import type { AgentPort, AgentTurn } from '../ports/llm.js';
import type { QuestlineDefinition, ResolvedCast } from '../flow/schema.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { CastResolver } from './CastResolver.js';
import { manifestSize, type PlanManifest } from './PlanManifest.js';
import { QuestlineDraft } from './QuestlineDraft.js';
import { renderAssignment } from './renderAssignment.js';
import type { BuildProgress, QuestAssignment } from './schema.js';
import { ToolDispatcher } from './ToolDispatcher.js';
import { BUILDER_TOOLS } from './tools.js';
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
  /** Simulation time used to resolve on-duty cast; defaults to Tuesday 10:00. */
  referenceTimeMin?: number;
  /** Overrides the budget the plan sets (two rounds per planned piece plus eight). */
  maxRounds?: number;
  progress?: (event: BuildProgress) => void;
}

export interface BuildResult {
  definition: QuestlineDefinition;
  cast: ResolvedCast;
}

const DEFAULT_REFERENCE_TIME = 1 * 1440 + 600;
/** One round per planned piece at the slowest, as many again for facts, refusals and fixes, and room to finish. */
const roundBudget = (planned: number) => 2 * planned + 8;
/** How many times a text-only reply is answered with a nudge back to the tools before the build fails. */
const MAX_NUDGES = 3;

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class QuestlineBuilder {
  async build(input: BuildInput): Promise<BuildResult> {
    const system = [prompt('builder-system.md'), prompt('step-catalog.md'), prompt('artifact-catalog.md')].join('\n\n');
    const userPrompt = this.renderPrompt(input);
    const draft = new QuestlineDraft(input.manifest, new WorldTargetAudit(input.world, input.types));
    const dispatcher = new ToolDispatcher(draft);
    const transcript: AgentTurn[] = [];
    const title = input.assignment.title;
    const maxRounds = input.maxRounds ?? roundBudget(manifestSize(input.manifest));
    const report = (round: number, note: string) => input.progress?.({ title, round, maxRounds, ...draft.progress(), note });

    let definition: QuestlineDefinition | undefined;
    let nudges = 0;
    for (let round = 1; round <= maxRounds && definition === undefined; round++) {
      const reply = await input.agent.step({ system, prompt: userPrompt, tools: BUILDER_TOOLS, transcript });
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
      const refused = results.filter((r) => r.result.startsWith('error:')).length;
      report(round, `${reply.calls.map((c) => c.tool).join(', ')}${refused > 0 ? ` (${refused} refused)` : ''}`);
    }
    if (definition === undefined) {
      throw new QuestError('E_LLM', `builder agent did not finish ${title} within ${maxRounds} rounds: ${this.standing(draft)}`);
    }

    const cast = new CastResolver(input.sim).resolve(definition, input.referenceTimeMin ?? DEFAULT_REFERENCE_TIME);
    return { definition, cast };
  }

  private nudgeLine(draft: QuestlineDraft): string {
    const missing = draft.missingLine();
    return missing === undefined
      ? 'Everything in the plan is in: call finish_questline now, and fix whatever it reports.'
      : `${missing.charAt(0).toUpperCase()}${missing.slice(1)}; then call finish_questline.`;
  }

  private standing(draft: QuestlineDraft): string {
    const { committed, planned } = draft.progress();
    return `${committed} of ${planned} planned pieces in`;
  }

  private renderPrompt(input: BuildInput): string {
    return [
      `Build this questline:\n${renderAssignment(input.assignment)}`,
      `The translation plan to follow:\n${input.plan}`,
      new WorldCatalog(input.world, input.types).render(),
    ].join('\n\n');
  }
}
