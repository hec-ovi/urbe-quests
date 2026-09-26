/**
 * Step two of questline creation: given a story arc, translate it into a
 * questline. The plan pass thinks in prose and closes with a manifest, the
 * build loop commits it to the flow tool, and the cast is resolved by type
 * against the simulation.
 */

import type { StepKind } from '../flow/schema.js';
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
  /** The parcels the story may use; every place lands inside it. */
  parcels?: readonly string[];
  /** The step kinds the host can play; omitted, every kind. */
  mechanics?: readonly StepKind[];
  referenceTimeMin?: number;
  maxRounds?: number;
  progress?: (event: BuildProgress) => void;
}

export class QuestlineTranslator {
  async translate(input: TranslateInput): Promise<TranslationResult> {
    const { ports, ...shared } = input;
    const plan = await new TranslationPlanner().plan({ ...shared, llm: ports.plan });
    const built = await new QuestlineBuilder().build({ ...shared, plan: plan.text, manifest: plan.manifest, agent: ports.build });
    return { plan: plan.text, ...built };
  }
}
