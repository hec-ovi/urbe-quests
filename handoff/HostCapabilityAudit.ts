import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import type { HostCapabilities } from './schema.js';

/** Refuses a runnable bundle whose authored journeys exceed the host's declared transport support. */
export class HostCapabilityAudit {
  validate(definitions: QuestlineDefinition[], capabilities: HostCapabilities): void {
    const supported = new Set(capabilities.transportationModes);
    for (const definition of definitions) {
      for (const step of definition.steps) {
        if (step.target.kind === 'transportation' && !supported.has(step.target.mode)) {
          this.fail(`host does not support transportation mode ${step.target.mode} for ${definition.id}/${step.stepId}`);
        }
      }
    }
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}
