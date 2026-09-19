/**
 * Where a story character works. A role is met in a building that publishes a
 * post for its kind of work at the hour the story names: a barista story lands
 * on a coffee shop with an evening post, never on a tower that staffs nobody
 * like her. The agent keeps writing ids; this moves them onto a real venue and
 * hands the finished questline its place names and hour gates. When the cast is
 * resolved the people have the last word: `pin` moves each step onto the parcel
 * its own character works at, so the marked place is where they are.
 */

import { namesRole, stepsOfRole, storyWindow, workplaceOf } from '../flow/roles.js';
import { StepStamp } from '../flow/StepStamp.js';
import type { PlaceTarget, QuestlineDefinition, QuestRole, QuestStep, TimeWindow } from '../flow/schema.js';
import type { NamedParcel, NamedWorld, NPCType, NPCTypeSet } from '../world/types/named-world.js';
import { POST_WINDOWS, staffRoles, staffs, venueOf, type Post, type StaffRole } from '../world/venues.js';

/** Living in a building is not a post: nobody is hired to be a resident or a guest. */
const HIRED = (role: StaffRole): boolean => role !== 'resident' && role !== 'guest';

/** The post an authored hour falls in. */
export const postOf = (window: TimeWindow): Post =>
  window.startMin >= POST_WINDOWS.evening.startMin ? 'evening' : 'day';

export class StoryVenues {
  private readonly stamp: StepStamp;

  constructor(
    private readonly world: NamedWorld,
    private readonly types: NPCTypeSet,
  ) {
    this.stamp = new StepStamp(world);
  }

  /** Hour gates first, then every role's venue, then the place names of where it all lands. */
  definition(def: QuestlineDefinition): QuestlineDefinition {
    const timed = this.stamp.definition(def);
    return this.stamp.definition(this.moveVenues(timed));
  }

  /**
   * Where the cast really is wins over where the story guessed: every step that
   * meets a role moves onto the parcel that role's person works at, and the
   * place names follow it.
   */
  pin(def: QuestlineDefinition, workplaces: ReadonlyMap<string, string>): QuestlineDefinition {
    return this.stamp.definition(this.moved(def, workplaces));
  }

  /** Buildings that publish a post this role can hold, in world order. */
  parcelsFor(def: QuestlineDefinition, role: QuestRole, post?: Post): NamedParcel[] {
    const type = this.types.types.find((candidate) => candidate.type === role.npcType);
    if (type === undefined) return [];
    const byPost = (parcel: NamedParcel) => post === undefined || venueOf(parcel.type).posts.includes(post);
    const eligible = (roles: StaffRole[]) =>
      roles.filter(HIRED).length === 0
        ? []
        : this.world.parcels.filter((parcel) => staffs(parcel.type, roles.filter(HIRED)) && this.grounded(type, parcel) && byPost(parcel));
    const narrow = eligible(staffRoles(type, this.roleText(def, role)));
    return narrow.length > 0 ? narrow : eligible(staffRoles(type));
  }

  /** The post this character holds, when the story's own words name one. */
  staffRoleFor(def: QuestlineDefinition, role: QuestRole): StaffRole | undefined {
    const type = this.types.types.find((candidate) => candidate.type === role.npcType);
    if (type === undefined) return undefined;
    const roles = staffRoles(type, this.roleText(def, role)).filter(HIRED);
    return roles.length === 1 ? roles[0] : undefined;
  }

  private moveVenues(def: QuestlineDefinition): QuestlineDefinition {
    const venues = new Map<string, string>();
    for (const role of def.roles) {
      const window = storyWindow(def, role.roleId);
      const anchor = workplaceOf(def, role.roleId);
      const venue = this.chooseVenue(def, role, anchor, window === undefined ? undefined : postOf(window));
      if (venue !== undefined) venues.set(role.roleId, venue);
    }
    return this.moved(def, venues);
  }

  /** Every parcel a role's steps name moves from where the story pinned it to `at`. */
  private moved(def: QuestlineDefinition, at: ReadonlyMap<string, string>): QuestlineDefinition {
    let steps = def.steps;
    for (const role of def.roles) {
      const to = at.get(role.roleId);
      const anchor = workplaceOf({ ...def, steps }, role.roleId);
      if (to === undefined || anchor === undefined || anchor === to) continue;
      steps = steps.map((step) => (namesRole(step, role.roleId) ? moveParcel(step, anchor, to) : step));
    }
    return { ...def, steps };
  }

  private chooseVenue(def: QuestlineDefinition, role: QuestRole, anchor: string | undefined, post: Post | undefined): string | undefined {
    const eligible = this.parcelsFor(def, role, post);
    if (eligible.length === 0) return anchor;
    if (anchor !== undefined && eligible.some((parcel) => parcel.id === anchor)) return anchor;
    const district = this.world.parcels.find((parcel) => parcel.id === anchor)?.districtId;
    const near = eligible.find((parcel) => parcel.districtId === district);
    return (near ?? eligible[0])!.id;
  }

  /** The words that say what this character does: their own first, then the story around them. */
  private roleText(def: QuestlineDefinition, role: QuestRole): string {
    const beats = stepsOfRole(def, role.roleId).map((step) => `${step.narrative.description} ${step.narrative.playerHint}`);
    return [role.persona, def.premise, ...beats].join(' ');
  }

  private grounded(type: NPCType, parcel: NamedParcel): boolean {
    const g = type.grounding;
    if (g.parcelTypes !== undefined && g.parcelTypes.length > 0 && !g.parcelTypes.includes(parcel.type)) return false;
    if (g.tiers !== undefined && g.tiers.length > 0 && !g.tiers.includes(parcel.tier)) return false;
    if (g.districts !== undefined && g.districts.length > 0) {
      const district = this.world.districts.find((candidate) => candidate.id === parcel.districtId);
      if (district === undefined || !g.districts.includes(district.name)) return false;
    }
    return true;
  }
}

/** Every parcel this step names for that role, moved from the authored one to the venue. */
function moveParcel(step: QuestStep, from: string, to: string): QuestStep {
  const parcel = (id: string): string => (id === from ? to : id);
  const place = (value: PlaceTarget): PlaceTarget =>
    'parcelId' in value ? { ...value, parcelId: parcel(value.parcelId) } : value;
  const t = step.target;
  if (t.kind === 'talk' && t.atParcelId !== undefined) return { ...step, target: { ...t, atParcelId: parcel(t.atParcelId) } };
  if (t.kind === 'listen' || t.kind === 'work') return { ...step, target: { ...t, atParcelId: parcel(t.atParcelId) } };
  if ('place' in t) return { ...step, target: { ...t, place: place(t.place) } };
  if ('from' in t && 'to' in t) return { ...step, target: { ...t, from: place(t.from), to: place(t.to) } };
  return step;
}
