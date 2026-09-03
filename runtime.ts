/**
 * The browser-safe surface: what a host needs at play time, with no node
 * APIs behind it. Creation, story passes and dialog stay on index.ts (they
 * read prompt files).
 */

export { QuestError, type QuestErrorCode } from './errors.js';
export type * from './world/types/named-world.js';
export type * from './world/types/simulation.js';
export * from './flow/schema.js';
export type { PlayerEvent } from './flow/events.js';
export { FlowValidator } from './flow/validate.js';
export { QuestlineSetValidator, type QuestlineSet } from './flow/QuestlineSet.js';
export {
  QuestlineRuntime,
  type AdvanceResult,
  type QuestlineState,
  type QuestlineStatus,
} from './flow/QuestlineRuntime.js';
export type { AvailabilityWindow, StepAvailability, UnavailableReason } from './flow/availability.js';
export type { QuestPlace } from './flow/places.js';
export { guidanceFor, type GuidanceReason, type RouteDestination, type StepGuidance } from './flow/guidance.js';
export { QuestlineStateValidator } from './flow/state.js';
export { CastResolver } from './builder/CastResolver.js';
