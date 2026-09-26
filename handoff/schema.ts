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

export type MechanicTargetBinding =
  | { questId: string; stepId: string; releaseTargetId: string; assetId: string; interactionId: 'open' | 'use' }
  | { questId: string; stepId: string; accessPointId: string; assetId: string; interactionId: 'access' }
  | { questId: string; stepId: string; targetId: string; assetId: string; interactionId: 'hack' | 'sabotage' };

export type TransportationMode = Extract<StepTarget, { kind: 'transportation' }>['mode'];

/** The scenery a host stages, as Engine scenery declares it: the whole vocabulary a scene may use. */
export interface SceneryCapabilities {
  contractVersion: '1.0';
  placeKinds: string[];
  poses: string[];
  propKinds: string[];
  lightingPresets: string[];
  limits: { actors: number; props: number };
}

export interface HostCapabilities {
  transportationModes: TransportationMode[];
  /** Declared, never inferred: a bundle without it carries no scene. */
  scenery?: SceneryCapabilities;
}

export interface InvestigationQuestBinding {
  stepId: string;
  evidenceId: string;
  place: { parcelId: string } | { districtId: string };
  completionAction: 'inspect' | 'take';
}

export type InvestigationEvidence = { evidenceId: string; factId: string; portable: boolean; prerequisiteEvidenceIds: string[] } & Record<string, unknown>;

/** Consumed binding-bearing slice of the engine v1.1 request. Other fields remain owned and validated by engine investigation. */
export interface InvestigationSceneRequest extends Record<string, unknown> {
  contractVersion: '1.1';
  sceneId: string;
  questId: string;
  questBindings: InvestigationQuestBinding[];
  location: { placeId: string } & Record<string, unknown>;
  evidence: InvestigationEvidence[];
  props: unknown[];
}

/** An engine v1.2 request: evidence over the scenery scene it links, each shown on one of that scene's elements. */
export interface LinkedInvestigationRequest extends Record<string, unknown> {
  contractVersion: '1.2';
  sceneId: string;
  questId: string;
  questBindings: InvestigationQuestBinding[];
  scenery: { sceneId: string };
  evidenceVisuals: { evidenceId: string; entityId: string }[];
  evidence: InvestigationEvidence[];
}

export type InvestigationRequest = InvestigationSceneRequest | LinkedInvestigationRequest;

/** When a scene stands, over its own questline; the vocabulary of the flow predicates, plus `never`. */
export type SceneCondition =
  | { all: SceneCondition[] }
  | { any: SceneCondition[] }
  | { not: SceneCondition }
  | { kind: 'stepActive' | 'stepDone'; stepId: string }
  | { kind: 'flagSet' | 'flagNotSet'; flag: string }
  | { kind: 'roleDead'; roleId: string }
  | { kind: 'questStarted' | 'questEnded' | 'never' };

export interface SceneActor {
  actorId: string;
  role: string;
  /** A quest role only as a corpse; everybody alive is anonymous. */
  identity: { kind: 'cast'; roleId: string } | { kind: 'anonymous'; gender: 'male' | 'female'; appearanceSeed: number };
  pose: string;
  placement: { zone: string; nearEntityId?: string };
}

export interface SceneProp {
  propId: string;
  kind: string;
  /** A mission-asset prop's asset, which the bundle requests. */
  assetId?: string;
  zone?: string;
  nearActorId?: string;
  nearPropId?: string;
}

export type ScenePlace =
  | { kind: 'room' | 'story-slot'; parcelId: string; floor: number; roomId?: string; roomKinds?: string[] }
  | { kind: 'parcel-entry'; parcelId: string }
  | { kind: 'street'; parcelId: string; width?: number; depth?: number };

/** Consumed slice of an Engine scenery scene spec 1.0; Engine scenery owns and validates the rest. */
export interface SceneSpec {
  contractVersion: '1.0';
  sceneId: string;
  questId: string;
  seed: number;
  purpose: string;
  place: ScenePlace;
  actors: SceneActor[];
  props: SceneProp[];
  lighting?: { preset: string };
  activeWhen: SceneCondition;
  retireWhen?: SceneCondition;
  investigationSceneId?: string;
}

export interface HandoffInput {
  hostCapabilities?: HostCapabilities;
  investigations?: InvestigationRequest[];
  mechanicTargetBindings?: MechanicTargetBinding[];
  missionAssetRequests?: MissionAssetCreateRequest[];
  missionItemBindings?: MissionItemBinding[];
  scenery?: SceneSpec[];
}

export interface HandoffBundle {
  hostCapabilities: HostCapabilities;
  questlines: QuestlineDefinition[];
  objectives: ObjectiveProjection[];
  investigations: InvestigationRequest[];
  mechanicTargetBindings: MechanicTargetBinding[];
  missionAssetRequests: MissionAssetCreateRequest[];
  missionItemBindings: MissionItemBinding[];
  scenery: SceneSpec[];
}
