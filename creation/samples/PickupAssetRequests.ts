import { createHash } from 'node:crypto';
import { QuestError } from '../../errors.js';
import type { ItemKind, QuestlineDefinition } from '../../flow/schema.js';
import { HandoffInputBoundary } from '../../handoff/HandoffInputBoundary.js';
import type { HandoffInput, MissionAssetCreateRequest } from '../../handoff/schema.js';

/** Authored appearances only. Identity, purpose and seed come from the finished quest item. */
export type MissionItemTemplates = Partial<Record<Exclude<ItemKind, 'information'>, Pick<
  MissionAssetCreateRequest, 'family' | 'dimensions' | 'materials' | 'requiredInteractions' | 'clearance'
>>>;

/** Fill physical pickup bindings before publishing a playable bundle; explicit author bindings win. */
export function pickupAssetRequests(
  definitions: QuestlineDefinition[],
  untrustedInput: unknown,
  templates: MissionItemTemplates = {},
): HandoffInput {
  const input = new HandoffInputBoundary().parse(untrustedInput);
  const requests = [...(input.missionAssetRequests ?? [])];
  const bindings = [...(input.missionItemBindings ?? [])];
  const bound = new Set(bindings.map((binding) => `${binding.questId}\u0000${binding.itemId}`));
  for (const definition of definitions) {
    for (const step of definition.steps) {
      if (step.target.kind !== 'pickup') continue;
      const itemId = step.target.itemId;
      const key = `${definition.id}\u0000${itemId}`;
      if (bound.has(key)) continue;
      const item = definition.items.find((candidate) => candidate.itemId === itemId);
      if (item === undefined || item.kind === 'information') {
        throw new QuestError('E_HANDOFF', `pickup ${definition.id}/${step.stepId} requires a physical item`);
      }
      const template = templates[item.kind];
      if (template === undefined) {
        throw new QuestError('E_HANDOFF', `pickup ${definition.id}/${step.stepId} has no mission asset binding or ${item.kind} template`);
      }
      const hash = createHash('sha256').update(key).digest('hex');
      const assetId = `quest-item.${hash.slice(0, 32)}`;
      requests.push({
        ...structuredClone(template), contractVersion: '1.0', assetId,
        purpose: `${item.name}: ${item.description}`.slice(0, 240), seed: Number.parseInt(hash.slice(0, 8), 16),
      });
      bindings.push({ questId: definition.id, itemId, assetId });
      bound.add(key);
    }
  }
  return { ...input, missionAssetRequests: requests, missionItemBindings: bindings };
}
