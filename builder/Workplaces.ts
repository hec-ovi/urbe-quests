/**
 * Asking the city for the person on a post, and remembering where the city
 * hires at all. A venue table can offer a building the simulation staffs
 * nobody in; the simulation has the last word, so a parcel it does not hire at
 * answers "nobody" instead of costing the whole questline, and is never asked
 * about again.
 */

import type { NPCInstance, SimulationPort, VendorQuery } from '../world/types/simulation.js';

/** Read by code, not by class: the port may be any implementation of the simulation contract. */
const codeOf = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

export class Workplaces {
  /** parcel id -> the city hires there. */
  private readonly hiring = new Map<string, boolean>();

  constructor(private readonly sim: SimulationPort) {}

  /** Whoever holds the queried post: nobody when none matches, or when the city does not hire at that parcel. */
  vendor(query: VendorQuery): NPCInstance | undefined {
    const { parcelId } = query;
    if (parcelId !== undefined && this.hiring.get(parcelId) === false) return undefined;
    try {
      const found = this.sim.getNPCVendor(query);
      this.note(parcelId, true);
      return found;
    } catch (error) {
      const code = codeOf(error);
      if (code === 'E_UNKNOWN_ID' && parcelId !== undefined) {
        this.hiring.set(parcelId, false);
        return undefined;
      }
      if (code !== 'E_NO_MATCH') throw error;
      // A post nobody holds at that minute: the building still hires.
      this.note(parcelId, true);
      return undefined;
    }
  }

  /** Does the city hire at this parcel? Answered from what the queries already learned, else asked once. */
  hires(parcelId: string, timeMin: number): boolean {
    const known = this.hiring.get(parcelId);
    if (known !== undefined) return known;
    this.vendor({ parcelId, timeMin });
    return this.hiring.get(parcelId) ?? false;
  }

  private note(parcelId: string | undefined, hiring: boolean): void {
    if (parcelId !== undefined) this.hiring.set(parcelId, hiring);
  }
}
