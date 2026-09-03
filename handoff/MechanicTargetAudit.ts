import { QuestError } from '../errors.js';
import type { QuestlineDefinition, StepTarget } from '../flow/schema.js';
import type { MechanicTargetBinding, MissionAssetCreateRequest, MissionAssetFamily } from './schema.js';

type BindableTarget = Extract<StepTarget, { kind: 'rescue' | 'access' | 'hacking' | 'sabotage' }>;

const FIXED_FAMILIES: ReadonlySet<MissionAssetFamily> = new Set([
  'evidence-container',
  'control-terminal',
  'table',
  'chair',
  'shelf',
  'cabinet',
]);

/** Binds every fixed mechanic identity to one exact mission assembly interaction anchor. */
export class MechanicTargetAudit {
  validate(
    definitions: QuestlineDefinition[],
    requests: MissionAssetCreateRequest[],
    bindings: MechanicTargetBinding[],
  ): void {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const requestsById = new Map(requests.map((request) => [request.assetId, request]));
    const expected = new Set(definitions.flatMap((definition) => definition.steps
      .filter((step) => isBindableTarget(step.target))
      .map((step) => bindingKey(definition.id, step.stepId))));
    const found = new Set<string>();

    for (const binding of bindings) {
      if (!isExactBinding(binding)) this.fail('mechanic target binding has an invalid shape');
      const key = bindingKey(binding.questId, binding.stepId);
      if (found.has(key)) this.fail(`duplicate mechanic target binding ${binding.questId}/${binding.stepId}`);
      const definition = definitionsById.get(binding.questId);
      if (definition === undefined) this.fail(`mechanic target binding names unknown quest ${binding.questId}`);
      const step = definition.steps.find((candidate) => candidate.stepId === binding.stepId);
      if (step === undefined) this.fail(`mechanic target binding names unknown step ${binding.questId}/${binding.stepId}`);
      if (!isBindableTarget(step.target)) this.fail(`mechanic target binding names unsupported step ${binding.questId}/${binding.stepId}`);
      this.validateTarget(binding, step.target);

      const request = requestsById.get(binding.assetId);
      if (request === undefined) this.fail(`mechanic target binding names unknown asset ${binding.assetId}`);
      if (!FIXED_FAMILIES.has(request.family)) this.fail(`mechanic target ${binding.questId}/${binding.stepId} requires a fixed mission asset`);
      if (!request.requiredInteractions.includes(binding.interactionId)) {
        this.fail(`mission asset ${binding.assetId} has no ${binding.interactionId} interaction anchor`);
      }
      found.add(key);
    }

    for (const key of expected) {
      if (!found.has(key)) {
        const [questId, stepId] = key.split('\u0000');
        this.fail(`mechanic target ${questId}/${stepId} has no mission asset binding`);
      }
    }
  }

  private validateTarget(binding: MechanicTargetBinding, target: BindableTarget): void {
    if (target.kind === 'rescue') {
      if (!('releaseTargetId' in binding) || binding.releaseTargetId !== target.releaseTargetId) {
        this.fail('rescue binding does not match its authored releaseTargetId');
      }
      return;
    }
    if (target.kind === 'access') {
      if (!('accessPointId' in binding) || binding.accessPointId !== target.accessPointId || binding.interactionId !== 'access') {
        this.fail('access binding does not match its authored accessPointId and interaction');
      }
      return;
    }
    const interactionId = target.kind === 'hacking' ? 'hack' : 'sabotage';
    if (!('targetId' in binding) || binding.targetId !== target.targetId || binding.interactionId !== interactionId) {
      this.fail(`${target.kind} binding does not match its authored targetId and interaction`);
    }
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}

function isBindableTarget(target: StepTarget): target is BindableTarget {
  return target.kind === 'rescue' || target.kind === 'access' || target.kind === 'hacking' || target.kind === 'sabotage';
}

function isExactBinding(value: unknown): value is MechanicTargetBinding {
  if (!isRecord(value) || !hasStrings(value, ['questId', 'stepId', 'assetId', 'interactionId'])) return false;
  if ('releaseTargetId' in value) {
    return sameKeys(value, ['assetId', 'interactionId', 'questId', 'releaseTargetId', 'stepId']) &&
      typeof value.releaseTargetId === 'string' && value.releaseTargetId.length > 0 &&
      (value.interactionId === 'open' || value.interactionId === 'use');
  }
  if ('accessPointId' in value) {
    return sameKeys(value, ['accessPointId', 'assetId', 'interactionId', 'questId', 'stepId']) &&
      typeof value.accessPointId === 'string' && value.accessPointId.length > 0 && value.interactionId === 'access';
  }
  return sameKeys(value, ['assetId', 'interactionId', 'questId', 'stepId', 'targetId']) &&
    typeof value.targetId === 'string' && value.targetId.length > 0 &&
    (value.interactionId === 'hack' || value.interactionId === 'sabotage');
}

const bindingKey = (questId: string, stepId: string): string => `${questId}\u0000${stepId}`;
const hasStrings = (value: Record<string, unknown>, keys: string[]): boolean =>
  keys.every((key) => typeof value[key] === 'string' && value[key].length > 0);
const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameKeys = (value: object, expected: string[]) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
