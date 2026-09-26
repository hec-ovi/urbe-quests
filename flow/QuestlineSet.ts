import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from './schema.js';
import type { QuestlineState } from './state.js';
import { FlowValidator } from './validate.js';

/** Engine payload: the main definition first, followed by side quest definitions. */
export type QuestlineSet = QuestlineDefinition[];

export class QuestlineSetValidator {
  validate(definitions: QuestlineSet): void {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      throw new QuestError('E_INVALID_FLOW', 'questline set: expected at least the main questline');
    }

    const ids = new Set<string>();
    const validator = new FlowValidator();
    for (const definition of definitions) {
      if (definition === null || typeof definition !== 'object' || typeof definition.id !== 'string') {
        throw new QuestError('E_INVALID_FLOW', 'questline set: every entry must be a questline definition');
      }
      if (ids.has(definition.id)) {
        throw new QuestError('E_INVALID_FLOW', `questline set: duplicate questline id ${definition.id}`);
      }
      ids.add(definition.id);
      validator.validate(definition);
    }

    const [main, ...side] = definitions;
    if (main!.offeredAfter !== undefined) {
      throw new QuestError('E_INVALID_FLOW', `questline set: the main questline ${main!.id} is on offer from the start and names no offeredAfter`);
    }
    const mainSteps = new Set(main!.steps.map((step) => step.stepId));
    for (const definition of side) {
      if (definition.offeredAfter !== undefined && !mainSteps.has(definition.offeredAfter)) {
        throw new QuestError('E_INVALID_FLOW', `questline set: ${definition.id} is offered after ${definition.offeredAfter}, which is no step of the main questline ${main!.id}`);
      }
    }
  }
}

/**
 * Whether a questline is on offer to the player: the main one and a side job
 * without `offeredAfter` from the start, a gated one once the main questline
 * has finished that step. A job already under way stays on offer, so a game
 * saved before its gate existed keeps it.
 */
export function isOffered(definition: QuestlineDefinition, state: QuestlineState, main: QuestlineState | undefined): boolean {
  if (definition.offeredAfter === undefined || state.completedStepIds.length > 0) return true;
  return main?.completedStepIds.includes(definition.offeredAfter) ?? false;
}
