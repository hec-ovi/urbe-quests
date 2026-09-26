/** Quests layer surface for consumers (see CONTRACT.md). */

export { QuestError, type QuestErrorCode } from './errors.js';
export type { AgentPort, AgentReply, AgentTool, AgentToolCall, AgentTurn, LLMPort, StreamingLLMPort } from './ports/llm.js';
export {
  chatDeltas,
  ChatToolCalls,
  type ChatDelta,
  type ChatMessage,
  type ChatRequest,
  type ChatTool,
  type ChatToolCall,
} from './ports/chat.js';

export * from './world/index.js';

export * from './flow/schema.js';
export type { PlayerEvent } from './flow/events.js';
export { FlowValidator } from './flow/validate.js';
export { QuestlineSetValidator, type QuestlineSet } from './flow/QuestlineSet.js';
export {
  QuestlineRuntime,
  type AdvanceResult,
  type DialogueChoiceResult,
  type QuestlineState,
  type QuestlineStatus,
} from './flow/QuestlineRuntime.js';
export { QuestlineStateValidator } from './flow/state.js';
export type { AvailabilityWindow, StepAvailability, UnavailableReason } from './flow/availability.js';
export type { QuestPlace } from './flow/places.js';
export { storyWindow, workplaceOf } from './flow/roles.js';
export { StepStamp } from './flow/StepStamp.js';
export { guidanceFor, type GuidanceReason, type RouteDestination, type StepGuidance } from './flow/guidance.js';

export * from './story/schema.js';
export { ScriptPass, DEFAULT_SCRIPT_MINIMUMS, type ScriptPassInput } from './story/ScriptPass.js';
export { SituationsPass, DEFAULT_SITUATION_MINIMUMS, type SituationsPassInput } from './story/SituationsPass.js';
export { renderCards, renderMovements, renderScript } from './story/renderScript.js';
export { loadFixtureStory, type FixtureStory, type FixtureStoryName } from './story/fixtures.js';

export type { BuildProgress, QuestAssignment, TranslationResult } from './builder/schema.js';
export { parsePlanManifest, type PlanManifest } from './builder/PlanManifest.js';
export { TranslationPlanner, type PlanInput, type PlanResult } from './builder/TranslationPlanner.js';
export { QuestlineBuilder, type BuildInput, type BuildResult } from './builder/QuestlineBuilder.js';
export { QuestlineTranslator, type TranslateInput } from './builder/QuestlineTranslator.js';
export { BUILDER_TOOLS } from './builder/tools.js';
export { CastResolver, type CastBlock, type CastOptions, type CastResult } from './builder/CastResolver.js';
export { StoryVenues } from './builder/StoryVenues.js';

export type { CreationInput, CreationResult, SideQuest, StagePorts } from './creation/schema.js';
export { Assignments } from './creation/Assignments.js';
export { QuestlineCreation } from './creation/QuestlineCreation.js';

export { DialogContextService, type DialogContextServiceInput } from './dialog/DialogContextService.js';
export { Converse, type ConverseInput, type ConverseStreamInput, type ReplyEvent } from './dialog/Converse.js';
export type { CompanionOffer, OfferOptions, OfferPlace } from './dialog/offers.js';
export { cleanReply, ReplyCleaner } from './dialog/ReplyCleaner.js';
export type {
  ContextOptions,
  ContextSegment,
  DialogContext,
  DialogExchange,
  DialogGuide,
  DialogTurn,
  DialogWorld,
  MemorySnapshot,
  SegmentId,
} from './dialog/schema.js';

export * from './authoring/index.js';
export * from './handoff/index.js';
