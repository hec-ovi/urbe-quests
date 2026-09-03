import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import type { HostCapabilities, TransportationMode } from './schema.js';

const TRANSPORTATION_MODES: readonly TransportationMode[] = [
  'ride-hail',
  'public-transit',
  'vehicle',
  'animal',
  'aircraft',
];

/** Refuses a runnable bundle whose authored journeys exceed the host's declared transport support. */
export class HostCapabilityAudit {
  validate(definitions: QuestlineDefinition[], capabilities: HostCapabilities): void {
    if (!isRecord(capabilities) || !sameKeys(capabilities, ['transportationModes']) || !Array.isArray(capabilities.transportationModes)) {
      this.fail('host capabilities must exactly declare transportationModes');
    }
    const modes = capabilities.transportationModes;
    if (new Set(modes).size !== modes.length || modes.some((mode) => !TRANSPORTATION_MODES.includes(mode))) {
      this.fail('host capabilities contain an invalid or duplicate transportation mode');
    }
    const supported = new Set(modes);
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

const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameKeys = (value: object, expected: string[]) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
