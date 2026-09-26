import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import type { InvestigationRequest, LinkedInvestigationRequest, SceneCondition, SceneSpec } from './schema.js';

/**
 * Refuses a scene Engine scenery would refuse at load or could never stand:
 * it names its own questline's steps, flags and roles, stands in a building
 * that questline opens, holds a quest character only as a corpse the story
 * kills first, names assets the bundle builds, and links its investigation
 * both ways.
 */
export class SceneryAudit {
  validate(
    definitions: QuestlineDefinition[],
    scenery: SceneSpec[],
    investigations: InvestigationRequest[],
    assetIds: ReadonlySet<string>,
  ): void {
    const questlines = new Map(definitions.map((definition) => [definition.id, definition]));
    const linked = new Map(investigations.filter(isLinked).map((request) => [request.sceneId, request]));
    const specs = new Map<string, SceneSpec>();

    for (const spec of scenery) {
      const at = `scene ${spec.sceneId}`;
      if (specs.has(spec.sceneId)) this.fail(`duplicate scene ${spec.sceneId}`);
      specs.set(spec.sceneId, spec);
      const definition = questlines.get(spec.questId) ?? this.fail(`${at} names unknown quest ${spec.questId}`);

      const actors = new Set(spec.actors.map((actor) => actor.actorId));
      const assets = new Set(spec.props.filter((prop) => prop.kind === 'mission-asset').map((prop) => prop.propId));
      const elements = new Set([...actors, ...spec.props.map((prop) => prop.propId)]);
      if (elements.size !== spec.actors.length + spec.props.length) this.fail(`${at} repeats an element id`);

      const unknown = [
        ...unknownReferences(spec.activeWhen, definition),
        ...(spec.retireWhen !== undefined ? unknownReferences(spec.retireWhen, definition) : []),
        ...spec.actors.flatMap(({ identity }) => identity.kind === 'cast' && !definition.roles.some((role) => role.roleId === identity.roleId)
          ? [`roleId ${identity.roleId}`] : []),
      ];
      if (unknown.length > 0) this.fail(`${at} names what quest ${spec.questId} lacks: ${unknown.join(', ')}`);

      for (const actor of spec.actors) {
        const near = actor.placement.nearEntityId;
        if (near !== undefined && (near === actor.actorId || !elements.has(near))) this.fail(`${at} places ${actor.actorId} near ${near}, which is no other element of the scene`);
      }
      for (const prop of spec.props) {
        if (prop.nearActorId !== undefined && !actors.has(prop.nearActorId)) this.fail(`${at} places ${prop.propId} near ${prop.nearActorId}, which is no actor of the scene`);
        if (prop.nearPropId !== undefined && (prop.nearPropId === prop.propId || !assets.has(prop.nearPropId))) {
          this.fail(`${at} places ${prop.propId} near ${prop.nearPropId}, which is no other mission-asset prop of the scene`);
        }
        if (prop.kind === 'mission-asset' && (prop.assetId === undefined || !assetIds.has(prop.assetId))) {
          this.fail(`${at} prop ${prop.propId} names mission asset ${prop.assetId}, which the bundle does not request`);
        }
      }

      // The host opens the interiors a questline names; a scene elsewhere would have no room to stand in.
      if (!parcelsNamed(definition).has(spec.place.parcelId)) {
        this.fail(`${at} stands at ${spec.place.parcelId}, a building quest ${spec.questId} never names`);
      }

      for (const actor of spec.actors) {
        if (actor.identity.kind !== 'cast') continue;
        const { roleId } = actor.identity;
        const kills = new Set(definition.steps.filter((step) =>
          (step.target.kind === 'assassinate' && step.target.roleId === roleId)
          || step.effects.some((effect) => effect.kind === 'simFlag' && effect.roleId === roleId && effect.op.kind === 'die'),
        ).map((step) => step.stepId));
        if (kills.size === 0) this.fail(`${at} holds ${roleId} dead, but no step of quest ${spec.questId} kills that role`);
        const killed = (condition: LeafCondition) =>
          (condition.kind === 'stepDone' && kills.has(condition.stepId)) || (condition.kind === 'roleDead' && condition.roleId === roleId);
        if (!requires(spec.activeWhen, killed)) this.fail(`${at} could stand before ${roleId} dies: its activeWhen must require the killing step or roleDead`);
      }

      if (spec.investigationSceneId !== undefined) {
        const request = linked.get(spec.investigationSceneId);
        if (request === undefined || request.scenery.sceneId !== spec.sceneId || request.questId !== spec.questId) {
          this.fail(`${at} names investigation ${spec.investigationSceneId}, which does not link it`);
        }
      }
    }

    for (const request of linked.values()) {
      const spec = specs.get(request.scenery.sceneId);
      if (spec === undefined || spec.questId !== request.questId) this.fail(`investigation ${request.sceneId} links unknown scene ${request.scenery.sceneId}`);
      if (spec.investigationSceneId !== request.sceneId) {
        this.fail(`investigation ${request.sceneId} links scene ${spec.sceneId}, which names ${spec.investigationSceneId ?? 'no investigation'} back`);
      }
      const elements = new Set([...spec.actors.map((actor) => actor.actorId), ...spec.props.map((prop) => prop.propId)]);
      const missing = request.evidenceVisuals.filter((visual) => !elements.has(visual.entityId)).map((visual) => visual.entityId);
      if (missing.length > 0) this.fail(`investigation ${request.sceneId} shows evidence on what scene ${spec.sceneId} lacks: ${missing.join(', ')}`);
    }
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}

type LeafCondition = Extract<SceneCondition, { kind: string }>;

export const isLinked = (request: InvestigationRequest): request is LinkedInvestigationRequest => request.contractVersion === '1.2';

/** True when the condition cannot hold unless `leaf` holds: some part of an `all`, every branch of an `any`; a `not` promises nothing. */
function requires(condition: SceneCondition, leaf: (condition: LeafCondition) => boolean): boolean {
  if ('all' in condition) return condition.all.some((item) => requires(item, leaf));
  if ('any' in condition) return condition.any.every((item) => requires(item, leaf));
  if ('not' in condition) return false;
  return leaf(condition);
}

/** Every step, flag or role a condition names that the questline lacks. */
function unknownReferences(condition: SceneCondition, definition: QuestlineDefinition): string[] {
  if ('all' in condition) return condition.all.flatMap((item) => unknownReferences(item, definition));
  if ('any' in condition) return condition.any.flatMap((item) => unknownReferences(item, definition));
  if ('not' in condition) return unknownReferences(condition.not, definition);
  if ('stepId' in condition && !definition.steps.some((step) => step.stepId === condition.stepId)) return [`stepId ${condition.stepId}`];
  if ('flag' in condition && !definition.flags.includes(condition.flag)) return [`flag ${condition.flag}`];
  if ('roleId' in condition && !definition.roles.some((role) => role.roleId === condition.roleId)) return [`roleId ${condition.roleId}`];
  return [];
}

/** Every building a questline names anywhere, as the host reads it to open interiors. */
function parcelsNamed(definition: QuestlineDefinition): Set<string> {
  const parcels = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if ((key === 'parcelId' || key === 'atParcelId') && typeof entry === 'string') parcels.add(entry);
        else visit(entry);
      }
    }
  };
  visit([definition.steps, definition.items]);
  return parcels;
}
