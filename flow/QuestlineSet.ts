import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from './schema.js';
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
  }
}
