/** Quests layer surface for consumers (see CONTRACT.md). */

export { QuestError, type QuestErrorCode } from './errors.js';
export type { AgentPort, AgentReply, AgentTool, AgentToolCall, AgentTurn, LLMPort } from './ports/llm.js';

export * from './world/index.js';

export * from './flow/schema.js';
export type { PlayerEvent } from './flow/events.js';
export { FlowValidator } from './flow/validate.js';
export {
  QuestlineRuntime,
  type AdvanceResult,
  type QuestlineState,
  type QuestlineStatus,
} from './flow/QuestlineRuntime.js';
export type { AvailabilityWindow, StepAvailability, UnavailableReason } from './flow/availability.js';

export { StoryPass, type StoryPassInput } from './story/StoryPass.js';
export type { SidePremise, StoryDocument, StoryPassResult } from './story/schema.js';

export { QuestlineBuilder, type BuildInput, type BuildResult } from './builder/QuestlineBuilder.js';
export { BUILDER_TOOLS } from './builder/tools.js';

export { DialogContextService, type DialogContextServiceInput } from './dialog/DialogContextService.js';
export type { ContextSegment, DialogContext, DialogTurn, MemorySnapshot, SegmentId } from './dialog/schema.js';
