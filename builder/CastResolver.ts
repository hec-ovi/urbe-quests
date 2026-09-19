/**
 * Resolves questline roles to real people through the simulation, at the hour
 * the story meets them: whoever holds the venue's post then, a reserved
 * identity when the character works no post, anyone of the type otherwise.
 * Two characters are never the same person. The builder never chooses ids or
 * coordinates; the simulation does. Given the world's venues it can also look
 * at the other buildings that publish the post; without them it casts at the
 * pinned venue and by type.
 */

import { QuestError } from '../errors.js';
import type { NPCInstance, SimulationPort, VendorQuery } from '../world/types/simulation.js';
import type { QuestlineDefinition, QuestRole, ResolvedCast, TimeWindow } from '../flow/schema.js';
import { storyWindow, workplaceOf } from '../flow/roles.js';
import { postOf, type StoryVenues } from './StoryVenues.js';

const MINUTES_PER_DAY = 1440;
const DAYS_PER_WEEK = 7;

/** Read by code, not by class: the port may be any implementation of the simulation contract. */
const isNoMatch = (error: unknown): boolean => (error as { code?: string } | null)?.code === 'E_NO_MATCH';

export interface CastOptions {
  /** People already playing a part in this set of questlines. */
  taken?: Set<string>;
  /** Characters already cast, keyed by role and type. */
  characters?: Map<string, string>;
}

export class CastResolver {
  constructor(
    private readonly sim: SimulationPort,
    private readonly venues?: StoryVenues,
  ) {}

  /**
   * One character, one person: `taken` holds everyone already playing a part
   * so nobody plays two, and `characters` holds the people already cast for a
   * role so the same character stays one person across a set of questlines.
   */
  resolve(def: QuestlineDefinition, referenceTimeMin: number, options: CastOptions = {}): ResolvedCast {
    const taken = options.taken ?? new Set<string>();
    const characters = options.characters;
    const cast: ResolvedCast = {};
    for (const role of def.roles) {
      const character = `${role.roleId}:${role.npcType}`;
      const already = characters?.get(character);
      const npcId = already ?? this.resolveRole(def, role, referenceTimeMin, taken);
      cast[role.roleId] = npcId;
      taken.add(npcId);
      characters?.set(character, npcId);
    }
    return cast;
  }

  private resolveRole(def: QuestlineDefinition, role: QuestRole, referenceTimeMin: number, taken: Set<string>): string {
    const timeMin = this.storyTime(def, role.roleId, referenceTimeMin);
    const workplace = workplaceOf(def, role.roleId);

    // The same character across questlines is the same person, whoever else is cast.
    const known = this.reservedPerson(role);
    if (known !== undefined) return known.npcId;

    const atWork = workplace === undefined ? {} : this.fromPost(def, role, workplace, timeMin, taken);
    if (atWork.free !== undefined) return atWork.free;

    if (role.reservedName !== undefined) {
      const staffRole = this.venues?.staffRoleFor(def, role);
      try {
        return this.sim.reserveNPC({
          name: role.reservedName,
          type: role.npcType,
          ...(workplace !== undefined ? { jobParcelId: workplace, ...(staffRole !== undefined ? { role: staffRole } : {}) } : {}),
        }).npcId;
      } catch (error) {
        throw this.asCastError(role, error);
      }
    }

    const elsewhere = this.fromPost(def, role, undefined, timeMin, taken);
    if (elsewhere.free !== undefined) return elsewhere.free;

    // Nobody of that type holds a post at that hour: someone of that type already in the world can play the part.
    const living = this.sim.findNPCs({ type: role.npcType }).filter((npc) => !npc.flags.dead);
    const free = living.find((npc) => !taken.has(npc.npcId));
    if (free !== undefined) return free.npcId;

    // Last resort: a part played by someone already cast beats a questline nobody can start.
    const anyone = atWork.anyone ?? elsewhere.anyone ?? living[0]?.npcId;
    if (anyone !== undefined) return anyone;
    throw this.asCastError(role, undefined, 'a role who is not someone at work needs a reservedName');
  }

  /**
   * Whoever holds the post at the story's hour: the pinned venue first, then
   * the others that publish it. `free` is nobody else's character yet.
   */
  private fromPost(
    def: QuestlineDefinition,
    role: QuestRole,
    workplace: string | undefined,
    timeMin: number,
    taken: Set<string>,
  ): { free?: string; anyone?: string } {
    const staffRole = this.venues?.staffRoleFor(def, role);
    const window = storyWindow(def, role.roleId);
    const venues = (this.venues?.parcelsFor(def, role, window === undefined ? undefined : postOf(window)) ?? [])
      .map((parcel) => parcel.id)
      .filter((parcelId) => parcelId !== workplace);
    const post = (parcelId: string): VendorQuery => ({
      parcelId,
      type: role.npcType,
      ...(staffRole !== undefined ? { role: staffRole } : {}),
      timeMin,
    });
    const queries: VendorQuery[] = [...(workplace === undefined ? [] : [workplace]), ...venues].map(post);
    if (workplace === undefined) queries.push({ type: role.npcType, timeMin });
    let anyone: string | undefined;
    for (const query of queries) {
      const found = this.ask(query);
      if (found === undefined || found.flags.dead) continue;
      if (!taken.has(found.npcId)) return { free: found.npcId, anyone: anyone ?? found.npcId };
      anyone = anyone ?? found.npcId;
    }
    return anyone === undefined ? {} : { anyone };
  }

  private ask(query: VendorQuery): NPCInstance | undefined {
    try {
      return this.sim.getNPCVendor(query);
    } catch (error) {
      if (isNoMatch(error)) return undefined;
      throw error;
    }
  }

  private reservedPerson(role: QuestRole): NPCInstance | undefined {
    if (role.reservedName === undefined) return undefined;
    return this.sim
      .findNPCs({ type: role.npcType })
      .find((npc) => npc.name.given === role.reservedName!.given && npc.name.family === role.reservedName!.family);
  }

  /** The minute the story meets this role: the hour its steps name, on the reference day when that day has it. */
  private storyTime(def: QuestlineDefinition, roleId: string, referenceTimeMin: number): number {
    const window: TimeWindow | undefined = storyWindow(def, roleId);
    if (window === undefined) return referenceTimeMin;
    const referenceDay = Math.floor(referenceTimeMin / MINUTES_PER_DAY) % DAYS_PER_WEEK;
    const day = window.days.includes(referenceDay) ? referenceDay : window.days[0]!;
    return day * MINUTES_PER_DAY + window.startMin;
  }

  private asCastError(role: QuestRole, cause: unknown, hint?: string): QuestError {
    const reason = cause instanceof Error ? cause.message : 'no candidate found';
    const message = `role ${role.roleId} (${role.npcType}) cannot be cast: ${reason}${hint !== undefined ? `; ${hint}` : ''}`;
    return new QuestError('E_CAST', message, cause);
  }
}
