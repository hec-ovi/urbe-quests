/**
 * The browser-safe surface: what a host needs at play time, with no node
 * APIs behind it. Creation, story passes and dialog stay on index.ts (they
 * read prompt files).
 */

export { QuestError, type QuestErrorCode } from './errors.js';
export type * from './world/types/named-world.js';
export type * from './world/types/simulation.js';
export * from './flow/schema.js';
export { CUES, stripCues, type Cue } from './flow/cues.js';
export type { PlayerEvent } from './flow/events.js';
export { FlowValidator } from './flow/validate.js';
export { isOffered, QuestlineSetValidator, type QuestlineSet } from './flow/QuestlineSet.js';
export {
  QuestlineRuntime,
  type AdvanceResult,
  type DialogueChoiceResult,
  type QuestlineState,
  type QuestlineStatus,
} from './flow/QuestlineRuntime.js';
export type { AvailabilityWindow, StepAvailability, UnavailableReason } from './flow/availability.js';
export type { QuestPlace } from './flow/places.js';
export { storyWindow, workplaceOf } from './flow/roles.js';
export { StepStamp } from './flow/StepStamp.js';
export { POST_WINDOWS, VENUES, venueName, type Post, type StaffRole } from './world/venues.js';
export { StreetNames, type Street, type StreetGeometry, type StreetSpot } from './world/streets.js';
export { dispositionOf, willingTo, type Disposition, type RequestPrivacy } from './world/disposition.js';
export { peopleKnown, type DialogPeople, type DialogPerson, type DialogWhereabouts, type PeopleInput } from './dialog/people.js';
export { guidanceFor, type GuidanceReason, type RouteDestination, type StepGuidance } from './flow/guidance.js';
export { QuestlineStateValidator } from './flow/state.js';
export { CastResolver, type CastBlock, type CastOptions, type CastResult } from './builder/CastResolver.js';
export { StoryVenues } from './builder/StoryVenues.js';
