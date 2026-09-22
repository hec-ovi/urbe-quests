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
import type { QuestDialogue, QuestEnding, QuestlineDefinition, QuestStep, ResolvedCast } from './schema.js';
import { QuestlineStateValidator, type QuestlineState } from './state.js';
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

export class QuestlineRuntime {
  private readonly steps: Map<string, QuestStep>;
  private readonly active = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly questFlags = new Set<string>();
  private endingId: string | undefined;
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
    return runtime;
  }

  serialize(): QuestlineState {
    return {
      activeStepIds: [...this.active],
      completedStepIds: [...this.completed],
      flags: [...this.questFlags],
      ...(this.endingId !== undefined ? { endingId: this.endingId } : {}),
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

  /** Items held now, derived from completed steps in order: taken or given, minus delivered. */
  inventory(): Set<string> {
    const held = new Set<string>();
    for (const id of this.completed) {
      const step = this.step(id);
      const t = step.target;
      if (t.kind === 'pickup' || t.kind === 'steal') held.add(t.itemId);
      for (const itemId of step.gives) held.add(itemId);
      if (t.kind === 'deliver') held.delete(t.itemId);
    }
    return held;
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

  /** Quest-state gate: the hour the step names, required items held, extra conditions passing. */
  private stateGate(step: QuestStep, timeMin: number): StepAvailability {
    if (!this.availabilityService.withinStepWindow(step, timeMin)) return { available: false, reason: 'outside_window' };
    const held = this.inventory();
    if (!step.needs.every((itemId) => held.has(itemId))) return { available: false, reason: 'missing_item' };
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
