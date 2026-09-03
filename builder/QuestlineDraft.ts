/**
 * Mutable questline draft behind the agent-facing tools, bounded by the
 * plan's manifest: only planned ids are accepted, every reference is checked
 * against the manifest the moment it is made, and finish reports what is
 * still missing before it validates. Problems come back as messages the
 * agent corrects; nothing here aborts the loop.
 */

import { FlowValidator } from '../flow/validate.js';
import type {
  Predicate,
  QuestAct,
  QuestEnding,
  QuestFact,
  QuestItem,
  QuestlineDefinition,
  QuestRole,
  QuestStep,
} from '../flow/schema.js';
import { MANIFEST_KINDS, manifestSize, type ManifestKind, type PlanManifest } from './PlanManifest.js';

export class DraftError extends Error {}

const SINGULAR: Record<ManifestKind, string> = { roles: 'role', items: 'item', acts: 'act', endings: 'ending', steps: 'step' };

export class QuestlineDraft {
  private def: QuestlineDefinition | undefined;

  constructor(private readonly manifest: PlanManifest) {}

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
    return `questline ${args.id} created; ${this.status()}`;
  }

  addRole(role: QuestRole): string {
    const def = this.current();
    this.accept('roles', role.roleId, def.roles.map((r) => r.roleId));
    def.roles.push(role);
    return `role ${role.roleId} added; ${this.status()}`;
  }

  addItem(item: QuestItem): string {
    const def = this.current();
    this.accept('items', item.itemId, def.items.map((i) => i.itemId));
    def.items.push(item);
    return `item ${item.itemId} added; ${this.status()}`;
  }

  addFact(fact: QuestFact): string {
    const def = this.current();
    if (def.facts.some((f) => f.factId === fact.factId)) throw new DraftError(`duplicate fact id ${fact.factId}`);
    const problems: string[] = [];
    this.reference('roles', fact.roleId, problems);
    if (problems.length > 0) throw new DraftError(`fact ${fact.factId}: ${problems.join('; ')}`);
    if (fact.gateFlag !== undefined) this.declareFlag(fact.gateFlag);
    def.facts.push(fact);
    return `fact ${fact.factId} added`;
  }

  addAct(act: QuestAct): string {
    const def = this.current();
    this.accept('acts', act.actId, def.acts.map((a) => a.actId));
    def.acts.push(act);
    return `act ${act.actId} added; ${this.status()}`;
  }

  addEnding(ending: QuestEnding): string {
    const def = this.current();
    this.accept('endings', ending.endingId, def.endings.map((e) => e.endingId));
    def.endings.push(ending);
    return `ending ${ending.endingId} added; ${this.status()}`;
  }

  addStep(step: QuestStep & { entry?: boolean }): string {
    const def = this.current();
    this.accept('steps', step.stepId, def.steps.map((s) => s.stepId));
    const { entry, ...rest } = step;
    const problems = this.stepProblems(rest);
    if (problems.length > 0) throw new DraftError(`step ${rest.stepId} not added: ${problems.join('; ')}`);
    for (const p of [...rest.conditions, ...rest.next.flatMap((e) => e.when)]) {
      if (p.kind === 'flagSet' || p.kind === 'flagNotSet') this.declareFlag(p.flag);
    }
    for (const effect of rest.effects) {
      if (effect.kind === 'setFlag' || effect.kind === 'clearFlag') this.declareFlag(effect.flag);
    }
    def.steps.push(rest);
    if (entry === true) def.entryStepIds.push(rest.stepId);
    return `step ${rest.stepId} added${entry === true ? ' (entry)' : ''}; ${this.status()}`;
  }

  /** Planned pieces not yet added, by kind. */
  missing(): PlanManifest {
    const def = this.def;
    const added: Record<ManifestKind, string[]> = {
      roles: def?.roles.map((r) => r.roleId) ?? [],
      items: def?.items.map((i) => i.itemId) ?? [],
      acts: def?.acts.map((a) => a.actId) ?? [],
      endings: def?.endings.map((e) => e.endingId) ?? [],
      steps: def?.steps.map((s) => s.stepId) ?? [],
    };
    const missing = {} as PlanManifest;
    for (const kind of MANIFEST_KINDS) missing[kind] = this.manifest[kind].filter((id) => !added[kind].includes(id));
    return missing;
  }

  /** Planned pieces added so far against the plan's total. */
  progress(): { committed: number; planned: number } {
    const planned = manifestSize(this.manifest);
    return { committed: planned - manifestSize(this.missing()), planned };
  }

  /** What is still to add, as a line for the agent; undefined when the plan is fully in. */
  missingLine(): string | undefined {
    const parts = MANIFEST_KINDS.filter((kind) => this.missing()[kind].length > 0).map(
      (kind) => `${kind}: ${this.missing()[kind].join(', ')}`,
    );
    return parts.length === 0 ? undefined : `still to add from the plan: ${parts.join('; ')}`;
  }

  /** Missing pieces first, then full structural validation; throws with every problem on failure. */
  finish(): QuestlineDefinition {
    const def = this.current();
    const missing = this.missingLine();
    if (missing !== undefined) throw new DraftError(`not finished; ${missing}; then call finish_questline again`);
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

  private status(): string {
    const { committed, planned } = this.progress();
    return `${committed} of ${planned} planned pieces in`;
  }

  /** An id may enter only when the plan lists it and it is not in yet. */
  private accept(kind: ManifestKind, id: string, present: string[]): void {
    if (present.includes(id)) throw new DraftError(`duplicate ${SINGULAR[kind]} id ${id}`);
    if (!this.manifest[kind].includes(id)) throw new DraftError(`${SINGULAR[kind]} ${id} is not in the plan; ${this.plannedLine(kind)}`);
  }

  /** A reference must point at a planned id; the piece itself may still be on its way. */
  private reference(kind: ManifestKind, id: string, problems: string[]): void {
    if (!this.manifest[kind].includes(id)) problems.push(`unknown ${SINGULAR[kind]} ${id} (${this.plannedLine(kind)})`);
  }

  private plannedLine(kind: ManifestKind): string {
    const missing = this.missing()[kind];
    const planned = `planned ${kind}: ${this.manifest[kind].join(', ') || 'none'}`;
    return missing.length > 0 ? `${planned}; not yet added: ${missing.join(', ')}` : planned;
  }

  private stepProblems(step: QuestStep): string[] {
    const problems: string[] = [];
    this.reference('acts', step.actId, problems);
    if (step.wantedByRoleId !== undefined) this.reference('roles', step.wantedByRoleId, problems);
    const t = step.target;
    if (t.kind === 'talk' || t.kind === 'assassinate') this.reference('roles', t.roleId, problems);
    if (t.kind === 'listen') t.roleIds.forEach((r) => this.reference('roles', r, problems));
    if (t.kind === 'pickup' || t.kind === 'deliver' || t.kind === 'steal') this.reference('items', t.itemId, problems);
    if (t.kind === 'steal') this.reference('roles', t.fromRoleId, problems);
    if (t.kind === 'investigation') {
      this.reference('items', t.evidenceItemId, problems);
      t.subjectRoleIds.forEach((roleId) => this.reference('roles', roleId, problems));
    }
    if (t.kind === 'rescue' || t.kind === 'escort') this.reference('roles', t.roleId, problems);
    if (t.kind === 'access') this.reference('items', t.credentialItemId, problems);
    if (t.kind === 'transportation') {
      t.passengerRoleIds.forEach((roleId) => this.reference('roles', roleId, problems));
      t.cargoItemIds.forEach((itemId) => this.reference('items', itemId, problems));
    }
    for (const itemId of [...step.gives, ...step.needs]) this.reference('items', itemId, problems);
    for (const edge of step.next) this.reference('steps', edge.toStepId, problems);
    if (step.endingId !== undefined) this.reference('endings', step.endingId, problems);
    for (const p of [...step.conditions, ...step.next.flatMap((e) => e.when)]) this.predicateProblems(p, problems);
    for (const effect of step.effects) {
      if (effect.kind === 'simFlag') this.reference('roles', effect.roleId, problems);
    }
    return problems;
  }

  private predicateProblems(p: Predicate, problems: string[]): void {
    if (p.kind === 'stepDone') this.reference('steps', p.stepId, problems);
    if (p.kind === 'roleAlive' || p.kind === 'roleOnDuty') this.reference('roles', p.roleId, problems);
  }

  private declareFlag(flag: string): void {
    const def = this.current();
    if (!def.flags.includes(flag)) def.flags.push(flag);
  }
}
