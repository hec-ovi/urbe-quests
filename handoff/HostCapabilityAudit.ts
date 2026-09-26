import { QuestError } from '../errors.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import type { HostCapabilities, SceneSpec, SceneryCapabilities } from './schema.js';

/** Refuses a runnable bundle that asks more than the host declares: transport it cannot complete, or scenery it cannot stage. */
export class HostCapabilityAudit {
  validate(definitions: QuestlineDefinition[], capabilities: HostCapabilities, scenery: SceneSpec[] = []): void {
    const supported = new Set(capabilities.transportationModes);
    for (const definition of definitions) {
      for (const step of definition.steps) {
        if (step.target.kind === 'transportation' && !supported.has(step.target.mode)) {
          this.fail(`host does not support transportation mode ${step.target.mode} for ${definition.id}/${step.stepId}`);
        }
      }
    }
    this.validateScenery(scenery, capabilities.scenery);
  }

  /** Scenery is declared, never inferred: no scene without the capability, and nothing beyond its lists and limits. */
  validateScenery(scenery: SceneSpec[], declared: SceneryCapabilities | undefined): void {
    if (scenery.length === 0) return;
    if (declared === undefined) this.fail(`scene ${scenery[0]!.sceneId} needs the host scenery capability, which the host does not declare`);
    for (const spec of scenery) {
      const beyond = [
        ...(declared.placeKinds.includes(spec.place.kind) ? [] : [`place ${spec.place.kind}`]),
        ...spec.actors.filter((actor) => !declared.poses.includes(actor.pose)).map((actor) => `pose ${actor.pose}`),
        ...spec.props.filter((prop) => !declared.propKinds.includes(prop.kind)).map((prop) => `prop ${prop.kind}`),
        ...(spec.lighting !== undefined && !declared.lightingPresets.includes(spec.lighting.preset) ? [`lighting ${spec.lighting.preset}`] : []),
        ...(spec.actors.length > declared.limits.actors ? [`${spec.actors.length} actors`] : []),
        ...(spec.props.length > declared.limits.props ? [`${spec.props.length} props`] : []),
      ];
      if (beyond.length > 0) this.fail(`scene ${spec.sceneId} asks for what the host does not declare: ${beyond.join(', ')}`);
    }
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}
