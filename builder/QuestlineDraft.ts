/**
 * Mutable questline draft behind the agent-facing tools: create, then step by
 * step, then finish. Reference errors are reported as messages (fed back to
 * the agent), full structural validation runs on finish.
 */

import { FlowValidator } from '../flow/validate.js';
import type {
  QuestAct,
  QuestEnding,
  QuestFact,
  QuestItem,
  QuestlineDefinition,
  QuestRole,
  QuestStep,
} from '../flow/schema.js';

/** A safety net well above the plan's budget (6 to 16 steps), so a fix after validation is never refused. */
export const MAX_STEPS = 40;

export class DraftError extends Error {}

export class QuestlineDraft {
  private def: QuestlineDefinition | undefined;

  create(args: { id: string; title: string; premise: string }): string {
    if (this.def !== undefined) throw new DraftError('questline already created');
    this.def = {
      id: args.id,
      title: args.title,
      premise: args.premise,
      roles: [],
      items: [],
      facts: [],
      acts: [],
      steps: [],
      endings: [],
      flags: [],
      entryStepIds: [],
    };
    return `questline ${args.id} created`;
  }

  addRole(role: QuestRole): string {
    const def = this.current();
    this.rejectDuplicate(def.roles.map((r) => r.roleId), role.roleId, 'role');
    def.roles.push(role);
    return `role ${role.roleId} added`;
  }

  addItem(item: QuestItem): string {
    const def = this.current();
    this.rejectDuplicate(def.items.map((i) => i.itemId), item.itemId, 'item');
    def.items.push(item);
    return `item ${item.itemId} added`;
  }

  addFact(fact: QuestFact): string {
    const def = this.current();
    this.rejectDuplicate(def.facts.map((f) => f.factId), fact.factId, 'fact');
    if (!def.roles.some((r) => r.roleId === fact.roleId)) throw new DraftError(`unknown role ${fact.roleId}`);
    if (fact.gateFlag !== undefined) this.declareFlag(fact.gateFlag);
    def.facts.push(fact);
    return `fact ${fact.factId} added`;
  }

  addAct(act: QuestAct): string {
    const def = this.current();
    this.rejectDuplicate(def.acts.map((a) => a.actId), act.actId, 'act');
    def.acts.push(act);
    return `act ${act.actId} added`;
  }

  addEnding(ending: QuestEnding): string {
    const def = this.current();
    this.rejectDuplicate(def.endings.map((e) => e.endingId), ending.endingId, 'ending');
    def.endings.push(ending);
    return `ending ${ending.endingId} added`;
  }

  addStep(step: QuestStep & { entry?: boolean }): string {
    const def = this.current();
    if (def.steps.length >= MAX_STEPS) {
      throw new DraftError(`the questline already carries ${MAX_STEPS} steps, the most it may; fold this beat into an existing step and call finish_questline`);
    }
    this.rejectDuplicate(def.steps.map((s) => s.stepId), step.stepId, 'step');
    const { entry, ...rest } = step;
    for (const p of [...rest.conditions, ...rest.next.flatMap((e) => e.when)]) {
      if (p.kind === 'flagSet' || p.kind === 'flagNotSet') this.declareFlag(p.flag);
    }
    for (const effect of rest.effects) {
      if (effect.kind === 'setFlag' || effect.kind === 'clearFlag') this.declareFlag(effect.flag);
    }
    def.steps.push(rest);
    if (entry === true) def.entryStepIds.push(rest.stepId);
    return `step ${rest.stepId} added${entry === true ? ' (entry)' : ''}`;
  }

  /** Full structural validation; throws with the validator's message on failure. */
  finish(): QuestlineDefinition {
    const def = this.current();
    try {
      new FlowValidator().validate(def);
    } catch (error) {
      throw new DraftError(error instanceof Error ? error.message : String(error));
    }
    return def;
  }

  private current(): QuestlineDefinition {
    if (this.def === undefined) throw new DraftError('create the questline first');
    return this.def;
  }

  private declareFlag(flag: string): void {
    const def = this.current();
    if (!def.flags.includes(flag)) def.flags.push(flag);
  }

  private rejectDuplicate(ids: string[], id: string, kind: string): void {
    if (ids.includes(id)) throw new DraftError(`duplicate ${kind} id ${id}`);
  }
}
