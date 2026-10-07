/**
 * Deterministic questline state machine. All transitions are code; flags are
 * the only persisted state besides step history. The LLM never touches this.
 */

import { QuestError } from '../errors.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { AvailabilityService, type AvailabilityWindow, type StepAvailability } from './availability.js';
import { stepDialogue } from './dialogue.js';
import type { PlayerEvent } from './events.js';
import { guidanceFor, type StepGuidance } from './guidance.js';
import { StepPlaces, type QuestPlace } from './places.js';
import { PredicateEvaluator } from './predicates.js';
import type { PlaceIdentity, QuestDialogue, QuestEnding, QuestlineDefinition, QuestStep, ResolvedCast } from './schema.js';
import { heldAfter, QuestlineStateValidator, type QuestlineState } from './state.js';
import { FlowValidator } from './validate.js';

export type { QuestlineState } from './state.js';

export interface AdvanceResult {
  completedStepIds: string[];
  activatedStepIds: string[];
  endingId?: string;
}

export type DialogueChoiceResult =
  | { accepted: true; reply: string; advanceResult?: AdvanceResult }
  | { accepted: false; reason: 'stale' | 'wrong_npc' | 'unknown_choice' | 'unavailable'; availability?: StepAvailability };

export type QuestlineStatus = 'active' | 'completed' | 'stalled';

/**
 * How a quest item handed to a person goes: `deliver` completes the deliver
 * step it is for; `theirs` stays with the person whose talk needs it, and
 * that talk counts it as brought; `free` leaves the story, since no step
 * still to come uses it.
 */
export type HandHow = 'deliver' | 'theirs' | 'free';

export class QuestlineRuntime {
  private readonly steps: Map<string, QuestStep>;
  private readonly active = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly questFlags = new Set<string>();
  private endingId: string | undefined;
  /** Quest items handed to a person outside a deliver step: item id to the person who has it. */
  private readonly handed = new Map<string, string>();
  private readonly availabilityService: AvailabilityService;
  private readonly stepPlaces: StepPlaces;
  private readonly evaluator: PredicateEvaluator;

  constructor(
    readonly def: QuestlineDefinition,
    readonly cast: ResolvedCast,
    private readonly sim: SimulationPort,
  ) {
    new FlowValidator().validate(def);
    for (const role of def.roles) {
      if (cast[role.roleId] === undefined) {
        throw new QuestError('E_CAST', `${def.id}: role ${role.roleId} is not cast`);
      }
    }
    this.steps = new Map(def.steps.map((s) => [s.stepId, s]));
    this.availabilityService = new AvailabilityService(sim, cast);
    this.stepPlaces = new StepPlaces(sim, cast, def.items);
    this.evaluator = new PredicateEvaluator({
      flags: this.questFlags,
      completedSteps: this.completed,
      isRoleAlive: (roleId) => this.availabilityService.isRoleAlive(roleId),
      isRoleOnDuty: (roleId, timeMin) => this.availabilityService.isRoleOnDuty(roleId, timeMin),
    });
    for (const id of def.entryStepIds) this.active.add(id);
  }

  static restore(def: QuestlineDefinition, cast: ResolvedCast, sim: SimulationPort, state: unknown): QuestlineRuntime {
    const runtime = new QuestlineRuntime(def, cast, sim);
    const validator: QuestlineStateValidator = new QuestlineStateValidator();
    validator.validate(def, state);
    runtime.active.clear();
    for (const id of state.activeStepIds) runtime.requireStep(id) && runtime.active.add(id);
    for (const id of state.completedStepIds) runtime.requireStep(id) && runtime.completed.add(id);
    for (const flag of state.flags) runtime.questFlags.add(flag);
    runtime.endingId = state.endingId;
    for (const entry of state.handed ?? []) runtime.handed.set(entry.itemId, entry.npcId);
    return runtime;
  }

  serialize(): QuestlineState {
    const handed = [...this.handed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([itemId, npcId]) => ({ itemId, npcId }));
    return {
      activeStepIds: [...this.active],
      completedStepIds: [...this.completed],
      flags: [...this.questFlags],
      ...(this.endingId !== undefined ? { endingId: this.endingId } : {}),
      // Only once something was handed, so a state without it stays as it was.
      ...(handed.length > 0 ? { handed } : {}),
    };
  }

  status(): QuestlineStatus {
    if (this.endingId !== undefined) return 'completed';
    const activeSteps = [...this.active].map((id) => this.step(id));
    const allBlocked =
      activeSteps.length > 0 &&
      activeSteps.every((s) => {
        const roleId = this.targetRole(s);
        return roleId !== undefined && !this.availabilityService.isRoleAlive(roleId);
      });
    return allBlocked ? 'stalled' : 'active';
  }

  ending(): QuestEnding | undefined {
    return this.def.endings.find((e) => e.endingId === this.endingId);
  }

  activeSteps(): QuestStep[] {
    return [...this.active].map((id) => this.step(id));
  }

  flags(): ReadonlySet<string> {
    return this.questFlags;
  }

  /** Items held now, derived from completed steps in order: taken or given, minus delivered, minus handed to a person. */
  inventory(): Set<string> {
    const held = heldAfter(this.steps, this.completed);
    for (const itemId of this.handed.keys()) held.delete(itemId);
    return held;
  }

  /** The quest items handed to a person outside a deliver step, by item id, with who has each. */
  handedItems(): ReadonlyMap<string, string> {
    return this.handed;
  }

  /**
   * How a held item would go if the player handed it to `npcId`, or undefined
   * when it cannot: `deliver` when an active deliver step is for it and either
   * `place` is the step's place or the step is wanted by that person; else
   * `theirs` when an active talk with that person needs it; else `free` when
   * no step still to come needs it, delivers it, carries it as cargo or uses
   * it as a credential. With `timeMin`, a deliver step its gates refuse at that
   * minute makes it undefined.
   */
  handable(itemId: string, npcId: string, place?: Partial<PlaceIdentity>, timeMin?: number): HandHow | undefined {
    return this.handing(itemId, npcId, place, timeMin)?.how;
  }

  /**
   * The player hands a held item to `npcId`, standing at `place` when the host
   * knows it: a deliver step completes as if delivered at its own place;
   * `theirs` and `free` record who has it, completing nothing. Throws
   * E_UNAVAILABLE when the item cannot go to that person (`handable`), and
   * whatever `advance` throws for a deliver its gates refuse.
   */
  hand(itemId: string, npcId: string, place: Partial<PlaceIdentity> | undefined, timeMin: number): AdvanceResult & { how: HandHow } {
    const handing = this.handing(itemId, npcId, place);
    if (handing === undefined) throw new QuestError('E_UNAVAILABLE', `${this.def.id}: ${itemId} cannot be handed to ${npcId}`);
    if (handing.how === 'deliver') {
      const target = handing.step!.target as Extract<QuestStep['target'], { kind: 'deliver' }>;
      return { ...this.advance({ kind: 'delivered', itemId, ...identityOf(target.place) }, timeMin), how: 'deliver' };
    }
    this.handed.set(itemId, npcId);
    return { completedStepIds: [], activatedStepIds: [], how: handing.how };
  }

  private handing(itemId: string, npcId: string, given?: Partial<PlaceIdentity>, timeMin?: number): { how: HandHow; step?: QuestStep } | undefined {
    if (!this.inventory().has(itemId)) return undefined;
    const place = placeOf(given);
    const active = this.activeSteps();
    const delivers = active.filter((step) => step.target.kind === 'deliver' && step.target.itemId === itemId);
    const deliver = delivers.find((step) => {
      const target = step.target as Extract<QuestStep['target'], { kind: 'deliver' }>;
      const there = place !== undefined && samePlace(place, target.place);
      const wanted = step.wantedByRoleId !== undefined && this.cast[step.wantedByRoleId] === npcId;
      return there || wanted;
    });
    if (deliver) {
      if (timeMin !== undefined && !this.advanceGate(deliver, timeMin).available) return undefined;
      return { how: 'deliver', step: deliver };
    }
    const theirs = active.find((step) => step.target.kind === 'talk' && this.cast[step.target.roleId] === npcId && step.needs.includes(itemId));
    if (theirs) return { how: 'theirs', step: theirs };
    if (this.ahead().some((step) => usesItem(step, itemId))) return undefined;
    return { how: 'free' };
  }

  /** The steps still to come: the active ones and every step their edges can reach. */
  private ahead(): QuestStep[] {
    const seen = new Set<string>();
    const queue = [...this.active];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id) || this.completed.has(id)) continue;
      seen.add(id);
      for (const edge of this.step(id).next) queue.push(edge.toStepId);
    }
    return [...seen].map((id) => this.step(id));
  }

  /** Can the player act on this step right now (liveness, schedule, items, conditions)? */
  stepAvailability(stepId: string, timeMin: number): StepAvailability {
    const step = this.step(stepId);
    if (!this.active.has(stepId)) return { available: false, reason: 'condition' };
    const target = this.availabilityService.targetAvailability(step, timeMin);
    if (!target.available) return target;
    return this.stateGate(step, timeMin);
  }

  /**
   * May a live host arrange this authored talk/listen appointment? This is
   * not permission to advance: the host must first place the exact living
   * cast, then report its physical presence through its SimulationPort.
   * Authored hours, inventory and predicates still gate the appointment.
   */
  stepPlacementAvailability(stepId: string, timeMin: number): StepAvailability {
    const step = this.step(stepId);
    if (!this.active.has(stepId)) return { available: false, reason: 'condition' };
    const target = step.target;
    if (target.kind !== 'listen' && !(target.kind === 'talk' && target.atParcelId !== undefined)) {
      return this.stepAvailability(stepId, timeMin);
    }
    const roleIds = target.kind === 'listen' ? target.roleIds : [target.roleId];
    if (roleIds.some((roleId) => !this.availabilityService.isRoleAlive(roleId))) {
      return { available: false, reason: 'role_dead' };
    }
    return this.stateGate(step, timeMin);
  }

  /** Weekly windows for a step: the hour its text names, narrowed by its target's routine. */
  windows(stepId: string): AvailabilityWindow[] | undefined {
    return this.availabilityService.windows(this.step(stepId));
  }

  /** Where the step points at that minute, for a marker on the map; undefined when there is nothing to mark. */
  stepPlace(stepId: string, timeMin: number): QuestPlace | undefined {
    return this.stepPlaces.place(this.step(stepId), timeMin);
  }

  /** Objective place projected to the route box's parcel, station, or stop destination. */
  stepGuidance(stepId: string, timeMin: number): StepGuidance {
    this.step(stepId);
    return guidanceFor(this.def.id, stepId, this.stepPlace(stepId, timeMin));
  }

  /** Read only. Opening, reopening and closing a dialogue never completes a step. */
  dialogueFor(stepId: string, npcId: string, timeMin: number): QuestDialogue | undefined {
    if (!this.active.has(stepId) || this.endingId !== undefined) return undefined;
    const step = this.step(stepId);
    if (step.target.kind !== 'talk' || this.cast[step.target.roleId] !== npcId) return undefined;
    const roleId = step.target.roleId;
    const role = this.def.roles.find((entry) => entry.roleId === roleId)!;
    const dialogue = stepDialogue(this.def, step);
    return {
      questlineId: this.def.id, stepId, roleId: role.roleId, npcId,
      availability: this.stepAvailability(stepId, timeMin),
      ...(role.characterName !== undefined ? { characterName: { ...role.characterName } } : {}),
      opening: dialogue.opening,
      choices: dialogue.choices.map((choice) => ({ ...choice })),
    };
  }

  /** Select a declared reply for this exact cast person and step, rechecking all runtime gates. */
  chooseDialogue(stepId: string, npcId: string, choiceId: string, timeMin: number): DialogueChoiceResult {
    if (!this.active.has(stepId) || this.endingId !== undefined) return { accepted: false, reason: 'stale' };
    const step = this.step(stepId);
    if (step.target.kind !== 'talk') return { accepted: false, reason: 'stale' };
    if (this.cast[step.target.roleId] !== npcId) return { accepted: false, reason: 'wrong_npc' };
    const dialogue = this.dialogueFor(stepId, npcId, timeMin)!;
    const choice = dialogue.choices.find((entry) => entry.id === choiceId);
    if (choice === undefined) return { accepted: false, reason: 'unknown_choice' };
    const gate = this.advanceGate(step, timeMin);
    if (!gate.available) return { accepted: false, reason: 'unavailable', availability: gate };
    if (!choice.completesStep) return { accepted: true, reply: choice.reply };
    const advanceResult: AdvanceResult = { completedStepIds: [], activatedStepIds: [] };
    this.complete(step, timeMin, advanceResult);
    if (this.endingId !== undefined) advanceResult.endingId = this.endingId;
    return { accepted: true, reply: choice.reply, advanceResult };
  }

  advance(event: PlayerEvent, timeMin: number): AdvanceResult {
    if (event.kind === 'handedTo') return this.hand(event.itemId, event.npcId, placeOf(event), timeMin);
    if (this.endingId !== undefined) {
      throw new QuestError('E_WRONG_STATE', `${this.def.id}: questline already ended`);
    }
    const matching = [...this.active].map((id) => this.step(id)).filter((s) => this.matches(s, event));
    if (matching.length === 0) {
      throw new QuestError('E_WRONG_STATE', `${this.def.id}: no active step matches event ${event.kind}`);
    }

    const result: AdvanceResult = { completedStepIds: [], activatedStepIds: [] };
    let anyAvailable = false;
    let firstBlock: StepAvailability | undefined;
    for (const step of matching) {
      const gate = this.advanceGate(step, timeMin);
      if (!gate.available) {
        firstBlock = firstBlock ?? gate;
        continue;
      }
      anyAvailable = true;
      this.complete(step, timeMin, result);
      if (this.endingId !== undefined) break;
    }
    if (!anyAvailable) {
      throw new QuestError('E_UNAVAILABLE', `${this.def.id}: step not available (${firstBlock?.reason ?? 'condition'})`);
    }
    if (result.completedStepIds.length > 0 && this.endingId !== undefined) {
      result.endingId = this.endingId;
    }
    return result;
  }

  /**
   * Advance-time gate. Talk, listen and steal enforce presence (the schedule
   * gate); a kill event is its own proof, and the runtime records the death.
   */
  private advanceGate(step: QuestStep, timeMin: number): StepAvailability {
    const state = this.stateGate(step, timeMin);
    if (!state.available) return state;
    if (
      step.target.kind === 'talk' ||
      step.target.kind === 'listen' ||
      step.target.kind === 'steal' ||
      step.target.kind === 'rescue' ||
      step.target.kind === 'escort' ||
      step.target.kind === 'transportation'
    ) {
      return this.availabilityService.targetAvailability(step, timeMin);
    }
    return { available: true };
  }

  /**
   * Quest-state gate: the hour the step names, required items held (or, for
   * a talk, handed to the person it is with), extra conditions passing.
   */
  private stateGate(step: QuestStep, timeMin: number): StepAvailability {
    if (!this.availabilityService.withinStepWindow(step, timeMin)) return { available: false, reason: 'outside_window' };
    const held = this.inventory();
    const target = step.target;
    const brought = (itemId: string) => target.kind === 'talk' && this.handed.get(itemId) === this.cast[target.roleId];
    if (!step.needs.every((itemId) => held.has(itemId) || brought(itemId))) return { available: false, reason: 'missing_item' };
    if (!this.evaluator.all(step.conditions, timeMin)) return { available: false, reason: 'condition' };
    return { available: true };
  }

  private complete(step: QuestStep, timeMin: number, result: AdvanceResult): void {
    this.active.delete(step.stepId);
    this.completed.add(step.stepId);
    result.completedStepIds.push(step.stepId);

    if (step.target.kind === 'assassinate') {
      const npcId = this.cast[step.target.roleId]!;
      if (!this.sim.getNPC(npcId).flags.dead) this.sim.applyFlag(npcId, { kind: 'die' });
    }

    for (const effect of step.effects) {
      switch (effect.kind) {
        case 'setFlag':
          this.questFlags.add(effect.flag);
          break;
        case 'clearFlag':
          this.questFlags.delete(effect.flag);
          break;
        case 'simFlag':
          this.sim.applyFlag(this.cast[effect.roleId]!, effect.op);
          break;
      }
    }

    // A delivered item has left the player's hands by its own step; one a step hands back is theirs again.
    if (step.target.kind === 'deliver' || step.target.kind === 'pickup' || step.target.kind === 'steal') this.handed.delete(step.target.itemId);
    for (const itemId of step.gives) this.handed.delete(itemId);

    if (step.next.length === 0) {
      this.endingId = step.endingId;
      this.active.clear();
      return;
    }
    for (const edge of step.next) {
      if (!this.evaluator.all(edge.when, timeMin)) continue;
      if (!this.completed.has(edge.toStepId) && !this.active.has(edge.toStepId)) {
        this.active.add(edge.toStepId);
        result.activatedStepIds.push(edge.toStepId);
      }
      if (step.branching === 'exclusive') break;
    }
  }

  private matches(step: QuestStep, event: PlayerEvent): boolean {
    const t = step.target;
    switch (t.kind) {
      case 'talk':
        // Authored talks must be committed through chooseDialogue, never by opening/closing a chat.
        return step.dialogue === undefined && event.kind === 'talkedTo' && event.npcId === this.cast[t.roleId];
      case 'listen':
        return event.kind === 'overheard' && t.roleIds.every((r) => event.npcIds.includes(this.cast[r]!));
      case 'goto':
        return event.kind === 'arrivedAt' && samePlace(event, t.place);
      case 'observe':
        return event.kind === 'observed' && event.districtId === t.districtId;
      case 'pickup':
        return event.kind === 'pickedUp' && event.itemId === t.itemId;
      case 'deliver':
        return (
          event.kind === 'delivered' &&
          event.itemId === t.itemId &&
          samePlace(event, t.place)
        );
      case 'steal':
        return event.kind === 'stole' && event.itemId === t.itemId;
      case 'assassinate':
        return event.kind === 'killed' && event.npcId === this.cast[t.roleId];
      case 'work':
        return event.kind === 'workedShift' && event.parcelId === t.atParcelId;
      case 'investigation':
        return (
          event.kind === 'investigated' &&
          event.sceneId === t.sceneId &&
          event.evidenceId === t.evidenceId &&
          samePlace(event.place, t.place)
        );
      case 'rescue':
        return (
          event.kind === 'released' &&
          event.npcId === this.cast[t.roleId] &&
          event.releaseTargetId === t.releaseTargetId &&
          samePlace(event.place, t.place)
        );
      case 'escort':
        return (
          event.kind === 'escorted' &&
          event.npcId === this.cast[t.roleId] &&
          event.routeId === t.routeId &&
          event.mode === t.mode &&
          samePlace(event.from, t.from) &&
          samePlace(event.to, t.to)
        );
      case 'access':
        return (
          event.kind === 'accessed' &&
          event.accessPointId === t.accessPointId &&
          event.credentialItemId === t.credentialItemId &&
          samePlace(event.place, t.place)
        );
      case 'hacking':
        return event.kind === 'hacked' && event.targetId === t.targetId && samePlace(event.place, t.place);
      case 'sabotage':
        return event.kind === 'sabotaged' && event.targetId === t.targetId && samePlace(event.place, t.place);
      case 'transportation':
        return (
          event.kind === 'transported' &&
          event.journeyId === t.journeyId &&
          event.mode === t.mode &&
          samePlace(event.from, t.from) &&
          samePlace(event.to, t.to) &&
          sameMembers(event.passengerNpcIds, t.passengerRoleIds.map((roleId) => this.cast[roleId]!)) &&
          sameMembers(event.cargoItemIds, t.cargoItemIds)
        );
    }
  }

  private targetRole(step: QuestStep): string | undefined {
    const t = step.target;
    if (t.kind === 'talk' || t.kind === 'assassinate' || t.kind === 'rescue' || t.kind === 'escort') return t.roleId;
    if (t.kind === 'steal') return t.fromRoleId;
    if (t.kind === 'listen') return t.roleIds.find((r) => !this.availabilityService.isRoleAlive(r)) ?? t.roleIds[0];
    if (t.kind === 'transportation') {
      return t.passengerRoleIds.find((r) => !this.availabilityService.isRoleAlive(r)) ?? t.passengerRoleIds[0];
    }
    return undefined;
  }

  private step(stepId: string): QuestStep {
    const step = this.steps.get(stepId);
    if (!step) throw new QuestError('E_UNKNOWN_ID', `${this.def.id}: unknown step ${stepId}`);
    return step;
  }

  private requireStep(stepId: string): boolean {
    this.step(stepId);
    return true;
  }
}

/** Whether a step still to come needs the item, delivers it, carries it as cargo or uses it as a credential. */
function usesItem(step: QuestStep, itemId: string): boolean {
  const t = step.target;
  return step.needs.includes(itemId) ||
    (t.kind === 'deliver' && t.itemId === itemId) ||
    (t.kind === 'transportation' && t.cargoItemIds.includes(itemId)) ||
    (t.kind === 'access' && t.credentialItemId === itemId);
}

/** The world identity of an authored place, without its name. */
function identityOf(place: import('./schema.js').PlaceTarget): PlaceIdentity {
  if ('parcelId' in place) return { parcelId: place.parcelId };
  if ('districtId' in place) return { districtId: place.districtId };
  if ('stationId' in place) return { stationId: place.stationId };
  return { stopId: place.stopId };
}

/** The one place identity a partial place names, or undefined when it names none. */
function placeOf(place: Partial<Record<'parcelId' | 'districtId' | 'stationId' | 'stopId', string>> | undefined): PlaceIdentity | undefined {
  if (typeof place?.parcelId === 'string') return { parcelId: place.parcelId };
  if (typeof place?.districtId === 'string') return { districtId: place.districtId };
  if (typeof place?.stationId === 'string') return { stationId: place.stationId };
  if (typeof place?.stopId === 'string') return { stopId: place.stopId };
  return undefined;
}

function samePlace(left: import('./schema.js').PlaceIdentity, right: import('./schema.js').PlaceIdentity): boolean {
  if ('parcelId' in left) return 'parcelId' in right && left.parcelId === right.parcelId;
  if ('districtId' in left) return 'districtId' in right && left.districtId === right.districtId;
  if ('stationId' in left) return 'stationId' in right && left.stationId === right.stationId;
  return 'stopId' in right && left.stopId === right.stopId;
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
