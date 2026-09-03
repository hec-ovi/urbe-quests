import type { QuestlineDefinition } from '../flow/schema.js';
import type { ObjectiveProjection } from './schema.js';

export class ObjectiveProjector {
  project(definitions: QuestlineDefinition[]): ObjectiveProjection[] {
    return definitions.flatMap((definition) => definition.steps.map((step) => ({
      questId: definition.id,
      stepId: step.stepId,
      action: structuredClone(step.target),
    })));
  }
}
