import type { PlaceIdentity } from './schema.js';

/** Player events the engine feeds into the runtime. Closed set: identities only, no names. */

export type PlayerEvent =
  | { kind: 'talkedTo'; npcId: string }
  | ({ kind: 'arrivedAt' } & PlaceIdentity)
  | { kind: 'observed'; districtId: string }
  | { kind: 'pickedUp'; itemId: string }
  | ({ kind: 'delivered'; itemId: string } & PlaceIdentity)
  | { kind: 'overheard'; npcIds: string[] }
  | { kind: 'stole'; itemId: string }
  | { kind: 'killed'; npcId: string }
  | { kind: 'workedShift'; parcelId: string }
  | { kind: 'investigated'; sceneId: string; evidenceId: string; place: PlaceIdentity }
  | { kind: 'released'; npcId: string; releaseTargetId: string; place: PlaceIdentity }
  | { kind: 'escorted'; npcId: string; routeId: string; mode: 'follow-player' | 'lead-player'; from: PlaceIdentity; to: PlaceIdentity }
  | { kind: 'accessed'; accessPointId: string; credentialItemId: string; place: PlaceIdentity }
  | { kind: 'hacked'; targetId: string; place: PlaceIdentity }
  | { kind: 'sabotaged'; targetId: string; place: PlaceIdentity }
  | {
      kind: 'transported';
      journeyId: string;
      mode: 'ride-hail' | 'public-transit' | 'vehicle' | 'animal' | 'aircraft';
      from: PlaceIdentity;
      to: PlaceIdentity;
      passengerNpcIds: string[];
      cargoItemIds: string[];
    };
