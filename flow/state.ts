import { QuestError } from '../errors.js';
import type { QuestlineDefinition, QuestStep } from './schema.js';

export interface QuestlineState {
  activeStepIds: string[];
  completedStepIds: string[];
  flags: string[];
  endingId?: string;
  /**
   * Quest items the player handed to a person and no step took from them:
   * one a talk with that person needs (`theirs`) or one no step still to come
   * uses (`free`), by item id, with who has it now. Absent when nothing was
   * handed, so a state from before has no such key.
   */
  handed?: QuestlineHanded[];
}

/** One quest item the player handed to a person. */
export interface QuestlineHanded {
  itemId: string;
  npcId: string;
}

/** Validates an untrusted saved state against the immutable definition. */
export class QuestlineStateValidator {
  validate(def: QuestlineDefinition, input: unknown): asserts input is QuestlineState {
    const fail = (message: string): never => {
      throw new QuestError('E_INVALID_FLOW', `${def.id}: invalid saved state: ${message}`);
    };
    if (!isRecord(input)) return fail('expected an object');
    const allowedKeys = new Set(['activeStepIds', 'completedStepIds', 'flags', 'endingId', 'handed']);
    if (Object.keys(input).some((key) => !allowedKeys.has(key))) fail('unknown property');

    const activeIds = stringArray(input.activeStepIds, 'activeStepIds', fail);
    const completedIds = stringArray(input.completedStepIds, 'completedStepIds', fail);
    const flags = stringArray(input.flags, 'flags', fail);
    let endingId: string | undefined;
    if (input.endingId === undefined) endingId = undefined;
    else if (typeof input.endingId === 'string' && input.endingId.length > 0) endingId = input.endingId;
    else return fail('endingId must be a nonempty string');

    const steps = new Map(def.steps.map((step) => [step.stepId, step]));
    for (const id of [...activeIds, ...completedIds]) {
      if (!steps.has(id)) fail(`unknown step ${id}`);
    }
    const active = new Set(activeIds);
    if (completedIds.some((id) => active.has(id))) fail('a step is both active and completed');
    const declaredFlags = new Set(def.flags);
    for (const flag of flags) {
      if (!declaredFlags.has(flag)) fail(`undeclared flag ${flag}`);
    }

    this.validateHistory(def, steps, active, completedIds, endingId, fail);
    this.validateFlags(steps, completedIds, flags, fail);
    if (input.handed !== undefined) this.validateHanded(def, steps, completedIds, input.handed, fail);
  }

  /** Each handed item is one of the questline's, once, and one its completed steps left in the player's hands. */
  private validateHanded(
    def: QuestlineDefinition,
    steps: Map<string, QuestStep>,
    completedIds: string[],
    handed: unknown,
    fail: (message: string) => never,
  ): void {
    if (!Array.isArray(handed)) return fail('handed must be an array');
    const items = new Set(def.items.map((item) => item.itemId));
    const kept = heldAfter(steps, completedIds);
    const seen = new Set<string>();
    for (const entry of handed) {
      if (!isRecord(entry) || Object.keys(entry).some((key) => key !== 'itemId' && key !== 'npcId')) fail('handed entries are { itemId, npcId }');
      const { itemId, npcId } = entry as Record<string, unknown>;
      if (typeof itemId !== 'string' || itemId.length === 0) fail('handed itemId must be a nonempty string');
      if (typeof npcId !== 'string' || npcId.length === 0) fail('handed npcId must be a nonempty string');
      const id = itemId as string;
      if (!items.has(id)) fail(`handed unknown item ${id}`);
      if (seen.has(id)) fail(`handed ${id} twice`);
      if (!kept.has(id)) fail(`handed ${id}, which the completed steps never left with the player`);
      seen.add(id);
    }
  }

  private validateHistory(
    def: QuestlineDefinition,
    steps: Map<string, QuestStep>,
    active: Set<string>,
    completedIds: string[],
    endingId: string | undefined,
    fail: (message: string) => never,
  ): void {
    const remaining = new Set([...completedIds, ...active]);
    const frontier = new Set(def.entryStepIds);
    for (const [index, stepId] of completedIds.entries()) {
      if (!frontier.has(stepId)) fail(`step ${stepId} was not reachable at completion ${index}`);
      frontier.delete(stepId);
      remaining.delete(stepId);
      const step = steps.get(stepId)!;
      if (step.next.length === 0) {
        if (index !== completedIds.length - 1) fail(`terminal step ${stepId} is not last`);
        frontier.clear();
        continue;
      }
      const representedEdges = step.next.filter((edge) => remaining.has(edge.toStepId));
      if (step.branching === 'exclusive' && representedEdges.length > 1) {
        fail(`exclusive step ${stepId} selected more than one edge`);
      }
      for (const edge of representedEdges) frontier.add(edge.toStepId);
    }

    const last = completedIds.length === 0 ? undefined : steps.get(completedIds[completedIds.length - 1]!);
    if (endingId !== undefined) {
      if (!def.endings.some((ending) => ending.endingId === endingId)) fail(`unknown ending ${endingId}`);
      if (last?.endingId !== endingId || last.next.length !== 0) fail(`ending ${endingId} does not match the terminal history`);
      if (active.size > 0) fail('ended state has active steps');
      return;
    }
    if (last?.next.length === 0) fail(`terminal step ${last.stepId} has no saved ending`);
    if (!sameSet(frontier, active)) fail('active steps do not match completion history');
  }

  private validateFlags(
    steps: Map<string, QuestStep>,
    completedIds: string[],
    savedFlags: string[],
    fail: (message: string) => never,
  ): void {
    const replayed = new Set<string>();
    for (const stepId of completedIds) {
      for (const effect of steps.get(stepId)!.effects) {
        if (effect.kind === 'setFlag') replayed.add(effect.flag);
        if (effect.kind === 'clearFlag') replayed.delete(effect.flag);
      }
    }
    if (!sameSet(replayed, new Set(savedFlags))) fail('flags do not match completion history');
  }
}

/** The items completed steps leave with the player, in order: taken or given, minus delivered. */
export function heldAfter(steps: ReadonlyMap<string, QuestStep>, completedIds: Iterable<string>): Set<string> {
  const held = new Set<string>();
  for (const id of completedIds) {
    const step = steps.get(id);
    if (!step) continue;
    const t = step.target;
    if (t.kind === 'pickup' || t.kind === 'steal') held.add(t.itemId);
    for (const itemId of step.gives) held.add(itemId);
    if (t.kind === 'deliver') held.delete(t.itemId);
  }
  return held;
}

function stringArray(value: unknown, name: string, fail: (message: string) => never): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail(`${name} must contain nonempty strings`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) fail(`${name} contains duplicates`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
