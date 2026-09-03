import { QuestlineSetValidator } from '../flow/QuestlineSet.js';
import type { QuestlineDefinition } from '../flow/schema.js';
import { HostCapabilityAudit } from './HostCapabilityAudit.js';
import { InvestigationAudit } from './InvestigationAudit.js';
import { HandoffInputBoundary } from './HandoffInputBoundary.js';
import { MechanicTargetAudit } from './MechanicTargetAudit.js';
import { MissionAssetAudit } from './MissionAssetAudit.js';
import { ObjectiveProjector } from './ObjectiveProjector.js';
import type { HandoffBundle, HandoffInput } from './schema.js';

/** Builds the complete deterministic file payload consumed by engine creation. */
export class EngineHandoff {
  constructor(
    private readonly investigations = new InvestigationAudit(),
    private readonly missionAssets = new MissionAssetAudit(),
    private readonly mechanicTargets = new MechanicTargetAudit(),
    private readonly hostCapabilities = new HostCapabilityAudit(),
    private readonly objectives = new ObjectiveProjector(),
    private readonly boundary = new HandoffInputBoundary(),
  ) {}

  assemble(questlines: QuestlineDefinition[], untrustedInput: unknown = {}): HandoffBundle {
    new QuestlineSetValidator().validate(questlines);
    const input: HandoffInput = this.boundary.parse(untrustedInput);
    const hostCapabilities = input.hostCapabilities ?? { transportationModes: [] };
    const investigations = input.investigations ?? [];
    const mechanicTargetBindings = input.mechanicTargetBindings ?? [];
    const missionAssetRequests = input.missionAssetRequests ?? [];
    const missionItemBindings = input.missionItemBindings ?? [];
    this.investigations.validate(questlines, investigations);
    this.missionAssets.validate(questlines, missionAssetRequests, missionItemBindings, investigations);
    this.mechanicTargets.validate(questlines, missionAssetRequests, mechanicTargetBindings);
    this.hostCapabilities.validate(questlines, hostCapabilities);
    return {
      hostCapabilities,
      questlines,
      objectives: this.objectives.project(questlines),
      investigations,
      mechanicTargetBindings,
      missionAssetRequests,
      missionItemBindings,
    };
  }
}
