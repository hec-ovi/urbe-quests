/**
 * Questline definition: a condition-gated DAG of typed steps grouped in acts,
 * with branches and multiple endings. Narrative fields come before structural
 * ones on purpose: builder output mirrors this order so the model commits to
 * story before structure. No LLM ever reads or writes runtime state.
 */

import type { FlagOp } from '../world/types/simulation.js';
import type { StepAvailability } from './availability.js';

export interface QuestlineDefinition {
  id: string;
  title: string;
  /** Why this quest exists and what it is about, in prose. */
  premise: string;
  roles: QuestRole[];
  items: QuestItem[];
  facts: QuestFact[];
  acts: QuestAct[];
  steps: QuestStep[];
  endings: QuestEnding[];
  /** Closed set of quest flags predicates and effects may use. */
  flags: string[];
  /** Steps active when the questline starts. */
  entryStepIds: string[];
}

/**
 * Role indirection: steps bind roles, never NPC ids. The builder resolves a
 * role to a real NPC through the simulation port (by type) and layers the
 * persona on top of the NPC's deterministic background.
 */
export interface QuestRole {
  roleId: string;
  /** NPC type string from the naming type set. */
  npcType: string;
  /** Personality, needs and story overlay the LLM wrote for this role. */
  persona: string;
  /** Authored name shown and spoken for this character; does not rename or reserve the cast NPC. */
  characterName?: { given: string; family: string };
  /** Fixed identity for pre-instanced story NPCs (reserveNPC); otherwise the vendor query resolves whoever is on duty. */
  reservedName?: { given: string; family: string };
}

/** Closed artifact vocabulary; era fit is a builder catalog concern. Information is told, never picked up. */
export type ItemKind = 'device' | 'weapon' | 'document' | 'key' | 'substance' | 'valuable' | 'information';

export interface QuestItem {
  itemId: string;
  name: string;
  /** Whose it is and what it means to them, then what it is. */
  description: string;
  kind: ItemKind;
  /** Where a physical item sits on the 2D plane when it starts placed; required for pickup targets. */
  atParcelId?: string;
}

/**
 * A piece of quest knowledge an NPC can talk about. It enters that NPC's
 * dialog context only once `gateFlag` is set (always visible when omitted);
 * an ungranted fact cannot leak because it is never in the prompt.
 */
export interface QuestFact {
  factId: string;
  roleId: string;
  text: string;
  gateFlag?: string;
}

export interface QuestAct {
  actId: string;
  title: string;
  summary: string;
}

export interface QuestEnding {
  endingId: string;
  title: string;
  /** How the story closes when this ending is reached. */
  epilogue: string;
}

export type StepKind = StepTarget['kind'];

/** Every step kind once, in catalog order; the record makes a kind added to StepTarget fail to compile until it is listed. */
const CATALOG_ORDER: Record<StepKind, null> = {
  goto: null, observe: null, talk: null, listen: null, pickup: null, deliver: null, steal: null, assassinate: null, work: null,
  investigation: null, rescue: null, escort: null, access: null, hacking: null, sabotage: null, transportation: null,
};

/** The closed step vocabulary, in catalog order. */
export const STEP_KINDS: readonly StepKind[] = Object.freeze(Object.keys(CATALOG_ORDER) as StepKind[]);

/** Closed step vocabulary; era fit is a builder catalog concern, not a code one. */
export type StepTarget =
  | { kind: 'goto'; place: PlaceTarget }
  | { kind: 'observe'; districtId: string }
  | { kind: 'talk'; roleId: string; atParcelId?: string }
  | { kind: 'listen'; roleIds: [string, string]; atParcelId: string }
  | { kind: 'pickup'; itemId: string }
  | { kind: 'deliver'; itemId: string; place: PlaceTarget }
  | { kind: 'steal'; itemId: string; fromRoleId: string }
  | { kind: 'assassinate'; roleId: string }
  | { kind: 'work'; atParcelId: string; role: string }
  /** One fixed clue in an authored incident. Ordered clue stages are separate DAG steps. */
  | {
      kind: 'investigation';
      sceneId: string;
      evidenceId: string;
      evidenceItemId: string;
      subjectRoleIds: string[];
      place: PlaceTarget;
      completionFlag: string;
    }
  /** Release one cast character through one authored restraint or release interaction. */
  | { kind: 'rescue'; roleId: string; releaseTargetId: string; place: PlaceTarget; completionFlag: string }
  /** Keep one cast character with the player along one authored route. */
  | {
      kind: 'escort';
      roleId: string;
      routeId: string;
      mode: 'follow-player' | 'lead-player';
      from: PlaceTarget;
      to: PlaceTarget;
      completionFlag: string;
    }
  /** Use a declared credential at one authored access point. */
  | { kind: 'access'; accessPointId: string; credentialItemId: string; place: PlaceTarget; completionFlag: string }
  /** Complete one authored intrusion against a target at a known place. */
  | { kind: 'hacking'; targetId: string; place: PlaceTarget; completionFlag: string }
  /** Complete one authored state change against a target at a known place. */
  | { kind: 'sabotage'; targetId: string; place: PlaceTarget; completionFlag: string }
  /** Complete one authored journey. The player is implicit; other passengers and cargo are exact. */
  | {
      kind: 'transportation';
      journeyId: string;
      mode: 'ride-hail' | 'public-transit' | 'vehicle' | 'animal' | 'aircraft';
      from: PlaceTarget;
      to: PlaceTarget;
      passengerRoleIds: string[];
      cargoItemIds: string[];
      completionFlag: string;
    };

/** Stable world identity, repeated by the events that complete a step. */
export type PlaceIdentity =
  | { parcelId: string }
  | { districtId: string }
  | { stationId: string }
  | { stopId: string };

/** An authored place: the world identity plus the venue's name, so a hint and a marker say where. */
export type PlaceTarget = PlaceIdentity & { name: string };

/** A weekly window a step is open in, simulation time convention (0 = Monday). */
export interface TimeWindow {
  /** The words the step's own text uses for this hour, for the hint and the HUD. */
  label: string;
  days: number[];
  /** Minutes of the day, startMin < endMin. */
  startMin: number;
  endMin: number;
}

export interface QuestStep {
  stepId: string;
  actId: string;
  /** Story text first: what happens, what the player sees, and the stake: what it means to whoever wants it and what it costs them if it fails. */
  narrative: { description: string; playerHint: string; stake: string };
  /** Authored NPC speech and explicit player replies for a talk. Opening or dismissing it has no effect. */
  dialogue?: QuestStepDialogue;
  /** The role whose want this step serves; their dialog carries the stake while the step is active. */
  wantedByRoleId?: string;
  target: StepTarget;
  /** Items the player receives when the step completes (handed over, or information told). */
  gives: string[];
  /** Items the player must hold to act on the step. */
  needs: string[];
  /** The hour the step's text names, checked by the runtime; absent when the text names none. */
  window?: TimeWindow;
  /** Extra gates besides graph edges; all must pass for the step to be actionable. */
  conditions: Predicate[];
  /** Applied when the step completes. */
  effects: Effect[];
  /** Outgoing edges; a step with none is terminal and must name its ending. */
  next: NextEdge[];
  /** parallel: every passing edge activates. exclusive: only the first passing edge. */
  branching: 'parallel' | 'exclusive';
  endingId?: string;
}

export interface QuestStepDialogue {
  opening: string;
  choices: QuestDialogueChoice[];
}

export interface QuestDialogueChoice {
  id: string;
  /** The player's spoken response, shown on a selectable button. */
  text: string;
  /** The NPC's deterministic response; never requires a model call. */
  reply: string;
  /** False answers a question without changing state; true completes this exact talk step. */
  completesStep: boolean;
}

/** A conversation bound to one currently active step and its exact cast person. */
export interface QuestDialogue extends QuestStepDialogue {
  questlineId: string;
  stepId: string;
  roleId: string;
  npcId: string;
  availability: StepAvailability;
  characterName?: { given: string; family: string };
}

export interface NextEdge {
  toStepId: string;
  /** All predicates must pass at completion time; empty means unconditional. */
  when: Predicate[];
}

/** Pure predicates over quest flags, step history and simulation liveness/schedule. */
export type Predicate =
  | { kind: 'flagSet'; flag: string }
  | { kind: 'flagNotSet'; flag: string }
  | { kind: 'stepDone'; stepId: string }
  | { kind: 'roleAlive'; roleId: string }
  | { kind: 'roleOnDuty'; roleId: string };

export type Effect =
  | { kind: 'setFlag'; flag: string }
  | { kind: 'clearFlag'; flag: string }
  /** Story consequence pushed into the simulation (resign, promote, die, custom tag). */
  | { kind: 'simFlag'; roleId: string; op: FlagOp };

/** roleId -> instanced npcId, produced by the builder's cast resolution. */
export type ResolvedCast = Record<string, string>;
