import type { NamedWorld } from './types/named-world.js';

export interface AtlasQuestWorld {
  meta: { seed: string | number };
  districts: Array<Omit<NamedWorld['districts'][number], 'name'> & { name?: string }>;
  parcels: NamedWorld['parcels'];
  transit?: NamedWorld['transit'];
}

/** Deterministic fallback for recorded creation when the naming pass is absent. */
export function namedWorldFromAtlas(world: AtlasQuestWorld, theme: string): NamedWorld {
  return {
    meta: {
      seed: world.meta.seed,
      naming: { theme, namedAt: 'derived-from-atlas' },
    },
    districts: world.districts.map((district) => ({
      ...district,
      name: district.name ?? `${district.kind.replace('_', ' ')} ${district.id}`,
    })),
    parcels: world.parcels.map((parcel) => ({ ...parcel })),
    ...(world.transit !== undefined
      ? {
          transit: {
            busStops: world.transit.busStops.map((entry) => ({ ...entry })),
            busRoutes: world.transit.busRoutes.map((entry) => ({ ...entry })),
            trainStations: world.transit.trainStations.map((entry) => ({ ...entry })),
            trainLines: world.transit.trainLines.map((entry) => ({ ...entry })),
            subwayStations: world.transit.subwayStations.map((entry) => ({ ...entry })),
            subwayLines: world.transit.subwayLines.map((entry) => ({ ...entry })),
          },
        }
      : {}),
  };
}
