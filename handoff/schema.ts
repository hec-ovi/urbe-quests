import type { QuestlineDefinition, StepTarget } from '../flow/schema.js';

export interface ObjectiveProjection {
  questId: string;
  stepId: string;
  /** Exact authored action and every identity needed to complete it. */
  action: StepTarget;
}

export type MissionAssetFamily =
  | 'document' | 'data-drive' | 'evidence-container' | 'tool' | 'control-terminal'
  | 'package' | 'table' | 'chair' | 'shelf' | 'cabinet';

export type MissionAssetInteraction =
  | 'inspect' | 'read' | 'take' | 'use' | 'open' | 'close' | 'store' | 'place-item'
  | 'sit' | 'access' | 'hack' | 'sabotage';

export interface MissionAssetCreateRequest {
  contractVersion: '1.0';
  assetId: string;
  purpose: string;
  family: MissionAssetFamily;
  dimensions: { width: number; height: number; depth: number };
  materials: { slot: 'surface' | 'accent' | 'display' | 'upholstery' | 'grip' | 'seal'; key: string; variantId: string }[];
  requiredInteractions: MissionAssetInteraction[];
  clearance: { approachDepth: number; sideMargin: number; overhead: number };
  seed: number;
}

export interface MissionItemBinding {
  questId: string;
  itemId: string;
  assetId: string;
}

export interface InvestigationQuestBinding {
  stepId: string;
  evidenceId: string;
  place: { parcelId: string } | { districtId: string };
  completionAction: 'inspect' | 'take';
}

/** Consumed binding-bearing slice of the engine v1.1 request. Other fields remain owned and validated by engine investigation. */
export interface InvestigationSceneRequest extends Record<string, unknown> {
  contractVersion: '1.1';
  sceneId: string;
  questId: string;
  questBindings: InvestigationQuestBinding[];
  location: { placeId: string } & Record<string, unknown>;
  evidence: ({ evidenceId: string; factId: string; portable: boolean; prerequisiteEvidenceIds: string[] } & Record<string, unknown>)[];
  props: unknown[];
}

export interface HandoffInput {
  investigations?: InvestigationSceneRequest[];
  missionAssetRequests?: MissionAssetCreateRequest[];
  missionItemBindings?: MissionItemBinding[];
}

export interface HandoffBundle {
  questlines: QuestlineDefinition[];
  objectives: ObjectiveProjection[];
  investigations: InvestigationSceneRequest[];
  missionAssetRequests: MissionAssetCreateRequest[];
  missionItemBindings: MissionItemBinding[];
}
