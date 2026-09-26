/** Collects planned pieces, checks their references and validates the completed definition. */

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
import { TARGET_FIELDS, targetLine } from './mechanics.js';
import { MANIFEST_KINDS, manifestSize, type ManifestKind, type PlanManifest } from './PlanManifest.js';

export interface DraftAudit {
  roleProblems(role: QuestRole): string[];
  itemProblems(item: QuestItem): string[];
  stepProblems(step: QuestStep): string[];
}

/** Fills what code owns in a finished questline: story venues, place names, hour gates. */
export interface DraftStamp {
  definition(def: QuestlineDefinition): QuestlineDefinition;
}

export class DraftError extends Error {}

const SINGULAR: Record<ManifestKind, string> = { roles: 'role', items: 'item', acts: 'act', endings: 'ending', steps: 'step' };

export class QuestlineDraft {
  private def: QuestlineDefinition | undefined;

  constructor(
    private readonly manifest: PlanManifest,
    private readonly audit: DraftAudit,
    private readonly stamp: DraftStamp,
  ) {}

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
    this.accept('roles', role.roleId);
    this.rejectAudit(this.audit.roleProblems(role));
    const replaced = put(def.roles, role, (r) => r.roleId === role.roleId);
    return `role ${role.roleId} ${verb(replaced)}; ${this.status()}`;
  }

  addItem(item: QuestItem): string {
    const def = this.current();
    this.accept('items', item.itemId);
    this.rejectAudit(this.audit.itemProblems(item));
    const replaced = put(def.items, item, (i) => i.itemId === item.itemId);
    return `item ${item.itemId} ${verb(replaced)}; ${this.status()}`;
  }

  addFact(fact: QuestFact): string {
    const def = this.current();
    const problems: string[] = [];
    this.reference('roles', fact.roleId, problems);
    if (problems.length > 0) throw new DraftError(`fact ${fact.factId}: ${problems.join('; ')}`);
    if (fact.gateFlag !== undefined) this.declareFlag(fact.gateFlag);
    const replaced = put(def.facts, fact, (f) => f.factId === fact.factId);
    return `fact ${fact.factId} ${verb(replaced)}`;
  }

  addAct(act: QuestAct): string {
    const def = this.current();
    this.accept('acts', act.actId);
    const replaced = put(def.acts, act, (a) => a.actId === act.actId);
    return `act ${act.actId} ${verb(replaced)}; ${this.status()}`;
  }

  addEnding(ending: QuestEnding): string {
    const def = this.current();
    this.accept('endings', ending.endingId);
    const replaced = put(def.endings, ending, (e) => e.endingId === ending.endingId);
    return `ending ${ending.endingId} ${verb(replaced)}; ${this.status()}`;
  }

  addStep(step: QuestStep & { entry?: boolean }): string {
    const def = this.current();
    this.accept('steps', step.stepId);
    const { entry, ...rest } = step;
    const missing = this.missingFields(rest);
    if (missing.length > 0) throw new DraftError(`step ${rest.stepId} not added: ${missing.join('; ')}`);
    const problems = [...this.stepProblems(rest), ...this.audit.stepProblems(rest)];
    if (problems.length > 0) throw new DraftError(`step ${rest.stepId} not added: ${problems.join('; ')}`);
    for (const p of [...rest.conditions, ...rest.next.flatMap((e) => e.when)]) {
      if (p.kind === 'flagSet' || p.kind === 'flagNotSet') this.declareFlag(p.flag);
    }
    for (const effect of rest.effects) {
      if (effect.kind === 'setFlag' || effect.kind === 'clearFlag') this.declareFlag(effect.flag);
    }
    const replaced = put(def.steps, rest, (s) => s.stepId === rest.stepId);
    const listed = def.entryStepIds.indexOf(rest.stepId);
    if (entry === true && listed < 0) def.entryStepIds.push(rest.stepId);
    if (entry !== true && listed >= 0) def.entryStepIds.splice(listed, 1);
    return `step ${rest.stepId} ${verb(replaced)}${entry === true ? ' (entry)' : ''}; ${this.status()}`;
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
    const missing = this.missingLine();
    if (missing !== undefined) throw new DraftError(`not finished; ${missing}; then call finish_questline again`);
    const def = this.stamp.definition(this.current());
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

  private rejectAudit(problems: string[]): void {
    if (problems.length > 0) throw new DraftError(problems.join('; '));
  }

  private status(): string {
    const { committed, planned } = this.progress();
    return `${committed} of ${planned} planned pieces in`;
  }

  /** An id may enter only when the plan lists it; adding it again replaces the piece already in. */
  private accept(kind: ManifestKind, id: string): void {
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

  /**
   * Fields the step's target and effects need before any other check can read them; a target missing one is
   * refused first, with what its kind takes.
   */
  private missingFields(step: QuestStep): string[] {
    const target = step.target as unknown as Record<string, unknown>;
    const absent = TARGET_FIELDS[step.target.kind].needs.filter((field) => target[field] === undefined);
    const missing = absent.length > 0 ? [`${absent.map((field) => `target.${field} is missing`).join('; ')} (${targetLine(step.target.kind)})`] : [];
    step.effects.forEach((effect, i) => {
      if (effect.kind === 'simFlag' && effect.op === undefined) missing.push(`effects[${i}].op is missing`);
    });
    return missing;
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

/** Puts a piece in place of the one with its id, or at the end; true when it replaced one. */
function put<T>(pieces: T[], piece: T, same: (held: T) => boolean): boolean {
  const at = pieces.findIndex(same);
  if (at >= 0) pieces[at] = piece;
  else pieces.push(piece);
  return at >= 0;
}

const verb = (replaced: boolean) => (replaced ? 'replaced' : 'added');
