import { QuestError } from '../errors.js';
import type { PlaceTarget, QuestlineDefinition } from '../flow/schema.js';
import type { InvestigationSceneRequest } from './schema.js';

export class InvestigationAudit {
  validate(definitions: QuestlineDefinition[], scenes: InvestigationSceneRequest[]): void {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const expected = new Set(
      definitions.flatMap((definition) => definition.steps
        .filter((step) => step.target.kind === 'investigation')
        .map((step) => `${definition.id}\u0000${step.stepId}`)),
    );
    const found = new Set<string>();
    const sceneIds = new Set<string>();

    for (const scene of scenes) {
      if (sceneIds.has(scene.sceneId)) this.fail(`duplicate investigation scene ${scene.sceneId}`);
      sceneIds.add(scene.sceneId);
      const definition = definitionsById.get(scene.questId);
      if (definition === undefined) this.fail(`investigation ${scene.sceneId} names unknown quest ${scene.questId}`);
      const evidence = new Map(scene.evidence.map((entry) => [entry.evidenceId, entry]));
      if (evidence.size !== scene.evidence.length) this.fail(`investigation ${scene.sceneId} repeats evidence ids`);
      for (const entry of scene.evidence) {
        for (const prerequisite of entry.prerequisiteEvidenceIds) {
          if (!evidence.has(prerequisite)) this.fail(`investigation ${scene.sceneId} evidence ${entry.evidenceId} requires unknown evidence ${prerequisite}`);
        }
      }
      this.validateEvidenceGraph(scene);
      const boundEvidence = new Set(scene.questBindings.map((binding) => binding.evidenceId));
      if (boundEvidence.size !== scene.questBindings.length) this.fail(`investigation ${scene.sceneId} binds evidence more than once`);
      for (const evidenceId of evidence.keys()) {
        if (!boundEvidence.has(evidenceId)) this.fail(`investigation ${scene.sceneId} evidence ${evidenceId} has no quest binding`);
      }
      for (const binding of scene.questBindings) {
        const key = `${scene.questId}\u0000${binding.stepId}`;
        if (found.has(key)) this.fail(`investigation step ${scene.questId}/${binding.stepId} is bound more than once`);
        const step = definition.steps.find((candidate) => candidate.stepId === binding.stepId);
        if (step === undefined || step.target.kind !== 'investigation') {
          this.fail(`investigation ${scene.sceneId} binds non-investigation step ${binding.stepId}`);
        }
        const target = step.target;
        if (target.sceneId !== scene.sceneId || target.evidenceId !== binding.evidenceId || !samePlace(target.place, binding.place)) {
          this.fail(`investigation ${scene.sceneId} binding does not match ${scene.questId}/${binding.stepId}`);
        }
        const authoredEvidence = evidence.get(binding.evidenceId);
        if (authoredEvidence === undefined) this.fail(`investigation ${scene.sceneId} binding names missing evidence ${binding.evidenceId}`);
        if (authoredEvidence.factId !== target.evidenceItemId) {
          this.fail(`investigation ${scene.sceneId} evidence ${binding.evidenceId} must grant item ${target.evidenceItemId}`);
        }
        if (binding.completionAction === 'take' && !authoredEvidence.portable) {
          this.fail(`investigation ${scene.sceneId} cannot take non-portable evidence ${binding.evidenceId}`);
        }
        if (scene.location.placeId !== placeId(binding.place)) {
          this.fail(`investigation ${scene.sceneId} location does not match its quest place`);
        }
        found.add(key);
      }
    }

    for (const key of expected) {
      if (!found.has(key)) {
        const [questId, stepId] = key.split('\u0000');
        this.fail(`investigation step ${questId}/${stepId} has no scene binding`);
      }
    }
    for (const key of found) if (!expected.has(key)) this.fail('investigation catalog contains an unexpected step binding');
  }

  private validateEvidenceGraph(scene: InvestigationSceneRequest): void {
    const evidence = new Map(scene.evidence.map((entry) => [entry.evidenceId, entry]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (evidenceId: string): void => {
      if (visiting.has(evidenceId)) this.fail(`investigation ${scene.sceneId} evidence prerequisites contain a cycle at ${evidenceId}`);
      if (visited.has(evidenceId)) return;
      visiting.add(evidenceId);
      for (const prerequisite of evidence.get(evidenceId)!.prerequisiteEvidenceIds) visit(prerequisite);
      visiting.delete(evidenceId);
      visited.add(evidenceId);
    };
    for (const evidenceId of evidence.keys()) visit(evidenceId);
  }

  private fail(message: string): never {
    throw new QuestError('E_HANDOFF', message);
  }
}

function samePlace(left: PlaceTarget, right: { parcelId: string } | { districtId: string }): boolean {
  if ('parcelId' in left) return 'parcelId' in right && left.parcelId === right.parcelId;
  if ('districtId' in left) return 'districtId' in right && left.districtId === right.districtId;
  return false;
}

const placeId = (place: { parcelId: string } | { districtId: string }) => 'parcelId' in place ? place.parcelId : place.districtId;
