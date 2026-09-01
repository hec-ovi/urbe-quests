/**
 * Deterministic questline state machine. All transitions are code; flags are
 * the only persisted state besides step history. The LLM never touches this.
 */

import { QuestError } from '../errors.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { AvailabilityService, type AvailabilityWindow, type StepAvailability } from './availability.js';
import type { PlayerEvent } from './events.js';
import { PredicateEvaluator } from './predicates.js';
import type { QuestEnding, QuestlineDefinition, QuestStep, ResolvedCast } from './schema.js';
import { FlowValidator } from './validate.js';

export interface QuestlineState {
  activeStepIds: string[];
  completedStepIds: string[];
  flags: string[];
  endingId?: string;
}

export interface AdvanceResult {
  completedStepIds: string[];
  activatedStepIds: string[];
  endingId?: string;
}

export type QuestlineStatus = 'active' | 'completed' | 'stalled';

export class QuestlineRuntime {
  private readonly steps: Map<string, QuestStep>;
  private readonly active = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly questFlags = new Set<string>();
  private endingId: string | undefined;
  private readonly availabilityService: AvailabilityService;
  private readonly evaluator: PredicateEvaluator;

  constructor(
    readonly def: QuestlineDefinition,
    private readonly cast: ResolvedCast,
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
    this.evaluator = new PredicateEvaluator({
      flags: this.questFlags,
      completedSteps: this.completed,
      isRoleAlive: (roleId) => this.availabilityService.isRoleAlive(roleId),
      isRoleOnDuty: (roleId, timeMin) => this.availabilityService.isRoleOnDuty(roleId, timeMin),
    });
    for (const id of def.entryStepIds) this.active.add(id);
  }

  static restore(def: QuestlineDefinition, cast: ResolvedCast, sim: SimulationPort, state: QuestlineState): QuestlineRuntime {
    const runtime = new QuestlineRuntime(def, cast, sim);
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

  /** Can the player act on this step right now (liveness, schedule, conditions)? */
  stepAvailability(stepId: string, timeMin: number): StepAvailability {
    const step = this.step(stepId);
    if (!this.active.has(stepId)) return { available: false, reason: 'condition' };
    const target = this.availabilityService.targetAvailability(step, timeMin);
    if (!target.available) return target;
    if (!this.evaluator.all(step.conditions, timeMin)) return { available: false, reason: 'condition' };
    return { available: true };
  }

  /** Weekly windows for schedule-bound steps, derived from routines on demand. */
  windows(stepId: string): AvailabilityWindow[] | undefined {
    return this.availabilityService.windows(this.step(stepId));
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
   * Advance-time gate. Talk and listen enforce presence (the schedule gate);
   * a kill event is its own proof, and the runtime records the death.
   */
  private advanceGate(step: QuestStep, timeMin: number): StepAvailability {
    if (!this.evaluator.all(step.conditions, timeMin)) return { available: false, reason: 'condition' };
    if (step.target.kind === 'talk' || step.target.kind === 'listen' || step.target.kind === 'steal') {
      return this.availabilityService.targetAvailability(step, timeMin);
    }
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
        return event.kind === 'talkedTo' && event.npcId === this.cast[t.roleId];
      case 'listen':
        return event.kind === 'overheard' && t.roleIds.every((r) => event.npcIds.includes(this.cast[r]!));
      case 'goto':
        return (
          event.kind === 'arrivedAt' &&
          (('parcelId' in t.place && t.place.parcelId === event.parcelId) ||
            ('districtId' in t.place && t.place.districtId === event.districtId))
        );
      case 'observe':
        return event.kind === 'observed' && event.districtId === t.districtId;
      case 'pickup':
        return event.kind === 'pickedUp' && event.itemId === t.itemId;
      case 'deliver':
        return (
          event.kind === 'delivered' &&
          event.itemId === t.itemId &&
          (('parcelId' in t.place && t.place.parcelId === event.parcelId) ||
            ('districtId' in t.place && t.place.districtId === event.districtId))
        );
      case 'steal':
        return event.kind === 'stole' && event.itemId === t.itemId;
      case 'assassinate':
        return event.kind === 'killed' && event.npcId === this.cast[t.roleId];
      case 'work':
        return event.kind === 'workedShift' && event.parcelId === t.atParcelId;
    }
  }

  private targetRole(step: QuestStep): string | undefined {
    const t = step.target;
    if (t.kind === 'talk' || t.kind === 'assassinate') return t.roleId;
    if (t.kind === 'steal') return t.fromRoleId;
    if (t.kind === 'listen') return t.roleIds.find((r) => !this.availabilityService.isRoleAlive(r)) ?? t.roleIds[0];
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
