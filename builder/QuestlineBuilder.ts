/**
 * Drives the agent through the drafting tools until the questline validates,
 * then resolves the cast. Create, then step by step, then finish. The agent
 * works from the translation plan, the character cards and the synopsis, not
 * from the full arc: the thinking happened in the plan pass.
 */

import { QuestError } from '../errors.js';
import { promptLoader } from '../prompts.js';
import type { AgentPort, AgentTurn } from '../ports/llm.js';
import type { QuestlineDefinition, ResolvedCast } from '../flow/schema.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { CastResolver } from './CastResolver.js';
import { QuestlineDraft } from './QuestlineDraft.js';
import { renderAssignment } from './renderAssignment.js';
import type { QuestAssignment } from './schema.js';
import { ToolDispatcher } from './ToolDispatcher.js';
import { BUILDER_TOOLS } from './tools.js';
import { WorldCatalog } from './WorldCatalog.js';

export interface BuildInput {
  assignment: QuestAssignment;
  /** Translation plan from the planner: what to build, in prose. */
  plan: string;
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  agent: AgentPort;
  /** Simulation time used to resolve on-duty cast; defaults to Tuesday 10:00. */
  referenceTimeMin?: number;
  maxRounds?: number;
}

export interface BuildResult {
  definition: QuestlineDefinition;
  cast: ResolvedCast;
}

const DEFAULT_REFERENCE_TIME = 1 * 1440 + 600;
const DEFAULT_MAX_ROUNDS = 40;

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export class QuestlineBuilder {
  async build(input: BuildInput): Promise<BuildResult> {
    const system = [prompt('builder-system.md'), prompt('step-catalog.md'), prompt('artifact-catalog.md')].join('\n\n');
    const userPrompt = this.renderPrompt(input);
    const dispatcher = new ToolDispatcher(new QuestlineDraft());
    const transcript: AgentTurn[] = [];
    const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;

    let definition: QuestlineDefinition | undefined;
    for (let round = 0; round < maxRounds && definition === undefined; round++) {
      const reply = await input.agent.step({ system, prompt: userPrompt, tools: BUILDER_TOOLS, transcript });
      if (reply.kind === 'done') {
        throw new QuestError('E_LLM', 'builder agent stopped without finishing the questline');
      }
      transcript.push({ role: 'assistant', calls: reply.calls });
      const results: { tool: string; result: string }[] = [];
      for (const call of reply.calls) {
        const outcome = dispatcher.dispatch(call);
        results.push({ tool: call.tool, result: outcome.result });
        if (outcome.finished !== undefined) definition = outcome.finished;
      }
      transcript.push({ role: 'tool', results });
    }
    if (definition === undefined) {
      throw new QuestError('E_LLM', `builder agent did not finish within ${maxRounds} rounds`);
    }

    const cast = new CastResolver(input.sim).resolve(definition, input.referenceTimeMin ?? DEFAULT_REFERENCE_TIME);
    return { definition, cast };
  }

  private renderPrompt(input: BuildInput): string {
    return [
      `Build this questline:\n${renderAssignment(input.assignment)}`,
      `The translation plan to follow:\n${input.plan}`,
      new WorldCatalog(input.world, input.types).render(),
    ].join('\n\n');
  }
}
