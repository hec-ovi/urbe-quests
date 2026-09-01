/**
 * Questline definition: a condition-gated DAG of typed steps grouped in acts,
 * with branches and multiple endings. Narrative fields come before structural
 * ones on purpose: builder output mirrors this order so the model commits to
 * story before structure. No LLM ever reads or writes runtime state.
 */

import type { FlagOp } from '../world/types/simulation.js';

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
  /** Fixed identity for pre-instanced story NPCs (reserveNPC); otherwise the vendor query resolves whoever is on duty. */
  reservedName?: { given: string; family: string };
}

export interface QuestItem {
  itemId: string;
  name: string;
  description: string;
  /** Where the item sits on the 2D plane, when it starts placed. */
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
  | { kind: 'work'; atParcelId: string; role: string };

export type PlaceTarget = { parcelId: string } | { districtId: string };

export interface QuestStep {
  stepId: string;
  actId: string;
  /** Story text first: what happens and why it matters. */
  narrative: { description: string; playerHint: string };
  target: StepTarget;
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
