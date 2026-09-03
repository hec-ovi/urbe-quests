import { QuestError } from '../errors.js';
import type { HandoffInput } from './schema.js';

export class HandoffInputBoundary {
  parse(input: unknown): HandoffInput {
    if (!isRecord(input)) this.fail('handoff input must be an object');
    const allowed = new Set(['hostCapabilities', 'investigations', 'mechanicTargetBindings', 'missionAssetRequests', 'missionItemBindings']);
    if (Object.keys(input).some((key) => !allowed.has(key))) this.fail('handoff input has an unknown property');
    for (const key of ['investigations', 'mechanicTargetBindings', 'missionAssetRequests', 'missionItemBindings']) {
      const value = input[key];
      if (value !== undefined && !Array.isArray(value)) this.fail(`handoff input ${key} must be an array`);
    }
    if (input.hostCapabilities !== undefined && !isRecord(input.hostCapabilities)) {
      this.fail('handoff input hostCapabilities must be an object');
    }
    return input as HandoffInput;
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
