import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import type { InvestigationSceneRequest, MissionAssetCreateRequest, MissionAssetFamily, MissionAssetInteraction, MissionItemBinding } from './schema.js';

interface FamilyRule {
  min: [number, number, number];
  max: [number, number, number];
  interactions: MissionAssetInteraction[];
  slots: MissionAssetCreateRequest['materials'][number]['slot'][];
  requiredSlots?: MissionAssetCreateRequest['materials'][number]['slot'][];
}

const RULES: Record<MissionAssetFamily, FamilyRule> = {
  document: { min: [0.08, 0.002, 0.08], max: [1.2, 0.12, 1.5], interactions: ['inspect', 'read', 'take'], slots: ['surface', 'accent'] },
  'data-drive': { min: [0.03, 0.01, 0.03], max: [0.5, 0.2, 0.5], interactions: ['inspect', 'take', 'use'], slots: ['surface', 'accent'] },
  'evidence-container': { min: [0.15, 0.08, 0.12], max: [2.5, 1.5, 1.5], interactions: ['inspect', 'open', 'close', 'store'], slots: ['surface', 'accent'] },
  tool: { min: [0.08, 0.12, 0.04], max: [1.5, 2.2, 0.8], interactions: ['inspect', 'take', 'use'], slots: ['surface', 'accent', 'grip'] },
  'control-terminal': { min: [0.3, 0.4, 0.2], max: [3, 3, 1.5], interactions: ['inspect', 'use', 'access', 'hack', 'sabotage'], slots: ['surface', 'accent', 'display'], requiredSlots: ['surface', 'display'] },
  package: { min: [0.08, 0.05, 0.08], max: [2.5, 2, 2.5], interactions: ['inspect', 'take', 'open'], slots: ['surface', 'seal'] },
  table: { min: [0.5, 0.4, 0.4], max: [5, 1.3, 3], interactions: ['inspect', 'place-item'], slots: ['surface', 'accent'] },
  chair: { min: [0.35, 0.5, 0.35], max: [1.5, 1.8, 1.5], interactions: ['inspect', 'sit'], slots: ['surface', 'accent', 'upholstery'] },
  shelf: { min: [0.3, 0.5, 0.15], max: [5, 4, 1.5], interactions: ['inspect', 'store', 'place-item'], slots: ['surface', 'accent'] },
  cabinet: { min: [0.35, 0.5, 0.25], max: [4, 3.5, 2], interactions: ['inspect', 'open', 'close', 'store'], slots: ['surface', 'accent'] },
};

export class MissionAssetAudit {
  validate(
    definitions: QuestlineDefinition[],
    requests: MissionAssetCreateRequest[],
    bindings: MissionItemBinding[],
    investigations: InvestigationSceneRequest[],
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
      if (!rule.slots.includes(material.slot as never)) {
        this.fail(`mission asset ${request.assetId} has an incompatible material slot`);
      }
      if (slots.has(material.slot)) this.fail(`mission asset ${request.assetId} repeats material slot ${material.slot}`);
      slots.add(material.slot);

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

function investigationAssetIds(investigations: InvestigationSceneRequest[]): Set<string> {
  const ids = new Set<string>();
  for (const scene of investigations) {
    for (const prop of scene.props ?? []) {
      if (!isRecord(prop) || !isRecord(prop.missionAsset)) continue;
      if (typeof prop.missionAsset.assetId === 'string') ids.add(prop.missionAsset.assetId);
    }
  }
  return ids;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
