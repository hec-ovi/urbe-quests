/** Player events the engine feeds into the runtime. Closed set. */

export type PlayerEvent =
  | { kind: 'talkedTo'; npcId: string }
  | { kind: 'arrivedAt'; parcelId?: string; districtId?: string }
  | { kind: 'observed'; districtId: string }
  | { kind: 'pickedUp'; itemId: string }
  | { kind: 'delivered'; itemId: string; parcelId?: string; districtId?: string }
  | { kind: 'overheard'; npcIds: string[] }
  | { kind: 'stole'; itemId: string }
  | { kind: 'killed'; npcId: string }
  | { kind: 'workedShift'; parcelId: string };
