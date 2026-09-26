import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import type { InvestigationRequest, MissionAssetCreateRequest, MissionAssetFamily, MissionAssetInteraction, MissionItemBinding } from './schema.js';

type MaterialSlot = MissionAssetCreateRequest['materials'][number]['slot'];

/** Engine mission-assets v1.0 family rules, mirrored so a bad request fails here rather than in the game. */
interface FamilyRule {
  min: [number, number, number];
  max: [number, number, number];
  interactions: MissionAssetInteraction[];
  /** Material kinds (a key's middle part) a surface or accent may use. */
  surfaceKinds: string[];
  slots: MaterialSlot[];
  requiredSlots?: MaterialSlot[];
}

/**
 * Document and data-drive heights start at 12.5 mm, the height the creator's geometry needs: its document clip
 * and drive ridge are 8% of the height and no primitive may be under 1 mm, in every variant.
 */
const RULES: Record<MissionAssetFamily, FamilyRule> = {
  document: { min: [0.08, 0.0125, 0.08], max: [1.2, 0.12, 1.5], interactions: ['inspect', 'read', 'take'], surfaceKinds: ['fabric', 'plastic', 'metal'], slots: ['surface', 'accent'] },
  'data-drive': { min: [0.03, 0.0125, 0.03], max: [0.5, 0.2, 0.5], interactions: ['inspect', 'take', 'use'], surfaceKinds: ['metal', 'plastic'], slots: ['surface', 'accent'] },
  'evidence-container': { min: [0.15, 0.08, 0.12], max: [2.5, 1.5, 1.5], interactions: ['inspect', 'open', 'close', 'store'], surfaceKinds: ['metal', 'plastic', 'wood'], slots: ['surface', 'accent'] },
  tool: { min: [0.08, 0.12, 0.04], max: [1.5, 2.2, 0.8], interactions: ['inspect', 'take', 'use'], surfaceKinds: ['metal', 'plastic', 'rubber'], slots: ['surface', 'accent', 'grip'] },
  'control-terminal': { min: [0.3, 0.4, 0.2], max: [3, 3, 1.5], interactions: ['inspect', 'use', 'access', 'hack', 'sabotage'], surfaceKinds: ['metal', 'plastic'], slots: ['surface', 'accent', 'display'], requiredSlots: ['surface', 'display'] },
  package: { min: [0.08, 0.05, 0.08], max: [2.5, 2, 2.5], interactions: ['inspect', 'take', 'open'], surfaceKinds: ['fabric', 'plastic', 'wood', 'metal'], slots: ['surface', 'seal'] },
  table: { min: [0.5, 0.4, 0.4], max: [5, 1.3, 3], interactions: ['inspect', 'place-item'], surfaceKinds: ['wood', 'metal', 'glass'], slots: ['surface', 'accent'] },
  chair: { min: [0.35, 0.5, 0.35], max: [1.5, 1.8, 1.5], interactions: ['inspect', 'sit'], surfaceKinds: ['wood', 'metal', 'plastic', 'fabric'], slots: ['surface', 'accent', 'upholstery'] },
  shelf: { min: [0.3, 0.5, 0.15], max: [5, 4, 1.5], interactions: ['inspect', 'store', 'place-item'], surfaceKinds: ['wood', 'metal', 'glass'], slots: ['surface', 'accent'] },
  cabinet: { min: [0.35, 0.5, 0.25], max: [4, 3.5, 2], interactions: ['inspect', 'open', 'close', 'store'], surfaceKinds: ['wood', 'metal', 'glass'], slots: ['surface', 'accent'] },
};

/** Slots with their own material kinds, whatever the family. */
const SLOT_KINDS: Partial<Record<MaterialSlot, string[]>> = {
  display: ['ad-screen', 'glass'],
  upholstery: ['fabric', 'plastic'],
  grip: ['rubber', 'plastic', 'fabric'],
  seal: ['rubber', 'plastic', 'fabric', 'metal'],
};

/** A request the player can pick up: a portable family with a take anchor. */
export const takeable = (request: MissionAssetCreateRequest): boolean =>
  ['document', 'data-drive', 'tool', 'package'].includes(request.family) && request.requiredInteractions.includes('take');

export class MissionAssetAudit {
  validate(
    definitions: QuestlineDefinition[],
    requests: MissionAssetCreateRequest[],
    bindings: MissionItemBinding[],
    investigations: InvestigationRequest[],
  ): void {
    const requestIds = new Set<string>();
    for (const request of requests) {
      this.validateRequest(request);
      if (requestIds.has(request.assetId)) this.fail(`duplicate mission asset ${request.assetId}`);
      requestIds.add(request.assetId);
    }

    const questlines = new Map(definitions.map((definition) => [definition.id, definition]));
    const seenBindings = new Set<string>();
    const embeddedAssetIds = investigationAssetIds(investigations);
    for (const binding of bindings) {
      const key = `${binding.questId}\u0000${binding.itemId}`;
      if (seenBindings.has(key)) this.fail(`duplicate mission item binding ${binding.questId}/${binding.itemId}`);
      seenBindings.add(key);
      const definition = questlines.get(binding.questId);
      if (definition === undefined) this.fail(`mission item binding names unknown quest ${binding.questId}`);
      const item = definition.items.find((candidate) => candidate.itemId === binding.itemId);
      if (item === undefined) this.fail(`mission item binding names unknown item ${binding.questId}/${binding.itemId}`);
      if (item.kind === 'information') this.fail(`information item ${binding.questId}/${binding.itemId} cannot bind a rendered asset`);
      if (!requestIds.has(binding.assetId)) this.fail(`mission item binding names unknown asset ${binding.assetId}`);
      if (embeddedAssetIds.has(binding.assetId)) this.fail(`investigation asset ${binding.assetId} cannot also bind a quest item`);
    }
    const requestById = new Map(requests.map((request) => [request.assetId, request]));
    const bindingByItem = new Map(bindings.map((binding) => [`${binding.questId}\u0000${binding.itemId}`, binding]));
    for (const definition of definitions) {
      for (const step of definition.steps) {
        if (step.target.kind !== 'pickup') continue;
        const binding = bindingByItem.get(`${definition.id}\u0000${step.target.itemId}`);
        if (binding === undefined) this.fail(`pickup ${definition.id}/${step.stepId} has no mission asset binding`);
        if (!takeable(requestById.get(binding.assetId)!)) {
          this.fail(`pickup ${definition.id}/${step.stepId} requires a portable mission asset with a take interaction anchor`);
        }
      }
    }
  }

  private validateRequest(request: MissionAssetCreateRequest): void {
    const rule = RULES[request.family];
    const dimensions = [request.dimensions?.width, request.dimensions?.height, request.dimensions?.depth];
    if (dimensions.some((value, index) => value! < rule.min[index]! || value! > rule.max[index]!)) {
      this.fail(`mission asset ${request.assetId} dimensions do not fit ${request.family}`);
    }
    const invalidInteractions = request.requiredInteractions.filter((interaction) => !rule.interactions.includes(interaction));
    if (invalidInteractions.length > 0 || (request.requiredInteractions.includes('close') && !request.requiredInteractions.includes('open'))) {
      this.fail(`mission asset ${request.assetId} has incompatible interactions`);
    }
    const slots = new Set<string>();
    for (const material of request.materials) {
      if (!rule.slots.includes(material.slot)) {
        this.fail(`mission asset ${request.assetId} has an incompatible material slot`);
      }
      if (slots.has(material.slot)) this.fail(`mission asset ${request.assetId} repeats material slot ${material.slot}`);
      slots.add(material.slot);
      const kind = material.key.split('/')[1]!;
      if (!(SLOT_KINDS[material.slot] ?? rule.surfaceKinds).includes(kind)) {
        this.fail(`mission asset ${request.assetId} cannot use ${kind} material on its ${material.slot}`);
      }
    }
    for (const slot of rule.requiredSlots ?? ['surface']) if (!slots.has(slot)) this.fail(`mission asset ${request.assetId} requires material slot ${slot}`);
    const minimumApproach = request.requiredInteractions.includes('sit') ? 0.9 :
      request.requiredInteractions.includes('open') && ['cabinet', 'evidence-container'].includes(request.family)
        ? Math.max(0.75, Math.min(2, request.dimensions.depth)) : 0.75;
    if (request.clearance.approachDepth < minimumApproach || request.clearance.approachDepth > 4 || request.clearance.sideMargin < 0.2 || request.clearance.sideMargin > 2 || request.clearance.overhead < 0.1 || request.clearance.overhead > 3) {
      this.fail(`mission asset ${request.assetId} clearance is too small or outside the contract`);
    }
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}

function investigationAssetIds(investigations: InvestigationRequest[]): Set<string> {
  const ids = new Set<string>();
  for (const scene of investigations) {
    for (const prop of scene.contractVersion === '1.1' ? scene.props : []) {
      if (!isRecord(prop) || !isRecord(prop.missionAsset)) continue;
      if (typeof prop.missionAsset.assetId === 'string') ids.add(prop.missionAsset.assetId);
    }
  }
  return ids;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
