/**
 * Weekly routine builder for stub NPCs. Full-week coverage with no gaps, per
 * the simulation contract. Stub limitation: shifts must not span midnight
 * (startMin < endMin).
 */

import type { Job, PlaceRef, RoutineEntry } from '../types/simulation.js';
import { MINUTES_PER_DAY } from '../types/simulation.js';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const COMMUTE_MIN = 30;
const WAKE_MIN = 420;
const SLEEP_MIN = 1380;

export class RoutineBuilder {
  constructor(
    private readonly homeParcelId: string,
    private readonly leisureParcelId: string,
  ) {}

  build(job?: Job): RoutineEntry[] {
    const home: PlaceRef = { kind: 'parcel', id: this.homeParcelId };
    const leisure: PlaceRef = { kind: 'parcel', id: this.leisureParcelId };
    const entries: RoutineEntry[] = [];

    for (const day of ALL_DAYS) {
      const working = job !== undefined && job.shift.days.includes(day);
      if (working) {
        const { startMin, endMin } = job.shift;
        const leave = startMin - COMMUTE_MIN;
        const back = endMin + COMMUTE_MIN;
        entries.push(
          { days: [day], startMin: 0, endMin: Math.min(WAKE_MIN, leave), activity: 'sleeping', place: home },
        );
        if (leave > WAKE_MIN) {
          entries.push({ days: [day], startMin: WAKE_MIN, endMin: leave, activity: 'home', place: home });
        }
        entries.push(
          { days: [day], startMin: leave, endMin: startMin, activity: 'commuting', place: { kind: 'edge', id: 'e_stub' } },
          { days: [day], startMin, endMin, activity: 'working', place: { kind: 'parcel', id: job.parcelId } },
          { days: [day], startMin: endMin, endMin: Math.min(back, MINUTES_PER_DAY), activity: 'commuting', place: { kind: 'edge', id: 'e_stub' } },
        );
        if (back < SLEEP_MIN) {
          entries.push({ days: [day], startMin: back, endMin: SLEEP_MIN, activity: 'leisure', place: leisure });
          entries.push({ days: [day], startMin: SLEEP_MIN, endMin: MINUTES_PER_DAY, activity: 'sleeping', place: home });
        } else if (back < MINUTES_PER_DAY) {
          entries.push({ days: [day], startMin: back, endMin: MINUTES_PER_DAY, activity: 'sleeping', place: home });
        }
      } else {
        entries.push(
          { days: [day], startMin: 0, endMin: WAKE_MIN + 60, activity: 'sleeping', place: home },
          { days: [day], startMin: WAKE_MIN + 60, endMin: 720, activity: 'home', place: home },
          { days: [day], startMin: 720, endMin: 900, activity: 'shopping', place: leisure },
          { days: [day], startMin: 900, endMin: SLEEP_MIN, activity: 'home', place: home },
          { days: [day], startMin: SLEEP_MIN, endMin: MINUTES_PER_DAY, activity: 'sleeping', place: home },
        );
      }
    }
    return entries;
  }
}
