/**
 * Where a story character works. A role is met in a building that publishes a
 * post for its kind of work at the hour the story names: a barista story lands
 * on a coffee shop with an evening post, never on a tower that staffs nobody
 * like her. The agent keeps writing ids; this moves them onto a real venue and
 * hands the finished questline its place names and hour gates. When the cast is
 * resolved the people have the last word: `pin` moves each step onto the parcel
 * its own character works at, so the marked place is where they are.
 *
 * Given a set of parcels the story may use, every place stays inside it: venues
 * are chosen from it, a building outside it moves to one of the same kind that
 * is in it, and `outside` names whatever still falls out.
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
  /** The parcels the story may use, when the caller names a set; every place lands inside it. */
  private readonly allowed?: ReadonlySet<string>;

  constructor(
    private readonly world: NamedWorld,
    private readonly types: NPCTypeSet,
    allowed?: Iterable<string>,
  ) {
    this.stamp = new StepStamp(world);
    this.allowed = allowed === undefined ? undefined : new Set(allowed);
  }

  /** Hour gates first, then every role's venue, then the set, then the place names of where it all lands. */
  definition(def: QuestlineDefinition): QuestlineDefinition {
    const timed = this.stamp.definition(def);
    return this.stamp.definition(this.within(this.moveVenues(timed)));
  }

  /** Every building the questline names from outside the set, by the step or item that names it. */
  outside(def: QuestlineDefinition): { at: string; parcelId: string }[] {
    if (this.allowed === undefined) return [];
    const out: { at: string; parcelId: string }[] = [];
    for (const step of def.steps) {
      const parcelId = stepParcel(step);
      if (parcelId !== undefined && !this.allowed.has(parcelId)) out.push({ at: step.stepId, parcelId });
    }
    for (const item of def.items) {
      if (item.atParcelId !== undefined && !this.allowed.has(item.atParcelId)) out.push({ at: item.itemId, parcelId: item.atParcelId });
    }
    return out;
  }

  /**
   * The cast has the last word on where its own story is met: a step that meets
   * a role whose person holds a post in another building moves onto that
   * building, and the place names move with it. A step that meets nobody stays,
   * a role cast without a post moves nothing, and two people never pull one step
   * in two directions.
   */
  pin(def: QuestlineDefinition, posts: ReadonlyMap<string, string>): QuestlineDefinition {
    if (posts.size === 0) return def;
    const steps = def.steps.map((step) => {
      const here = stepParcel(step);
      const to = this.metAt(def, step, here, posts);
      return to === undefined || to === here || !this.usable(to) ? step : withParcel(step, to);
    });
    return this.stamp.definition({ ...def, steps });
  }

  /** Buildings that publish a post this role can hold, in world order, inside the set when there is one. */
  parcelsFor(def: QuestlineDefinition, role: QuestRole, post?: Post): NamedParcel[] {
    const type = this.types.types.find((candidate) => candidate.type === role.npcType);
    if (type === undefined) return [];
    const byPost = (parcel: NamedParcel) => post === undefined || venueOf(parcel.type).posts.includes(post);
    const eligible = (roles: StaffRole[]) =>
      roles.filter(HIRED).length === 0
        ? []
        : this.world.parcels.filter(
            (parcel) => this.usable(parcel.id) && staffs(parcel.type, roles.filter(HIRED)) && this.grounded(type, parcel) && byPost(parcel),
          );
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

  /** The building this step's own people are met in, when every one of them holds a post in the same one. */
  private metAt(
    def: QuestlineDefinition,
    step: QuestStep,
    here: string | undefined,
    posts: ReadonlyMap<string, string>,
  ): string | undefined {
    const met = rolesMet(step);
    const roles = met.length > 0 ? met : this.walkedTo(def, step, here);
    if (roles.length === 0) return undefined;
    const at = roles.map((roleId) => posts.get(roleId));
    return at.every((parcelId) => parcelId !== undefined && parcelId === at[0]) ? at[0] : undefined;
  }

  /** A step with no cast of its own follows the character who wants it, when it walks the player to their door. */
  private walkedTo(def: QuestlineDefinition, step: QuestStep, here: string | undefined): string[] {
    const roleId = step.wantedByRoleId;
    if (roleId === undefined || here === undefined || here !== workplaceOf(def, roleId)) return [];
    return [roleId];
  }

  /** Places that fell outside the set move to a building of the same kind inside it. */
  private within(def: QuestlineDefinition): QuestlineDefinition {
    if (this.allowed === undefined) return def;
    const moved = (parcelId: string | undefined): string | undefined =>
      parcelId === undefined || this.allowed!.has(parcelId) ? undefined : this.sameKindInSet(parcelId);
    const steps = def.steps.map((step) => {
      const to = moved(stepParcel(step));
      return to === undefined ? step : withParcel(step, to);
    });
    const items = def.items.map((item) => {
      const to = moved(item.atParcelId);
      return to === undefined ? item : { ...item, atParcelId: to };
    });
    return { ...def, steps, items };
  }

  /** The building of that kind inside the set, its own district first, then world order. */
  private sameKindInSet(parcelId: string): string | undefined {
    const from = this.world.parcels.find((parcel) => parcel.id === parcelId);
    if (from === undefined) return undefined;
    const eligible = this.world.parcels.filter((parcel) => this.allowed!.has(parcel.id) && parcel.type === from.type);
    return (eligible.find((parcel) => parcel.districtId === from.districtId) ?? eligible[0])?.id;
  }

  /** Is this a building the story may use? */
  private usable(parcelId: string): boolean {
    return this.allowed === undefined || this.allowed.has(parcelId);
  }

  private moveVenues(def: QuestlineDefinition): QuestlineDefinition {
    let steps = def.steps;
    for (const role of def.roles) {
      const anchor = workplaceOf({ ...def, steps }, role.roleId);
      const window = storyWindow({ ...def, steps }, role.roleId);
      const venue = this.chooseVenue(def, role, anchor, window === undefined ? undefined : postOf(window));
      if (anchor === undefined || venue === undefined || venue === anchor) continue;
      steps = steps.map((step) =>
        namesRole(step, role.roleId) ? moveParcel(step, anchor, venue) : step,
      );
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

/** The people this step meets face to face. */
function rolesMet(step: QuestStep): string[] {
  const t = step.target;
  if (t.kind === 'talk') return [t.roleId];
  if (t.kind === 'listen') return [...t.roleIds];
  return [];
}

/** The one building a step names, when it names one. */
function stepParcel(step: QuestStep): string | undefined {
  const t = step.target;
  if (t.kind === 'talk' || t.kind === 'listen' || t.kind === 'work') return t.atParcelId;
  if ('place' in t && 'parcelId' in t.place) return t.place.parcelId;
  return undefined;
}

/** The same step, meeting its people in `parcelId` instead. */
function withParcel(step: QuestStep, parcelId: string): QuestStep {
  const t = step.target;
  if (t.kind === 'talk') return { ...step, target: { ...t, atParcelId: parcelId } };
  if (t.kind === 'listen' || t.kind === 'work') return { ...step, target: { ...t, atParcelId: parcelId } };
  if ('place' in t && 'parcelId' in t.place) return { ...step, target: { ...t, place: { ...t.place, parcelId } } };
  return step;
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
