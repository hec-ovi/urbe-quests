/**
 * Step two of questline creation: given a story arc, translate it into a
 * questline. The plan pass thinks in prose and closes with a manifest, the
 * build loop commits it to the flow tool, and the cast is resolved by type
 * against the simulation.
 */

import type { AgentPort, LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { QuestlineBuilder } from './QuestlineBuilder.js';
import type { BuildProgress, QuestAssignment, TranslationResult } from './schema.js';
import { TranslationPlanner } from './TranslationPlanner.js';

export interface TranslateInput {
  assignment: QuestAssignment;
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  ports: { plan: LLMPort; build: AgentPort };
  referenceTimeMin?: number;
  maxRounds?: number;
  progress?: (event: BuildProgress) => void;
}

export class QuestlineTranslator {
  async translate(input: TranslateInput): Promise<TranslationResult> {
    const { assignment, world, types, sim, ports, referenceTimeMin, maxRounds, progress } = input;
    const plan = await new TranslationPlanner().plan({ assignment, world, types, llm: ports.plan });
    const built = await new QuestlineBuilder().build({
      assignment,
      plan: plan.text,
      manifest: plan.manifest,
      world,
      types,
      sim,
      agent: ports.build,
      ...(referenceTimeMin !== undefined ? { referenceTimeMin } : {}),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      ...(progress !== undefined ? { progress } : {}),
    });
    return { plan: plan.text, ...built };
  }
}
