import type { PlaceTarget } from './schema.js';

/** Player events the engine feeds into the runtime. Closed set. */

export type PlayerEvent =
  | { kind: 'talkedTo'; npcId: string }
  | ({ kind: 'arrivedAt' } & PlaceTarget)
  | { kind: 'observed'; districtId: string }
  | { kind: 'pickedUp'; itemId: string }
  | ({ kind: 'delivered'; itemId: string } & PlaceTarget)
  | { kind: 'overheard'; npcIds: string[] }
  | { kind: 'stole'; itemId: string }
  | { kind: 'killed'; npcId: string }
  | { kind: 'workedShift'; parcelId: string }
  | { kind: 'investigated'; sceneId: string; evidenceId: string; place: PlaceTarget }
  | { kind: 'released'; npcId: string; releaseTargetId: string; place: PlaceTarget }
  | { kind: 'escorted'; npcId: string; routeId: string; mode: 'follow-player' | 'lead-player'; from: PlaceTarget; to: PlaceTarget }
  | { kind: 'accessed'; accessPointId: string; credentialItemId: string; place: PlaceTarget }
  | { kind: 'hacked'; targetId: string; place: PlaceTarget }
  | { kind: 'sabotaged'; targetId: string; place: PlaceTarget }
  | {
      kind: 'transported';
      journeyId: string;
      mode: 'ride-hail' | 'public-transit' | 'vehicle' | 'animal' | 'aircraft';
      from: PlaceTarget;
      to: PlaceTarget;
      passengerNpcIds: string[];
      cargoItemIds: string[];
    };
