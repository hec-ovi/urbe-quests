import { QuestError } from '../errors.js';
import type { QuestlineDefinition, QuestStep } from './schema.js';

export interface QuestlineState {
  activeStepIds: string[];
  completedStepIds: string[];
  flags: string[];
  endingId?: string;
}

/** Validates an untrusted saved state against the immutable definition. */
export class QuestlineStateValidator {
  validate(def: QuestlineDefinition, input: unknown): asserts input is QuestlineState {
    const fail = (message: string): never => {
      throw new QuestError('E_INVALID_FLOW', `${def.id}: invalid saved state: ${message}`);
    };
    if (!isRecord(input)) return fail('expected an object');
    const allowedKeys = new Set(['activeStepIds', 'completedStepIds', 'flags', 'endingId']);
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
