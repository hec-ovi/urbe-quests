/**
 * Schedule and liveness gating, computed on demand from simulation routines.
 * Nothing here is stored: a quest at the bar exists only while its NPC is
 * actually behind the bar.
 */

import { QuestError } from '../errors.js';
import type { NPCInstance, SimulationPort } from '../world/types/simulation.js';
import type { PlaceTarget, QuestStep, ResolvedCast } from './schema.js';

export type UnavailableReason = 'role_dead' | 'not_present' | 'off_duty' | 'missing_item' | 'condition';

export interface StepAvailability {
  available: boolean;
  reason?: UnavailableReason;
}

/** Weekly recurring window, simulation time convention (0 = Monday). */
export interface AvailabilityWindow {
  days: number[];
  startMin: number;
  endMin: number;
}

const APPROACHABLE = new Set(['home', 'working', 'shopping', 'leisure']);

export class AvailabilityService {
  constructor(
    private readonly sim: SimulationPort,
    private readonly cast: ResolvedCast,
  ) {}

  isRoleAlive(roleId: string): boolean {
    return !this.npc(roleId).flags.dead;
  }

  isRoleOnDuty(roleId: string, timeMin: number): boolean {
    const npc = this.npc(roleId);
    if (npc.flags.dead || npc.job === undefined) return false;
    const behavior = this.sim.behaviorAt(npc.npcId, timeMin);
    return behavior.activity === 'working';
  }

  /** Liveness and presence gate for a step's target; predicates are the runtime's business. */
  targetAvailability(step: QuestStep, timeMin: number): StepAvailability {
    const t = step.target;
    switch (t.kind) {
      case 'talk':
        return this.presence(t.roleId, timeMin, t.atParcelId);
      case 'assassinate':
        return this.presence(t.roleId, timeMin, undefined);
      case 'listen': {
        for (const roleId of t.roleIds) {
          const each = this.presence(roleId, timeMin, t.atParcelId);
          if (!each.available) return each;
        }
        return { available: true };
      }
      case 'steal': {
        if (!this.isRoleAlive(t.fromRoleId)) return { available: false, reason: 'role_dead' };
        return { available: true };
      }
      case 'rescue':
        return this.presenceAt(t.roleId, timeMin, t.place);
      case 'escort':
        return this.presenceAt(t.roleId, timeMin, t.from);
      case 'transportation': {
        for (const roleId of t.passengerRoleIds) {
          const each = this.presenceAt(roleId, timeMin, t.from);
          if (!each.available) return each;
        }
        return { available: true };
      }
      case 'goto':
      case 'observe':
      case 'pickup':
      case 'deliver':
      case 'work':
      case 'investigation':
      case 'access':
      case 'hacking':
      case 'sabotage':
        return { available: true };
    }
  }

  /**
   * Weekly windows in which the step's target can be acted on; undefined when
   * the step is not schedule-bound. Derived from routines, never stored.
   */
  windows(step: QuestStep): AvailabilityWindow[] | undefined {
    const t = step.target;
    if (t.kind === 'talk') return this.roleWindows(t.roleId, t.atParcelId);
    if (t.kind === 'assassinate') return this.roleWindows(t.roleId, undefined);
    if (t.kind === 'listen') {
      const [a, b] = t.roleIds;
      return intersectWindows(this.roleWindows(a, t.atParcelId), this.roleWindows(b, t.atParcelId));
    }
    if (t.kind === 'rescue') return this.roleWindowsAt(t.roleId, t.place);
    if (t.kind === 'escort') return this.roleWindowsAt(t.roleId, t.from);
    if (t.kind === 'transportation' && t.passengerRoleIds.length > 0) {
      return t.passengerRoleIds
        .map((roleId) => this.roleWindowsAt(roleId, t.from))
        .reduce((overlap, windows) => intersectWindows(overlap, windows));
    }
    return undefined;
  }

  private presenceAt(roleId: string, timeMin: number, place: PlaceTarget): StepAvailability {
    const npc = this.npc(roleId);
    if (npc.flags.dead) return { available: false, reason: 'role_dead' };
    const behavior = this.sim.behaviorAt(npc.npcId, timeMin);
    if (!APPROACHABLE.has(behavior.activity)) return { available: false, reason: 'not_present' };
    if ('parcelId' in place && (behavior.place.kind !== 'parcel' || behavior.place.id !== place.parcelId)) {
      return { available: false, reason: 'off_duty' };
    }
    if ('stopId' in place && (behavior.place.kind !== 'stop' || behavior.place.id !== place.stopId)) {
      return { available: false, reason: 'off_duty' };
    }
    return { available: true };
  }

  private roleWindowsAt(roleId: string, place: PlaceTarget): AvailabilityWindow[] {
    const windows = this.roleWindows(roleId, 'parcelId' in place ? place.parcelId : undefined);
    if (!('stopId' in place)) return windows;
    return this.npc(roleId).routine
      .filter((entry) => APPROACHABLE.has(entry.activity))
      .filter((entry) => entry.place.kind === 'stop' && entry.place.id === place.stopId)
      .map((entry) => ({ days: [...entry.days], startMin: entry.startMin, endMin: entry.endMin }));
  }

  private presence(roleId: string, timeMin: number, atParcelId: string | undefined): StepAvailability {
    const npc = this.npc(roleId);
    if (npc.flags.dead) return { available: false, reason: 'role_dead' };
    const behavior = this.sim.behaviorAt(npc.npcId, timeMin);
    if (!APPROACHABLE.has(behavior.activity)) return { available: false, reason: 'not_present' };
    if (atParcelId !== undefined) {
      const there = behavior.place.kind === 'parcel' && behavior.place.id === atParcelId;
      if (!there) return { available: false, reason: 'off_duty' };
    }
    return { available: true };
  }

  private roleWindows(roleId: string, atParcelId: string | undefined): AvailabilityWindow[] {
    const npc = this.npc(roleId);
    return npc.routine
      .filter((e) => APPROACHABLE.has(e.activity))
      .filter((e) => atParcelId === undefined || (e.place.kind === 'parcel' && e.place.id === atParcelId))
      .map((e) => ({ days: [...e.days], startMin: e.startMin, endMin: e.endMin }));
  }

  private npc(roleId: string): NPCInstance {
    const npcId = this.cast[roleId];
    if (npcId === undefined) {
      throw new QuestError('E_UNKNOWN_ID', `role ${roleId} has no cast entry`);
    }
    return this.sim.getNPC(npcId);
  }
}

/** Pairwise same-day overlap of two weekly window sets. */
function intersectWindows(a: AvailabilityWindow[], b: AvailabilityWindow[]): AvailabilityWindow[] {
  const result: AvailabilityWindow[] = [];
  for (const wa of a) {
    for (const wb of b) {
      const days = wa.days.filter((d) => wb.days.includes(d));
      const startMin = Math.max(wa.startMin, wb.startMin);
      const endMin = Math.min(wa.endMin, wb.endMin);
      if (days.length > 0 && startMin < endMin) result.push({ days, startMin, endMin });
    }
  }
  return result;
}
