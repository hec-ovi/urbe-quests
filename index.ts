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

export * from './story/schema.js';
export { ScriptPass, DEFAULT_SCRIPT_MINIMUMS, type ScriptPassInput } from './story/ScriptPass.js';
export { SituationsPass, DEFAULT_SITUATION_MINIMUMS, type SituationsPassInput } from './story/SituationsPass.js';
export { renderCards, renderMovements, renderScript } from './story/renderScript.js';
export { loadFixtureStory, type FixtureStory, type FixtureStoryName } from './story/fixtures.js';

export type { QuestAssignment, TranslationResult } from './builder/schema.js';
export { TranslationPlanner, type PlanInput } from './builder/TranslationPlanner.js';
export { QuestlineBuilder, type BuildInput, type BuildResult } from './builder/QuestlineBuilder.js';
export { QuestlineTranslator, type TranslateInput } from './builder/QuestlineTranslator.js';
export { BUILDER_TOOLS } from './builder/tools.js';

export type { CreationInput, CreationResult, SideQuest, StagePorts } from './creation/schema.js';
export { Assignments } from './creation/Assignments.js';
export { QuestlineCreation } from './creation/QuestlineCreation.js';

export { DialogContextService, type DialogContextServiceInput } from './dialog/DialogContextService.js';
export { Converse, type ConverseInput } from './dialog/Converse.js';
export type { ContextSegment, DialogContext, DialogTurn, MemorySnapshot, SegmentId } from './dialog/schema.js';
