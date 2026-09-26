import { createHash } from 'node:crypto';
import { QuestError } from '../../errors.js';
import type { ItemKind, QuestItem, QuestlineDefinition } from '../../flow/schema.js';
import { HandoffInputBoundary } from '../../handoff/HandoffInputBoundary.js';
import { MissionAssetAudit, takeable } from '../../handoff/MissionAssetAudit.js';
import { questItemAssetId } from '../../handoff/SceneStagings.js';
import type { HandoffInput, MissionAssetCreateRequest } from '../../handoff/schema.js';

type PhysicalKind = Exclude<ItemKind, 'information'>;
type Template = Pick<MissionAssetCreateRequest, 'family' | 'dimensions' | 'materials' | 'requiredInteractions' | 'clearance'>;

/** Authored appearances only. Identity, purpose and seed come from the finished quest item. */
export type MissionItemTemplates = Partial<Record<PhysicalKind, Template>>;

const PHYSICAL: Record<PhysicalKind, null> = { device: null, weapon: null, document: null, key: null, substance: null, valuable: null };

/**
 * The request a template becomes for one quest item, under the item's own
 * asset id (`questItemAssetId`), so its pickup and a scene showing it build one
 * look; the seed is stable per questline and item too.
 */
export function itemAssetRequest(template: Template, questId: string, item: Pick<QuestItem, 'itemId' | 'name' | 'description'>): MissionAssetCreateRequest {
  const hash = createHash('sha256').update(`${questId}\u0000${item.itemId}`).digest('hex');
  return {
    ...structuredClone(template), contractVersion: '1.0', assetId: questItemAssetId(questId, item.itemId),
    purpose: `${item.name}: ${item.description}`.slice(0, 240), seed: Number.parseInt(hash.slice(0, 8), 16),
  };
}

/**
 * Checks a templates document before any story needs it: keys are physical
 * item kinds, and each template is a request the handoff accepts for a pickup.
 */
export function checkMissionItemTemplates(untrusted: unknown): MissionItemTemplates {
  if (untrusted === null || typeof untrusted !== 'object' || Array.isArray(untrusted)) {
    throw new QuestError('E_HANDOFF', 'mission item templates must be an object keyed by physical item kind');
  }
  const unknown = Object.keys(untrusted).filter((kind) => !Object.hasOwn(PHYSICAL, kind));
  if (unknown.length > 0) throw new QuestError('E_HANDOFF', `mission item templates for no physical item kind: ${unknown.join(', ')}`);
  const requests = Object.entries(untrusted as Record<string, Template>)
    .map(([kind, template]) => itemAssetRequest(template, 'templates', { itemId: kind, name: kind, description: 'template' }));
  const parsed = new HandoffInputBoundary().parse({ missionAssetRequests: requests }).missionAssetRequests!;
  new MissionAssetAudit().validate([], parsed, [], []);
  const untakeable = Object.keys(untrusted).filter((_, i) => !takeable(parsed[i]!));
  if (untakeable.length > 0) throw new QuestError('E_HANDOFF', `mission item templates a player cannot pick up: ${untakeable.join(', ')}`);
  return untrusted as MissionItemTemplates;
}

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
      const asset = itemAssetRequest(template, definition.id, item);
      requests.push(asset);
      bindings.push({ questId: definition.id, itemId, assetId: asset.assetId });
      bound.add(key);
    }
  }
  return { ...input, missionAssetRequests: requests, missionItemBindings: bindings };
}
