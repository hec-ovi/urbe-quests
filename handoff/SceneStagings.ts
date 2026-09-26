/**
 * A scene as a questline stages it and the Engine records it becomes. A
 * staging names only story things (a step, a quest character, a quest item,
 * a clue) and a closed vocabulary; code turns it into an Engine scene spec
 * whose building is the one its step happens in, whose people get stable
 * appearance seeds, and whose clues become a 1.2 investigation over it.
 */

import { createHash } from 'node:crypto';
import { QuestError } from '../errors.js';
import type { PlaceTarget, QuestlineDefinition, QuestStep } from '../flow/schema.js';
import { HostCapabilityAudit } from './HostCapabilityAudit.js';
import { InvestigationAudit } from './InvestigationAudit.js';
import { SceneryAudit } from './SceneryAudit.js';
import vocabulary from './schema/scenery-binding-slice.schema.json' with { type: 'json' };
import type { LinkedInvestigationRequest, SceneCondition, ScenePlace, SceneSpec, SceneryCapabilities } from './schema.js';

const defs = vocabulary.$defs;

/** Everything a host can declare: the Engine scenery vocabulary this handoff mirrors. */
export const SCENERY_VOCABULARY: SceneryCapabilities = {
  contractVersion: '1.0',
  placeKinds: defs.placeKind.enum,
  poses: defs.pose.enum,
  propKinds: defs.propKind.enum,
  lightingPresets: defs.lightingPreset.enum,
  limits: {
    actors: defs.capabilities.properties.limits.properties.actors.maximum,
    props: defs.capabilities.properties.limits.properties.props.maximum,
  },
};
export const SCENE_PURPOSES: readonly string[] = defs.purpose.enum;
export const SCENE_ROLES: readonly string[] = defs.actorRole.enum;
export const SCENE_ZONES: readonly string[] = defs.zone.enum;
export const ROOM_KINDS: readonly string[] = defs.roomKind.enum;
/** A quest character stands in a scene only in one of these. */
export const CORPSE_POSES: readonly string[] = defs.corpsePose.enum;

export interface StagedActor {
  actorId: string;
  role: string;
  pose: string;
  /** A quest character, only dead; everybody else names a gender. */
  roleId?: string;
  gender?: 'male' | 'female';
  zone?: string;
  /** An actor listed before this one. */
  nearActorId?: string;
}

export interface StagedProp {
  propId: string;
  kind: string;
  /** A mission asset shows this physical quest item in its own asset; never one a pickup step stands in the city. */
  itemId?: string;
  nearActorId?: string;
  /** A mission-asset prop listed before this one. */
  nearPropId?: string;
}

export interface SceneStaging {
  /** Authored and short; a build ships it as `<questId>.<sceneId>` (`scopedScenes`). */
  sceneId: string;
  purpose: string;
  /** What the player walks into, in the story's words. */
  description: string;
  /** The step that brings the scene into the world, once it is active or once it is done. */
  stagedBy: string;
  stagedWhen: 'active' | 'done';
  /** Where it stands: the building step `atStepId` happens in, on its ground floor; a scene with clues names one of its clue steps. */
  place: { kind: string; atStepId: string; roomKinds?: string[] };
  actors: StagedActor[];
  props: StagedProp[];
  /** Which element shows each clue of the investigation steps naming this sceneId. */
  evidence?: { evidenceId: string; elementId: string }[];
  /** The scene clears once this step is done; else when the questline ends, unless it is lasting. */
  clearedBy?: string;
  lasting?: boolean;
}

/** What a questline's stagings become: scene specs, the investigations over them and the quest items their props show. */
export interface StagedScenery {
  scenery: SceneSpec[];
  investigations: LinkedInvestigationRequest[];
  /** Each quest item a scene shows, once per scene, with the asset its props name. */
  assets: { assetId: string; questId: string; sceneId: string; itemId: string }[];
}

const digest = (identity: string): string => createHash('sha256').update(identity).digest('hex');
const seedOf = (identity: string): number => Number.parseInt(digest(identity).slice(0, 8), 16);

/** The id a staging ships under, as a scene spec and as the investigation over it: questline ids are unique in a bundle, so these are too. */
export const sceneSpecId = (questId: string, sceneId: string): string => `${questId}.${sceneId}`;

/** A physical quest item's own asset, the one its pickup and every scene prop showing it name: stable per questline and item. */
export const questItemAssetId = (questId: string, itemId: string): string =>
  `quest-item.${digest(`${questId}\u0000${itemId}`).slice(0, 32)}`;

/**
 * A questline and its stagings as a build ships them: each sceneId becomes
 * `<questId>.<sceneId>` on its staging and on the investigation steps naming
 * it, so questlines built apart never share a scene or an investigation.
 */
export function scopedScenes(
  definition: QuestlineDefinition,
  stagings: readonly SceneStaging[],
): { definition: QuestlineDefinition; stagings: SceneStaging[] } {
  if (stagings.length === 0) return { definition, stagings: [] };
  const staged = new Set(stagings.map((staging) => staging.sceneId));
  const scoped = (sceneId: string) => sceneSpecId(definition.id, sceneId);
  const steps = definition.steps.map((step) => (step.target.kind === 'investigation' && staged.has(step.target.sceneId)
    ? { ...step, target: { ...step.target, sceneId: scoped(step.target.sceneId) } }
    : step));
  return {
    definition: { ...definition, steps },
    stagings: stagings.map((staging) => ({ ...staging, sceneId: scoped(staging.sceneId) })),
  };
}

/**
 * What is wrong inside one staging, with no questline in view: element ids,
 * who may be a quest character, what stands near what, which element shows
 * which clue, and how the scene clears.
 */
export function stagingProblems(staging: SceneStaging): string[] {
  const problems: string[] = [];
  const at = `scene ${staging.sceneId}`;
  const elements = new Set<string>();
  const add = (id: string) => {
    if (elements.has(id)) problems.push(`${at} names element ${id} twice`);
    elements.add(id);
  };
  const actors = new Set<string>();
  for (const actor of staging.actors) {
    const who = `${at} actor ${actor.actorId}`;
    if ((actor.roleId === undefined) === (actor.gender === undefined)) {
      problems.push(`${who} names a roleId (a quest character, dead) or a gender (anyone else), exactly one`);
    }
    if (actor.roleId !== undefined && !CORPSE_POSES.includes(actor.pose)) {
      problems.push(`${who} is quest character ${actor.roleId}, who stands in a scene only dead (${CORPSE_POSES.join(' or ')}); a living figure is anonymous, with a gender`);
    }
    if (actor.nearActorId !== undefined && !actors.has(actor.nearActorId)) problems.push(`${who} is near ${actor.nearActorId}, which is no actor listed before it`);
    add(actor.actorId);
    actors.add(actor.actorId);
  }
  const assets = new Set<string>();
  for (const prop of staging.props) {
    const what = `${at} prop ${prop.propId}`;
    const asset = prop.kind === 'mission-asset';
    if (asset && prop.itemId === undefined) problems.push(`${what} is a mission asset: name the itemId of the physical quest item it shows`);
    if (!asset && prop.itemId !== undefined) problems.push(`${what} is a ${prop.kind} mark on the floor and shows no item`);
    if (prop.nearActorId !== undefined && prop.nearPropId !== undefined) problems.push(`${what} is near one element, not two`);
    if (prop.nearActorId !== undefined && !actors.has(prop.nearActorId)) problems.push(`${what} is near ${prop.nearActorId}, which is no actor of the scene`);
    if (prop.nearPropId !== undefined && !assets.has(prop.nearPropId)) problems.push(`${what} is near ${prop.nearPropId}, which is no mission-asset prop listed before it`);
    add(prop.propId);
    if (asset) assets.add(prop.propId);
  }
  const clues = new Set<string>();
  const shown = new Set<string>();
  for (const { evidenceId, elementId } of staging.evidence ?? []) {
    if (clues.has(evidenceId)) problems.push(`${at} shows clue ${evidenceId} twice`);
    if (shown.has(elementId)) problems.push(`${at} shows two clues on ${elementId}; one element shows one clue`);
    if (!elements.has(elementId)) problems.push(`${at} shows clue ${evidenceId} on ${elementId}, which is no actor or prop of the scene`);
    clues.add(evidenceId);
    shown.add(elementId);
  }
  if (staging.clearedBy !== undefined && staging.lasting === true) problems.push(`${at} is cleared by a step or lasting, not both`);
  if (staging.clearedBy === staging.stagedBy && staging.stagedWhen === 'done') {
    problems.push(`${at} would appear and clear as step ${staging.stagedBy} is done, so it never stands; stage it while that step is active, or clear it by a later step`);
  }
  if (staging.place.roomKinds !== undefined && staging.place.kind !== 'room' && staging.place.kind !== 'story-slot') {
    problems.push(`${at}: roomKinds narrow a room or story-slot place, not a ${staging.place.kind}`);
  }
  return problems;
}

/**
 * What is wrong with a staging against the questline's steps as they stand,
 * every step or those added so far: its place step happens in no building, a
 * scene with clues stands anywhere but at one of its clue steps (casting may
 * move a step, and a scene moves with the step it names), or a prop shows an
 * item a pickup step already stands in the city.
 */
export function stagingConflicts(definition: Pick<QuestlineDefinition, 'steps' | 'items'>, staging: SceneStaging): string[] {
  const problems: string[] = [];
  const { atStepId } = staging.place;
  const at = definition.steps.find((step) => step.stepId === atStepId);
  if (at !== undefined && buildingOf(definition, at) === undefined) {
    problems.push(`place.atStepId ${atStepId} (${at.target.kind}) happens in no building; name a step that meets its people in a building, goes to or ends at one, or finds its item there, such as the investigation step whose clue the scene shows`);
  }
  const clues = clueSteps(definition, staging.sceneId).map(({ stepId }) => stepId);
  if (clues.length > 0 && !clues.includes(atStepId)) {
    problems.push(`scene ${staging.sceneId} shows the clue of investigation step ${clues.join(', ')}, so it stands where that step happens: set place.atStepId to ${clues[0]}`);
  }
  for (const prop of staging.props) {
    const pickup = prop.itemId === undefined ? undefined : definition.steps.find((step) => step.target.kind === 'pickup' && step.target.itemId === prop.itemId);
    if (pickup !== undefined) {
      problems.push(`prop ${prop.propId} shows ${prop.itemId}, which pickup step ${pickup.stepId} already stands in the city for the player to take; leave it out of the scene`);
    }
  }
  return problems;
}

/** Investigation steps whose clue no staging shows. */
export function unstagedClues(definition: QuestlineDefinition, stagings: readonly SceneStaging[]): QuestStep[] {
  const shown = new Set(stagings.flatMap((staging) => (staging.evidence ?? []).map(({ evidenceId }) => `${staging.sceneId}\u0000${evidenceId}`)));
  return definition.steps.filter((step) => step.target.kind === 'investigation' && !shown.has(`${step.target.sceneId}\u0000${step.target.evidenceId}`));
}

/**
 * The Engine records one questline's stagings become, under the ids the
 * stagings carry (scoped, as a build ships them). A scene stands in the
 * building its `atStepId` step happens in, from when its step is active or
 * done, and a quest character in it only once the simulation holds them dead.
 * A prop shows its quest item in the asset `itemAssets` binds the item to,
 * else in the item's own (`questItemAssetId`). The investigation steps naming
 * its sceneId become one 1.2 investigation under the same id that shows each
 * clue on the element its staging names.
 */
export function stagedScenery(
  definition: QuestlineDefinition,
  stagings: readonly SceneStaging[],
  itemAssets: ReadonlyMap<string, string> = new Map(),
): StagedScenery {
  const fail = (message: string): never => {
    throw new QuestError('E_HANDOFF', `${definition.id}: ${message}`);
  };
  const steps = new Map(definition.steps.map((step) => [step.stepId, step]));
  const items = new Map(definition.items.map((item) => [item.itemId, item]));
  const roles = new Set(definition.roles.map((role) => role.roleId));
  const result: StagedScenery = { scenery: [], investigations: [], assets: [] };
  const staged = new Set<string>();

  for (const staging of stagings) {
    const { sceneId } = staging;
    const problems = stagingProblems(staging);
    if (problems.length > 0) fail(problems.join('; '));
    if (staged.has(sceneId)) fail(`scene ${sceneId} is staged twice`);
    staged.add(sceneId);
    for (const stepId of [staging.place.atStepId, staging.stagedBy, ...(staging.clearedBy !== undefined ? [staging.clearedBy] : [])]) {
      if (!steps.has(stepId)) fail(`scene ${sceneId} names step ${stepId}, which the questline lacks`);
    }
    const conflicts = stagingConflicts(definition, staging);
    if (conflicts.length > 0) fail(conflicts.join('; '));
    const parcelId = buildingOf(definition, steps.get(staging.place.atStepId)!)!;

    for (const actor of staging.actors) {
      if (actor.roleId !== undefined && !roles.has(actor.roleId)) fail(`scene ${sceneId} actor ${actor.actorId} names role ${actor.roleId}, which the questline lacks`);
    }
    const shows = new Map<string, string>();
    for (const { propId, itemId } of staging.props) {
      if (itemId === undefined) continue;
      const item = items.get(itemId);
      if (item === undefined || item.kind === 'information') fail(`scene ${sceneId} prop ${propId} shows ${itemId}, which is no physical item of the questline`);
      shows.set(itemId, itemAssets.get(itemId) ?? questItemAssetId(definition.id, itemId));
    }
    for (const [itemId, assetId] of shows) result.assets.push({ assetId, questId: definition.id, sceneId, itemId });

    // A clue is found only while its scene stands, so the scene stands before its clue step is done and clears no sooner.
    const clues = clueSteps(definition, sceneId);
    for (const { stepId } of clues) {
      if (stepsAfter(definition, stepId).has(staging.stagedBy) || (staging.stagedBy === stepId && staging.stagedWhen === 'done')) {
        fail(`scene ${sceneId} would stand only after its clue step ${stepId} is done, so that clue could never be found; stage it by a step before ${stepId}, or by ${stepId} while it is active`);
      }
      if (staging.clearedBy !== undefined && staging.clearedBy !== stepId && stepsAfter(definition, staging.clearedBy).has(stepId)) {
        fail(`scene ${sceneId} clears once step ${staging.clearedBy} is done, before its clue step ${stepId} can be; clear it by ${stepId} or a step after it`);
      }
    }
    result.scenery.push({
      contractVersion: '1.0',
      sceneId,
      questId: definition.id,
      seed: seedOf(`${definition.id}\u0000${sceneId}`),
      purpose: staging.purpose,
      place: placeOf(staging.place, parcelId),
      actors: staging.actors.map((actor) => ({
        actorId: actor.actorId,
        role: actor.role,
        identity: actor.roleId !== undefined
          ? { kind: 'cast', roleId: actor.roleId }
          : { kind: 'anonymous', gender: actor.gender!, appearanceSeed: seedOf(`${definition.id}\u0000${sceneId}\u0000${actor.actorId}`) },
        pose: actor.pose,
        placement: { zone: actor.zone ?? (actor.nearActorId !== undefined ? 'incident' : 'center'), ...(actor.nearActorId !== undefined ? { nearEntityId: actor.nearActorId } : {}) },
      })),
      props: staging.props.map((prop) => ({
        propId: prop.propId,
        kind: prop.kind,
        ...(prop.itemId !== undefined ? { assetId: shows.get(prop.itemId)! } : {}),
        ...(prop.nearActorId !== undefined ? { nearActorId: prop.nearActorId } : {}),
        ...(prop.nearPropId !== undefined ? { nearPropId: prop.nearPropId } : {}),
      })),
      activeWhen: activeWhen(staging),
      ...(staging.clearedBy !== undefined ? { retireWhen: { kind: 'stepDone', stepId: staging.clearedBy } }
        : staging.lasting === true ? { retireWhen: { kind: 'never' } } : {}),
      ...(clues.length > 0 ? { investigationSceneId: sceneId } : {}),
    });

    const shownOn = new Map((staging.evidence ?? []).map(({ evidenceId, elementId }) => [evidenceId, elementId]));
    for (const evidenceId of shownOn.keys()) {
      if (!clues.some(({ clue }) => clue.evidenceId === evidenceId)) fail(`scene ${sceneId} shows clue ${evidenceId}, which no investigation step of scene ${sceneId} names`);
    }
    if (clues.length === 0) continue;
    const assetProps = new Set(staging.props.filter((prop) => prop.kind === 'mission-asset').map((prop) => prop.propId));
    const linked = clues.map(({ stepId, clue }) => {
      if (!('parcelId' in clue.place) || clue.place.parcelId !== parcelId) {
        fail(`investigation step ${stepId} is not in the building scene ${sceneId} stands in (${parcelId}, where step ${staging.place.atStepId} happens)`);
      }
      const entityId = shownOn.get(clue.evidenceId) ?? fail(`investigation step ${stepId} shows its clue ${clue.evidenceId} on nothing in scene ${sceneId}`);
      const item = items.get(clue.evidenceItemId)!;
      return {
        binding: { stepId, evidenceId: clue.evidenceId, place: { parcelId }, completionAction: 'inspect' as const },
        visual: { evidenceId: clue.evidenceId, entityId },
        evidence: {
          evidenceId: clue.evidenceId, factId: clue.evidenceItemId, label: item.name, description: item.description,
          // A mission asset is a portable quest item's look: a clue on it is portable, and read before it is taken.
          portable: assetProps.has(entityId), requiresInspection: true, prerequisiteEvidenceIds: [], consequences: [],
        },
      };
    });
    result.investigations.push({
      contractVersion: '1.2',
      sceneId,
      questId: definition.id,
      incident: { family: staging.purpose, summary: staging.description },
      questBindings: linked.map(({ binding }) => binding),
      scenery: { sceneId },
      evidenceVisuals: linked.map(({ visual }) => visual),
      evidence: linked.map(({ evidence }) => evidence),
    });
  }
  return result;
}

/**
 * The scenes one questline stages, compiled and audited as the handoff and a
 * host declaring `scenery` take them. Throws E_HANDOFF with the first problem.
 */
export function auditStagings(definition: QuestlineDefinition, stagings: readonly SceneStaging[], scenery: SceneryCapabilities): void {
  const staged = stagedScenery(definition, stagings);
  new SceneryAudit().validate([definition], staged.scenery, staged.investigations, new Set(staged.assets.map((asset) => asset.assetId)));
  new InvestigationAudit().validate([definition], staged.investigations, staged.scenery);
  new HostCapabilityAudit().validateScenery(staged.scenery, scenery);
}

/** The investigation steps whose clue a scene shows: those naming its sceneId. */
function clueSteps(definition: Pick<QuestlineDefinition, 'steps'>, sceneId: string) {
  return definition.steps.flatMap((step) =>
    step.target.kind === 'investigation' && step.target.sceneId === sceneId ? [{ stepId: step.stepId, clue: step.target }] : []);
}

/** Every step the flow reaches from this one along its next edges. */
function stepsAfter(definition: QuestlineDefinition, stepId: string): Set<string> {
  const next = new Map(definition.steps.map((step) => [step.stepId, step.next.map((edge) => edge.toStepId)]));
  const reached = new Set<string>();
  const visit = (id: string): void => {
    for (const to of next.get(id) ?? []) {
      if (reached.has(to)) continue;
      reached.add(to);
      visit(to);
    }
  };
  visit(stepId);
  return reached;
}

/** The step's building: where it meets its people, where it goes or ends, or where its item lies. */
function buildingOf(definition: Pick<QuestlineDefinition, 'items'>, step: QuestStep): string | undefined {
  const t = step.target;
  const parcel = (place: PlaceTarget) => ('parcelId' in place ? place.parcelId : undefined);
  if ('atParcelId' in t) return t.atParcelId;
  if ('to' in t) return parcel(t.to);
  if ('place' in t) return parcel(t.place);
  if (t.kind === 'pickup') return definition.items.find((item) => item.itemId === t.itemId)?.atParcelId;
  return undefined;
}

/** Stagings stand on the ground floor, the one floor every building has: a questline does not know how tall its buildings are. Any room of a kind the staging allows. */
function placeOf(place: SceneStaging['place'], parcelId: string): ScenePlace {
  if (place.kind === 'room' || place.kind === 'story-slot') {
    return { kind: place.kind, parcelId, floor: 0, roomKinds: [...(place.roomKinds ?? ROOM_KINDS)] };
  }
  return { kind: place.kind as 'parcel-entry' | 'street', parcelId };
}

/** From its step on, and for a quest character only once the simulation holds them dead. */
function activeWhen(staging: SceneStaging): SceneCondition {
  const stepId = staging.stagedBy;
  const step: SceneCondition = staging.stagedWhen === 'done'
    ? { kind: 'stepDone', stepId }
    : { any: [{ kind: 'stepActive', stepId }, { kind: 'stepDone', stepId }] };
  const dead: SceneCondition[] = staging.actors.flatMap((actor) => (actor.roleId !== undefined ? [{ kind: 'roleDead' as const, roleId: actor.roleId }] : []));
  return dead.length > 0 ? { all: [step, ...dead] } : step;
}
