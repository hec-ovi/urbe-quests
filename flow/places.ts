/**
 * Where a step points right now, so a host can mark it on a map: the parcel
 * or district the target names, the parcel an item sits at, or wherever the
 * simulation says the targeted person is at that minute. Derived on demand,
 * never stored, like availability.
 */

import { QuestError } from '../errors.js';
import type { PlaceRef, SimulationPort } from '../world/types/simulation.js';
import type { PlaceTarget, QuestItem, QuestStep, ResolvedCast } from './schema.js';

/** An authored place or whatever the simulation reports for a person. */
export type QuestPlace = PlaceRef | { kind: 'district'; id: string } | { kind: 'station'; id: string };

export class StepPlaces {
  private readonly items: Map<string, QuestItem>;

  constructor(
    private readonly sim: SimulationPort,
    private readonly cast: ResolvedCast,
    items: QuestItem[],
  ) {
    this.items = new Map(items.map((i) => [i.itemId, i]));
  }

  /** Undefined when the simulation has no place to give: the targeted person is dead, or the item is not placed. */
  place(step: QuestStep, timeMin: number): QuestPlace | undefined {
    const t = step.target;
    switch (t.kind) {
      case 'goto':
      case 'deliver':
        return fromPlaceTarget(t.place);
      case 'observe':
        return { kind: 'district', id: t.districtId };
      case 'investigation':
      case 'rescue':
      case 'access':
      case 'hacking':
      case 'sabotage':
        return fromPlaceTarget(t.place);
      case 'escort':
      case 'transportation':
        return fromPlaceTarget(t.from);
      case 'listen':
      case 'work':
        return { kind: 'parcel', id: t.atParcelId };
      case 'talk':
        return t.atParcelId !== undefined ? { kind: 'parcel', id: t.atParcelId } : this.personPlace(t.roleId, timeMin);
      case 'assassinate':
        return this.personPlace(t.roleId, timeMin);
      case 'steal':
        return this.personPlace(t.fromRoleId, timeMin);
      case 'pickup': {
        const parcelId = this.items.get(t.itemId)?.atParcelId;
        return parcelId === undefined ? undefined : { kind: 'parcel', id: parcelId };
      }
    }
  }

  private personPlace(roleId: string, timeMin: number): QuestPlace | undefined {
    const npcId = this.cast[roleId];
    if (npcId === undefined) throw new QuestError('E_UNKNOWN_ID', `role ${roleId} has no cast entry`);
    if (this.sim.getNPC(npcId).flags.dead) return undefined;
    return this.sim.behaviorAt(npcId, timeMin).place;
  }
}

const fromPlaceTarget = (place: PlaceTarget): QuestPlace => {
  if ('parcelId' in place) return { kind: 'parcel', id: place.parcelId };
  if ('districtId' in place) return { kind: 'district', id: place.districtId };
  if ('stationId' in place) return { kind: 'station', id: place.stationId };
  return { kind: 'stop', id: place.stopId };
};
