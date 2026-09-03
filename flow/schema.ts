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

/** Stable world identity accepted by authored objectives. */
export type PlaceTarget =
  | { parcelId: string }
  | { districtId: string }
  | { stationId: string }
  | { stopId: string };

export interface QuestStep {
  stepId: string;
  actId: string;
  /** Story text first: what happens, what the player sees, and the stake: what it means to whoever wants it and what it costs them if it fails. */
  narrative: { description: string; playerHint: string; stake: string };
  /** The role whose want this step serves; their dialog carries the stake while the step is active. */
  wantedByRoleId?: string;
  target: StepTarget;
  /** Items the player receives when the step completes (handed over, or information told). */
  gives: string[];
  /** Items the player must hold to act on the step. */
  needs: string[];
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
