import { STEP_KINDS, type QuestlineDefinition, type StepKind } from '../../flow/schema.js';
import type { NamedWorld, NPCTypeSet } from '../../world/types/named-world.js';

/** The flow's closed step vocabulary; a mechanic skill covers exactly one kind. */
export const MECHANICS = STEP_KINDS;
export type Mechanic = StepKind;

export interface WorldContext {
  world: NamedWorld;
  types: NPCTypeSet;
}

export type { PlaceTarget, StepTarget, Predicate, Effect, QuestStep, QuestlineDefinition } from '../../flow/schema.js';
export type { FlagOp } from '../../world/types/simulation.js';

export interface SkillSummary {
  name: string;
  description: string;
  triggers: string[];
  kind: 'stage' | 'mechanic';
  mechanic?: Mechanic;
}

export interface ResolvedSkill extends SkillSummary {
  path: string;
  content: string;
}

export interface SkillIndex {
  skills: SkillSummary[];
}

export interface SkillRouteResult {
  matches: SkillSummary[];
}

export interface ResolvedSkills {
  skills: ResolvedSkill[];
}

export interface StoryRequest extends WorldContext {
  prompt: string;
  requirements?: string[];
}

export interface StoryCharacter {
  characterId: string;
  name: string;
  role: string;
  background: string;
  want: string;
  voice: string;
}

export interface StoryBeat {
  beatId: string;
  heading: string;
  scene: {
    placeName: string;
    time: string;
    description: string;
  };
  action: string;
  dialogue: { speakerCharacterId: string; line: string }[];
  consequence: string;
  characterIds: string[];
}

export interface StoryDecision {
  decisionId: string;
  setup: string;
  options: { outcomeId: string; choice: string; consequence: string }[];
}

export interface StoryOutput {
  storyId: string;
  prompt: string;
  title: string;
  logline: string;
  setting: {
    summary: string;
    placeNames: string[];
  };
  characters: StoryCharacter[];
  movements: {
    presentation: StoryBeat[];
    development: StoryBeat[];
    conflict: StoryBeat[];
    ending: StoryBeat[];
  };
  decisions: StoryDecision[];
}

export interface AdaptationRequest extends WorldContext {
  story: StoryOutput;
  requestedMechanics?: string[];
}

export interface MechanicSelection {
  mechanics: string[];
}

export interface MechanicChoice {
  stepId: string;
  mechanic: Mechanic;
  storyBeatIds: string[];
  narrativeReason: string;
  cause: string;
  effect: string;
  transitions: { toStepId: string; narrativeCause: string; consequence: string }[];
}

export interface EndingRoute {
  endingId: string;
  terminalStepIds: string[];
  storyOutcomeIds: string[];
  cause: string;
  consequence: string;
}

export interface AdaptationOutput {
  definition: QuestlineDefinition;
  mechanicChoices: MechanicChoice[];
  endingRoutes: EndingRoute[];
}

export interface SchemaBundle {
  rootId: string;
  documents: object[];
}

export interface StoryAgentRequest {
  stage: 'story';
  skills: ResolvedSkills;
  input: StoryRequest;
  outputSchema: SchemaBundle;
}

export interface MechanicSelectionAgentRequest {
  stage: 'mechanic-selection';
  skills: ResolvedSkills;
  input: AdaptationRequest;
  availableSkills: SkillIndex;
  outputSchema: SchemaBundle;
}

export interface GameplayAgentRequest {
  stage: 'gameplay-adaptation';
  skills: ResolvedSkills;
  input: AdaptationRequest;
  selection: MechanicSelection;
  outputSchema: SchemaBundle;
}

export interface StoryAgentPort {
  write(request: StoryAgentRequest): Promise<unknown>;
}

export interface GameplayAgentPort {
  selectMechanics(request: MechanicSelectionAgentRequest): Promise<unknown>;
  adapt(request: GameplayAgentRequest): Promise<unknown>;
}
