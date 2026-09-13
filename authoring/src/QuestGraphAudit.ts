import { FlowValidator, QuestError } from '../../runtime.js';
import { AuthoringError } from './AuthoringError.js';
import type { QuestlineDefinition } from './schema.js';

/** Adapts the shared flow validator to the authoring error envelope. */
export class QuestGraphAudit {
  validate(definition: QuestlineDefinition): void {
    try {
      new FlowValidator().validate(definition);
    } catch (error) {
      if (!(error instanceof QuestError)) throw error;
      throw new AuthoringError('E_INVALID_FLOW', 'adapted questline failed flow validation', [error.message]);
    }
  }
}
