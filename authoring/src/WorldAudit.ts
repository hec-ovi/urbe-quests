import { AuthoringError } from './AuthoringError.js';
import type { QuestlineDefinition, QuestStep, StoryOutput, WorldContext } from './schema.js';

export class WorldAudit {
  validateContext(context: WorldContext): void {
    const problems: string[] = [];
    const districts = collectUnique(context.world.districts.map((district) => district.id), 'district', problems);
    const districtNames = new Set(context.world.districts.map((district) => district.name));
    collectUnique(context.world.parcels.map((parcel) => parcel.id), 'parcel', problems);
    const transit = context.world.transit;
    const transitEntities = transit === undefined ? [] : Object.values(transit).flat();
    collectUnique(transit?.busStops?.map((entity) => entity.id) ?? [], 'stop', problems);
    collectUnique(
      [...(transit?.trainStations ?? []), ...(transit?.subwayStations ?? [])].map((entity) => entity.id),
      'station',
      problems,
    );
    collectUnique(context.types.types.map((type) => type.type), 'NPC type', problems);

    for (const parcel of context.world.parcels) {
      if (!districts.has(parcel.districtId)) problems.push(`parcel ${parcel.id} names unknown district ${parcel.districtId}`);
    }
    for (const entity of transitEntities) {
      if (entity.districtId !== undefined && !districts.has(entity.districtId)) {
        problems.push(`transit ${entity.id} names unknown district ${entity.districtId}`);
      }
    }
    for (const type of context.types.types) {
      for (const districtName of type.grounding.districts ?? []) {
        if (!districtNames.has(districtName)) problems.push(`NPC type ${type.type} is grounded to unknown district ${districtName}`);
      }
    }

    if (problems.length > 0) throw new AuthoringError('E_WORLD_TARGET', 'world context audit failed', problems);
  }

  validateStory(story: StoryOutput, context: WorldContext): void {
    this.validateContext(context);
    const problems: string[] = [];
    const knownPlaces = new Set([
      ...context.world.districts.map((district) => district.name),
      ...context.world.parcels.flatMap((parcel) => parcel.name ? [parcel.name] : []),
      ...Object.values(context.world.transit ?? {}).flat().flatMap((entity) => entity.name ? [entity.name] : []),
    ]);
    const declaredPlaces = new Set(story.setting.placeNames);
    for (const placeName of declaredPlaces) {
      if (!knownPlaces.has(placeName)) problems.push(`story setting names unknown place ${placeName}`);
    }
    for (const beat of Object.values(story.movements).flat()) {
      if (!declaredPlaces.has(beat.scene.placeName)) {
        problems.push(`story beat ${beat.beatId} uses undeclared setting place ${beat.scene.placeName}`);
      } else if (!knownPlaces.has(beat.scene.placeName)) {
        problems.push(`story beat ${beat.beatId} uses unknown world place ${beat.scene.placeName}`);
      }
    }

    if (problems.length > 0) throw new AuthoringError('E_WORLD_TARGET', 'story place audit failed', problems);
  }

  validate(definition: QuestlineDefinition, context: WorldContext): void {
    this.validateContext(context);
    const problems: string[] = [];
    const districts = new Set(context.world.districts.map((district) => district.id));
    const parcels = new Set(context.world.parcels.map((parcel) => parcel.id));
    const stations = new Set([
      ...(context.world.transit?.trainStations ?? []),
      ...(context.world.transit?.subwayStations ?? []),
    ].map((entity) => entity.id));
    const stops = new Set((context.world.transit?.busStops ?? []).map((entity) => entity.id));
    const npcTypes = new Set(context.types.types.map((type) => type.type));
    for (const role of definition.roles) {
      if (!npcTypes.has(role.npcType)) problems.push(`role ${role.roleId} names unknown NPC type ${role.npcType}`);
    }
    for (const item of definition.items) {
      if (item.atParcelId && !parcels.has(item.atParcelId)) {
        problems.push(`item ${item.itemId} names unknown parcel ${item.atParcelId}`);
      }
    }
    for (const step of definition.steps) {
      this.checkTarget(step, parcels, districts, stations, stops, problems);
      for (const effect of step.effects) {
        if (effect.kind === 'simFlag' && effect.op.kind === 'promote' && effect.op.toParcelId && !parcels.has(effect.op.toParcelId)) {
          problems.push(`step ${step.stepId} promotes to unknown parcel ${effect.op.toParcelId}`);
        }
      }
    }

    if (problems.length > 0) throw new AuthoringError('E_WORLD_TARGET', 'questline world target audit failed', problems);
  }

  private checkTarget(
    step: QuestStep,
    parcels: Set<string>,
    districts: Set<string>,
    stations: Set<string>,
    stops: Set<string>,
    problems: string[],
  ): void {
    const target = step.target;
    if (
      target.kind === 'goto' ||
      target.kind === 'deliver' ||
      target.kind === 'investigation' ||
      target.kind === 'rescue' ||
      target.kind === 'access' ||
      target.kind === 'hacking' ||
      target.kind === 'sabotage'
    ) {
      checkPlace(step.stepId, target.place, parcels, districts, stations, stops, problems);
    } else if (target.kind === 'observe') {
      if (!districts.has(target.districtId)) problems.push(`step ${step.stepId} observes unknown district ${target.districtId}`);
    } else if (target.kind === 'talk' && target.atParcelId) {
      if (!parcels.has(target.atParcelId)) problems.push(`step ${step.stepId} talks at unknown parcel ${target.atParcelId}`);
    } else if (target.kind === 'listen' || target.kind === 'work') {
      if (!parcels.has(target.atParcelId)) problems.push(`step ${step.stepId} targets unknown parcel ${target.atParcelId}`);
    } else if (target.kind === 'escort' || target.kind === 'transportation') {
      checkPlace(step.stepId, target.from, parcels, districts, stations, stops, problems);
      checkPlace(step.stepId, target.to, parcels, districts, stations, stops, problems);
    }
  }
}

function checkPlace(
  stepId: string,
  place: import('./schema.js').PlaceTarget,
  parcels: Set<string>,
  districts: Set<string>,
  stations: Set<string>,
  stops: Set<string>,
  problems: string[],
): void {
  if ('parcelId' in place && !parcels.has(place.parcelId)) problems.push(`step ${stepId} targets unknown parcel ${place.parcelId}`);
  if ('districtId' in place && !districts.has(place.districtId)) problems.push(`step ${stepId} targets unknown district ${place.districtId}`);
  if ('stationId' in place && !stations.has(place.stationId)) problems.push(`step ${stepId} targets unknown station ${place.stationId}`);
  if ('stopId' in place && !stops.has(place.stopId)) problems.push(`step ${stepId} targets unknown stop ${place.stopId}`);
}

function collectUnique(ids: string[], subject: string, problems: string[]): Set<string> {
  const found = new Set<string>();
  for (const id of ids) {
    if (found.has(id)) problems.push(`duplicate world ${subject} id ${id}`);
    found.add(id);
  }
  return found;
}
