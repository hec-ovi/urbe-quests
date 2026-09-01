/**
 * Resolves questline roles to real NPCs through the simulation: reserved
 * identities via reserveNPC (reused when that person already exists, so one
 * story character is one NPC across questlines), everyone else as whoever is
 * on duty by type. The builder never chooses ids or coordinates; the
 * simulation does.
 */

import { QuestError } from '../errors.js';
import { SimulationError, type SimulationPort } from '../world/types/simulation.js';
import type { QuestlineDefinition, QuestRole, ResolvedCast } from '../flow/schema.js';

/** Offsets tried around the reference time to catch a different shift. */
const SHIFT_TRIES = [0, 480, 960];

export class CastResolver {
  constructor(private readonly sim: SimulationPort) {}

  resolve(def: QuestlineDefinition, referenceTimeMin: number): ResolvedCast {
    const cast: ResolvedCast = {};
    for (const role of def.roles) {
      cast[role.roleId] = this.resolveRole(def, role, referenceTimeMin);
    }
    return cast;
  }

  private resolveRole(def: QuestlineDefinition, role: QuestRole, referenceTimeMin: number): string {
    const workplace = this.workplaceOf(def, role.roleId);
    if (role.reservedName !== undefined) {
      const existing = this.sim
        .findNPCs({ type: role.npcType })
        .find((npc) => npc.name.given === role.reservedName!.given && npc.name.family === role.reservedName!.family);
      if (existing !== undefined) return existing.npcId;
      try {
        return this.sim.reserveNPC({
          name: role.reservedName,
          type: role.npcType,
          ...(workplace !== undefined ? { jobParcelId: workplace } : {}),
        }).npcId;
      } catch (error) {
        throw this.asCastError(role, error);
      }
    }
    let lastError: unknown;
    for (const offset of SHIFT_TRIES) {
      try {
        return this.sim.getNPCVendor({
          type: role.npcType,
          ...(workplace !== undefined ? { parcelId: workplace } : {}),
          timeMin: referenceTimeMin + offset,
        }).npcId;
      } catch (error) {
        if (error instanceof SimulationError && error.code === 'E_NO_MATCH') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw this.asCastError(role, lastError);
  }

  /** The parcel a role is pinned to by its talk or listen steps, when any. */
  private workplaceOf(def: QuestlineDefinition, roleId: string): string | undefined {
    for (const step of def.steps) {
      const t = step.target;
      if (t.kind === 'talk' && t.roleId === roleId && t.atParcelId !== undefined) return t.atParcelId;
      if (t.kind === 'listen' && t.roleIds.includes(roleId)) return t.atParcelId;
    }
    return undefined;
  }

  private asCastError(role: QuestRole, cause: unknown): QuestError {
    const reason = cause instanceof Error ? cause.message : 'no candidate found';
    return new QuestError('E_CAST', `role ${role.roleId} (${role.npcType}) cannot be cast: ${reason}`, cause);
  }
}
