/**
 * Resolves questline roles to real people through the simulation, at the hour
 * the story meets them: whoever holds the venue's post then, a reserved
 * identity when the character works no post, anyone of the type otherwise.
 * Two characters are never the same person. The builder never chooses ids or
 * coordinates; the simulation does, and it also says where the city hires, so
 * a story is never met in a building nobody works in. A role the city cannot
 * fill blocks the questline with its reason instead of dropping it.
 *
 * Casting reads the questline, it never rewrites it: `posts` reports the
 * building each character was found holding a post in, and the creation stage
 * pins the questline with it ([StoryVenues.pin](StoryVenues.ts)) before the
 * bundle ships. Where a step happens is decided once, while it is built.
 */

import { QuestError } from '../errors.js';
import type { NPCInstance, SimulationPort, VendorQuery } from '../world/types/simulation.js';
import type { QuestlineDefinition, QuestRole, ResolvedCast, TimeWindow } from '../flow/schema.js';
import { storyWindow, workplaceOf } from '../flow/roles.js';
import { postOf, type StoryVenues } from './StoryVenues.js';
import { Workplaces } from './Workplaces.js';

const MINUTES_PER_DAY = 1440;
const DAYS_PER_WEEK = 7;

/** A role nobody can play, and why. The questline is published blocked with this. */
export interface CastBlock {
  roleId: string;
  npcType: string;
  reason: string;
}

export interface CastResult {
  /** roleId -> npcId, complete unless the questline is blocked. */
  cast: ResolvedCast;
  /**
   * roleId -> the building that character holds a post in, for the roles found
   * on one. A role filled any other way is absent, so nothing moves onto a
   * stranger's workplace. The creation stage pins with this; a host at load
   * plays the questline as the bundle ships it.
   */
  posts: Record<string, string>;
  /** Present when a role could not be filled; the host shows the questline blocked with `reason`. */
  blocked?: CastBlock;
}

export interface CastOptions {
  /** People already playing a part in this set of questlines. */
  taken?: Set<string>;
  /** Characters already cast, keyed by role and type. */
  characters?: Map<string, string>;
}

/** A role the city cannot fill blocks its questline; anything else is a real failure. */
const blocks = (error: unknown): boolean =>
  error instanceof QuestError
    ? error.code === 'E_CAST'
    : typeof (error as { code?: unknown } | null)?.code === 'string';

export class CastResolver {
  private readonly workplaces: Workplaces;
  /** npcId -> the building they were found holding a post in, kept across a questline set. */
  private readonly postOf = new Map<string, string>();

  constructor(
    private readonly sim: SimulationPort,
    private readonly venues?: StoryVenues,
  ) {
    this.workplaces = new Workplaces(sim);
  }

  /**
   * One character, one person: `taken` holds everyone already playing a part
   * so nobody plays two, and `characters` holds the people already cast for a
   * role so the same character stays one person across a set of questlines.
   * A blocked questline commits nobody, so its people stay free for the rest.
   */
  cast(def: QuestlineDefinition, referenceTimeMin: number, options: CastOptions = {}): CastResult {
    const taken = options.taken ?? new Set<string>();
    const playing = new Set(taken);
    const cast: ResolvedCast = {};
    const posts: Record<string, string> = {};
    for (const role of def.roles) {
      const character = `${role.roleId}:${role.npcType}`;
      try {
        const npcId = options.characters?.get(character) ?? this.resolveRole(def, role, referenceTimeMin, playing);
        cast[role.roleId] = npcId;
        const post = this.postOf.get(npcId);
        if (post !== undefined) posts[role.roleId] = post;
        playing.add(npcId);
      } catch (error) {
        if (!blocks(error)) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        return { cast, posts, blocked: { roleId: role.roleId, npcType: role.npcType, reason } };
      }
    }
    for (const role of def.roles) {
      const npcId = cast[role.roleId]!;
      taken.add(npcId);
      options.characters?.set(`${role.roleId}:${role.npcType}`, npcId);
    }
    return { cast, posts };
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
      // A job at a building the city does not hire in is no job the simulation can give.
      const hiring = workplace !== undefined && this.workplaces.hires(workplace, timeMin);
      try {
        const reserved = this.sim.reserveNPC({
          name: role.reservedName,
          type: role.npcType,
          ...(hiring ? { jobParcelId: workplace, ...(staffRole !== undefined ? { role: staffRole } : {}) } : {}),
        });
        if (hiring) this.postOf.set(reserved.npcId, workplace!);
        return reserved.npcId;
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
      const found = this.workplaces.vendor(query);
      if (found === undefined || found.flags.dead) continue;
      // Found on a post: this is the building the story meets them in.
      if (query.parcelId !== undefined) this.postOf.set(found.npcId, query.parcelId);
      else if (found.job !== undefined) this.postOf.set(found.npcId, found.job.parcelId);
      if (!taken.has(found.npcId)) return { free: found.npcId, anyone: anyone ?? found.npcId };
      anyone = anyone ?? found.npcId;
    }
    return anyone === undefined ? {} : { anyone };
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
