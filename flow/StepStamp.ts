/**
 * Fills the records a finished step must carry before anyone reads it: every
 * authored place gets the venue's name, and a step whose text names an hour
 * gets the window the runtime checks. Code writes both from the world, so a
 * questline can never point at a place or an hour the city does not have.
 */

import type { NamedWorld } from '../world/types/named-world.js';
import { venueName } from '../world/venues.js';
import type { PlaceIdentity, PlaceTarget, QuestlineDefinition, QuestStep, StepTarget } from './schema.js';
import { namedStepTime } from './timeWords.js';

export class StepStamp {
  constructor(private readonly world: NamedWorld) {}

  definition(def: QuestlineDefinition): QuestlineDefinition {
    return { ...def, steps: def.steps.map((step) => this.step(step)) };
  }

  step(step: QuestStep): QuestStep {
    const named = namedStepTime(step);
    return {
      ...step,
      target: this.target(step.target),
      ...(step.window === undefined && named !== undefined ? { window: named.window } : {}),
    };
  }

  /** An agent reply carrying a questline, stamped before anything validates it. */
  adaptation<T>(reply: T): T {
    const carried = reply as { definition?: QuestlineDefinition } | null;
    if (carried?.definition?.steps === undefined || !Array.isArray(carried.definition.steps)) return reply;
    return { ...carried, definition: this.definition(carried.definition) } as T;
  }

  /** The place record the engine reads: its world identity plus the venue's name. */
  place(place: PlaceIdentity | PlaceTarget): PlaceTarget {
    const { name: _authored, ...identity } = place as PlaceTarget;
    return { ...identity, name: venueName(this.world, identity) } as PlaceTarget;
  }

  private target(target: StepTarget): StepTarget {
    if ('place' in target) return { ...target, place: this.place(target.place) };
    if ('from' in target && 'to' in target) return { ...target, from: this.place(target.from), to: this.place(target.to) };
    return target;
  }
}
