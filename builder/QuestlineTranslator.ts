/**
 * Step two of questline creation: given a story arc, translate it into a
 * questline. The plan pass thinks in prose and closes with a manifest, the
 * build loop commits it to the flow tool, and the cast is resolved by type
 * against the simulation.
 */

import type { QuestlineDefinition, StepKind } from '../flow/schema.js';
import type { SceneryCapabilities } from '../handoff/schema.js';
import type { AgentPort, LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { QuestlineBuilder } from './QuestlineBuilder.js';
import type { BuildProgress, QuestAssignment, TranslationResult } from './schema.js';
import { TranslationPlanner, type PlanResult } from './TranslationPlanner.js';

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
  /** The scenery the host stages; the plan may stage scenes and the build gets stage_scene. */
  scenery?: SceneryCapabilities;
  referenceTimeMin?: number;
  maxRounds?: number;
  /** For a side job: the main questline once built. The build waits for it, is shown its steps and may name the one the job is offered after. */
  main?: Promise<QuestlineDefinition>;
  /** Told the plan once it parsed, before the build starts, so a host keeps it whatever the build does. */
  planned?: (plan: PlanResult) => void;
  progress?: (event: BuildProgress) => void;
}

export class QuestlineTranslator {
  async translate(input: TranslateInput): Promise<TranslationResult> {
    const { ports, planned, main, ...shared } = input;
    const plan = await new TranslationPlanner().plan({ ...shared, llm: ports.plan });
    planned?.(plan);
    const built = await new QuestlineBuilder().build({ ...shared, main: await main, plan: plan.text, manifest: plan.manifest, agent: ports.build });
    return { plan: plan.text, ...built };
  }
}
