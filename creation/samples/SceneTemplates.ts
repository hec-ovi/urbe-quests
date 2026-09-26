/**
 * The scenes a set of questlines stages, as the handoff carries them. A
 * questline's stagings come from its build (stage_scene) and from a
 * recording's hand-written `sceneTemplates`; each becomes an Engine scene
 * spec, the 1.2 investigation over its clues and a request for every item a
 * prop shows, made from the recording's item templates.
 */

import { toolInputProblems } from '../../builder/checkToolInput.js';
import { stageSceneTool } from '../../builder/tools.js';
import { QuestError } from '../../errors.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { HandoffInputBoundary } from '../../handoff/HandoffInputBoundary.js';
import { SCENERY_VOCABULARY, sceneSpecId, stagedScenery, stagingProblems, type SceneStaging } from '../../handoff/SceneStagings.js';
import type { HandoffInput } from '../../handoff/schema.js';
import { templateRequest, type MissionItemTemplates } from './PickupAssetRequests.js';

/** Stagings written by hand, keyed by questline id; each names the step that stages it, as a stage_scene call does. */
export type SceneTemplates = Record<string, SceneStaging[]>;

/** Checks recorded templates as stage_scene calls over every scenery kind Engine can declare, before any story needs them. */
export function checkSceneTemplates(untrusted: unknown): SceneTemplates {
  if (untrusted === null || typeof untrusted !== 'object' || Array.isArray(untrusted)) {
    throw new QuestError('E_HANDOFF', 'scene templates must be an object keyed by questline id');
  }
  const schema = stageSceneTool(SCENERY_VOCABULARY).inputSchema as Record<string, unknown>;
  const problems = Object.entries(untrusted).flatMap(([questId, stagings]) => {
    if (!Array.isArray(stagings)) return [`${questId} holds no list of stagings`];
    return stagings.flatMap((staging: unknown, i) => {
      const shape = toolInputProblems(schema, staging);
      return (shape.length > 0 ? shape : stagingProblems(staging as SceneStaging)).map((problem) => `${questId}[${i}]: ${problem}`);
    });
  });
  if (problems.length > 0) throw new QuestError('E_HANDOFF', 'scene templates are not stagings', problems);
  return untrusted as SceneTemplates;
}

/** A questline's stagings: what its build staged, with a template replacing the staging under its sceneId. */
export function withTemplates(built: readonly SceneStaging[], templates: readonly SceneStaging[] = []): SceneStaging[] {
  const written = new Set(templates.map((staging) => staging.sceneId));
  return [...built.filter((staging) => !written.has(staging.sceneId)), ...templates];
}

/**
 * The handoff input with the scenes the set stages, keyed by questline id.
 * Explicit specs and investigations in the input win by id. A host that
 * declares no scenery gets none, and `log` hears how many were left out.
 */
export function sceneryHandoff(
  definitions: QuestlineDefinition[],
  untrustedInput: unknown,
  stagings: ReadonlyMap<string, readonly SceneStaging[]>,
  itemTemplates: MissionItemTemplates = {},
  log?: (line: string) => void,
): HandoffInput {
  const input = new HandoffInputBoundary().parse(untrustedInput);
  const staged = definitions.map((definition) => ({ definition, stagings: stagings.get(definition.id) ?? [] }));
  const count = staged.reduce((sum, { stagings: some }) => sum + some.length, 0);
  if (count === 0) return input;
  if (input.hostCapabilities?.scenery === undefined) {
    log?.(`${count} staged scene${count === 1 ? '' : 's'} left out: the host declares no scenery`);
    return input;
  }
  const scenery = [...(input.scenery ?? [])];
  const investigations = [...(input.investigations ?? [])];
  const missionAssetRequests = [...(input.missionAssetRequests ?? [])];
  const explicitScenes = new Set(scenery.map((spec) => spec.sceneId));
  const explicitInvestigations = new Set(investigations.map((request) => request.sceneId));
  for (const { definition, stagings: some } of staged) {
    const made = stagedScenery(definition, some);
    scenery.push(...made.scenery.filter((spec) => !explicitScenes.has(spec.sceneId)));
    investigations.push(...made.investigations.filter((request) => !explicitInvestigations.has(request.sceneId)));
    for (const asset of made.assets) {
      if (explicitScenes.has(sceneSpecId(asset.questId, asset.sceneId))) continue;
      const item = definition.items.find((candidate) => candidate.itemId === asset.itemId)!;
      const template = item.kind === 'information' ? undefined : itemTemplates[item.kind];
      if (template === undefined) {
        throw new QuestError('E_HANDOFF', `scene ${asset.sceneId} of ${asset.questId} shows ${item.itemId} in prop ${asset.propId}, and there is no ${item.kind} template`);
      }
      missionAssetRequests.push(templateRequest(template, `${asset.questId}\u0000${asset.sceneId}\u0000${asset.propId}`, `${item.name}: ${item.description}`, asset.assetId));
    }
  }
  return { ...input, scenery, investigations, missionAssetRequests };
}
