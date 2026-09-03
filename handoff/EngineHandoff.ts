import { QuestlineSetValidator } from '../flow/QuestlineSet.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import { InvestigationAudit } from './InvestigationAudit.js';
import { HandoffInputBoundary } from './HandoffInputBoundary.js';
import { MissionAssetAudit } from './MissionAssetAudit.js';
import { ObjectiveProjector } from './ObjectiveProjector.js';
import type { HandoffBundle, HandoffInput } from './schema.js';

/** Builds the complete deterministic file payload consumed by engine creation. */
export class EngineHandoff {
  constructor(
    private readonly investigations = new InvestigationAudit(),
    private readonly missionAssets = new MissionAssetAudit(),
    private readonly objectives = new ObjectiveProjector(),
    private readonly boundary = new HandoffInputBoundary(),
  ) {}

  assemble(questlines: QuestlineDefinition[], untrustedInput: unknown = {}): HandoffBundle {
    new QuestlineSetValidator().validate(questlines);
    const input: HandoffInput = this.boundary.parse(untrustedInput);
    const investigations = input.investigations ?? [];
    const missionAssetRequests = input.missionAssetRequests ?? [];
    const missionItemBindings = input.missionItemBindings ?? [];
    this.investigations.validate(questlines, investigations);
    this.missionAssets.validate(questlines, missionAssetRequests, missionItemBindings, investigations);
    return {
      questlines,
      objectives: this.objectives.project(questlines),
      investigations,
      missionAssetRequests,
      missionItemBindings,
    };
  }
}
