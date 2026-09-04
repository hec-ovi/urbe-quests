import type {
  AtlasQuestWorld,
  NamedTransit,
  NamedTransitEntity,
  NamedWorld,
  NPCTypeSet,
} from './types/named-world.js';

export interface WorldContextInput {
  world: NamedWorld | AtlasQuestWorld;
  types: NPCTypeSet;
}

export interface NormalizedWorldContext {
  world: NamedWorld;
  types: NPCTypeSet;
}

export type NormalizedContext<T extends WorldContextInput> = Omit<T, 'world' | 'types'> & NormalizedWorldContext;

/** Projects Naming or Atlas values onto the closed world surface Quests consumes. */
export class WorldContextNormalizer {
  normalize<T extends WorldContextInput>(input: T): NormalizedContext<T> {
    if (!isProjectableContext(input)) return input as NormalizedContext<T>;
    const types = this.types(input.types);
    return {
      ...input,
      world: this.world(input.world, types.meta.theme),
      types,
    };
  }

  world(input: NamedWorld | AtlasQuestWorld, fallbackTheme: string): NamedWorld {
    const fromNaming = Object.hasOwn(input.meta, 'naming');
    const naming = fromNaming
      ? {
          theme: (input as NamedWorld).meta.naming.theme,
          ...((input as NamedWorld).meta.naming.model === undefined
            ? {}
            : { model: (input as NamedWorld).meta.naming.model }),
          namedAt: (input as NamedWorld).meta.naming.namedAt,
        }
      : { theme: fallbackTheme, namedAt: 'derived-from-atlas' };

    return {
      meta: { seed: input.meta.seed, naming },
      districts: input.districts.map((district) => ({
        id: district.id,
        kind: district.kind,
        tier: district.tier,
        name: fromNaming
          ? district.name!
          : district.name ?? `${typeof district.kind === 'string' ? district.kind.replace('_', ' ') : ''} ${district.id}`.trim(),
      })),
      parcels: input.parcels.map((parcel) => ({
        id: parcel.id,
        districtId: parcel.districtId,
        type: parcel.type,
        tier: parcel.tier,
        ...(parcel.name === undefined ? {} : { name: parcel.name }),
      })),
      ...(input.transit === undefined ? {} : { transit: projectTransit(input.transit) }),
    };
  }

  types(input: NPCTypeSet): NPCTypeSet {
    const givenByGender = input.namePool.givenByGender;
    return {
      meta: {
        theme: input.meta.theme,
        worldSeed: input.meta.worldSeed,
        createdAt: input.meta.createdAt,
        ...(input.meta.model === undefined ? {} : { model: input.meta.model }),
      },
      types: input.types.map((type) => ({
        type: type.type,
        label: type.label,
        category: type.category,
        boilerplate: type.boilerplate,
        ...(type.examples === undefined ? {} : { examples: [...type.examples] }),
        grounding: {
          ...(type.grounding.districts === undefined ? {} : { districts: [...type.grounding.districts] }),
          ...(type.grounding.parcelTypes === undefined ? {} : { parcelTypes: [...type.grounding.parcelTypes] }),
          ...(type.grounding.tiers === undefined ? {} : { tiers: [...type.grounding.tiers] }),
        },
        weight: type.weight,
      })),
      namePool: {
        given: [...input.namePool.given],
        ...(givenByGender === undefined
          ? {}
          : {
              givenByGender: {
                male: [...givenByGender.male],
                female: [...givenByGender.female],
                neutral: [...givenByGender.neutral],
              },
            }),
        family: [...input.namePool.family],
      },
    };
  }
}

function projectTransit(input: NamedTransit): NamedTransit {
  return {
    ...(input.busStops === undefined ? {} : { busStops: input.busStops.map(projectTransitEntity) }),
    ...(input.busRoutes === undefined ? {} : { busRoutes: input.busRoutes.map(projectTransitEntity) }),
    ...(input.trainStations === undefined ? {} : { trainStations: input.trainStations.map(projectTransitEntity) }),
    ...(input.trainLines === undefined ? {} : { trainLines: input.trainLines.map(projectTransitEntity) }),
    ...(input.subwayStations === undefined ? {} : { subwayStations: input.subwayStations.map(projectTransitEntity) }),
    ...(input.subwayLines === undefined ? {} : { subwayLines: input.subwayLines.map(projectTransitEntity) }),
  };
}

function projectTransitEntity(input: NamedTransitEntity): NamedTransitEntity {
  return {
    id: input.id,
    ...(input.districtId === undefined ? {} : { districtId: input.districtId }),
    ...(input.name === undefined ? {} : { name: input.name }),
  };
}

function isProjectableContext(input: unknown): input is WorldContextInput {
  if (!isRecord(input) || !isProjectableWorld(input.world) || !isProjectableTypes(input.types)) return false;
  return true;
}

function isProjectableWorld(input: unknown): input is NamedWorld | AtlasQuestWorld {
  if (!isRecord(input) || !isRecord(input.meta) || !Array.isArray(input.districts) || !Array.isArray(input.parcels)) {
    return false;
  }
  if (!input.districts.every(isRecord) || !input.parcels.every(isRecord)) return false;
  if (Object.hasOwn(input.meta, 'naming') && !isRecord(input.meta.naming)) return false;
  if (input.transit === undefined) return true;
  if (!isRecord(input.transit)) return false;
  const transit = input.transit;
  return ['busStops', 'busRoutes', 'trainStations', 'trainLines', 'subwayStations', 'subwayLines'].every((key) => {
    const collection = transit[key];
    return collection === undefined || (Array.isArray(collection) && collection.every(isRecord));
  });
}

function isProjectableTypes(input: unknown): input is NPCTypeSet {
  if (
    !isRecord(input) ||
    !isRecord(input.meta) ||
    !Array.isArray(input.types) ||
    !input.types.every((type) => isRecord(type) && isRecord(type.grounding)) ||
    !isRecord(input.namePool) ||
    !Array.isArray(input.namePool.given) ||
    !Array.isArray(input.namePool.family)
  ) {
    return false;
  }
  if (!input.types.every((type) => (
    (type.examples === undefined || Array.isArray(type.examples)) &&
    (type.grounding.districts === undefined || Array.isArray(type.grounding.districts)) &&
    (type.grounding.parcelTypes === undefined || Array.isArray(type.grounding.parcelTypes)) &&
    (type.grounding.tiers === undefined || Array.isArray(type.grounding.tiers))
  ))) {
    return false;
  }
  const grouped = input.namePool.givenByGender;
  return grouped === undefined || (
    isRecord(grouped) &&
    Array.isArray(grouped.male) &&
    Array.isArray(grouped.female) &&
    Array.isArray(grouped.neutral)
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
