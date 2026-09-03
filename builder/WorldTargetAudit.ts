import type { QuestItem, QuestRole, QuestStep } from '../flow/schema.js';
import type { NamedWorld, NPCTypeSet } from '../world/types/named-world.js';

/** Immediate world-reference checks used by the agent tool loop. */
export class WorldTargetAudit {
  private readonly parcels: Set<string>;
  private readonly districts: Set<string>;
  private readonly stations: Set<string>;
  private readonly stops: Set<string>;
  private readonly npcTypes: Set<string>;

  constructor(world: NamedWorld, types: NPCTypeSet) {
    this.parcels = new Set(world.parcels.map((parcel) => parcel.id));
    this.districts = new Set(world.districts.map((district) => district.id));
    this.stations = new Set([
      ...(world.transit?.trainStations ?? []),
      ...(world.transit?.subwayStations ?? []),
    ].map((station) => station.id));
    this.stops = new Set((world.transit?.busStops ?? []).map((stop) => stop.id));
    this.npcTypes = new Set(types.types.map((type) => type.type));
  }

  roleProblems(role: QuestRole): string[] {
    return this.npcTypes.has(role.npcType) ? [] : [`role ${role.roleId} names unknown NPC type ${role.npcType}`];
  }

  itemProblems(item: QuestItem): string[] {
    return item.atParcelId === undefined || this.parcels.has(item.atParcelId)
      ? []
      : [`item ${item.itemId} names unknown parcel ${item.atParcelId}`];
  }

  stepProblems(step: QuestStep): string[] {
    const problems: string[] = [];
    const target = step.target;
    if (
      target.kind === 'goto' || target.kind === 'deliver' || target.kind === 'investigation' || target.kind === 'rescue' ||
      target.kind === 'access' || target.kind === 'hacking' || target.kind === 'sabotage'
    ) this.checkPlace(step.stepId, target.place, problems);
    if (target.kind === 'escort' || target.kind === 'transportation') {
      this.checkPlace(step.stepId, target.from, problems);
      this.checkPlace(step.stepId, target.to, problems);
    }
    if (target.kind === 'observe' && !this.districts.has(target.districtId)) {
      problems.push(`step ${step.stepId} observes unknown district ${target.districtId}`);
    }
    if (target.kind === 'talk' && target.atParcelId !== undefined && !this.parcels.has(target.atParcelId)) {
      problems.push(`step ${step.stepId} talks at unknown parcel ${target.atParcelId}`);
    }
    if ((target.kind === 'listen' || target.kind === 'work') && !this.parcels.has(target.atParcelId)) {
      problems.push(`step ${step.stepId} targets unknown parcel ${target.atParcelId}`);
    }
    for (const effect of step.effects) {
      if (effect.kind === 'simFlag' && effect.op.kind === 'promote' && effect.op.toParcelId !== undefined && !this.parcels.has(effect.op.toParcelId)) {
        problems.push(`step ${step.stepId} promotes to unknown parcel ${effect.op.toParcelId}`);
      }
    }
    return problems;
  }

  private checkPlace(stepId: string, place: import('../flow/schema.js').PlaceTarget, problems: string[]): void {
    if ('parcelId' in place && !this.parcels.has(place.parcelId)) problems.push(`step ${stepId} targets unknown parcel ${place.parcelId}`);
    if ('districtId' in place && !this.districts.has(place.districtId)) problems.push(`step ${stepId} targets unknown district ${place.districtId}`);
    if ('stationId' in place && !this.stations.has(place.stationId)) problems.push(`step ${stepId} targets unknown station ${place.stationId}`);
    if ('stopId' in place && !this.stops.has(place.stopId)) problems.push(`step ${stepId} targets unknown stop ${place.stopId}`);
  }
}
