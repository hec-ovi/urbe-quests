import { AuthoringError } from './AuthoringError.js';
import type { Predicate, QuestlineDefinition, QuestStep } from './schema.js';

/** Semantic checks required in addition to the flow JSON Schema boundary. */
export class QuestGraphAudit {
  validate(definition: QuestlineDefinition): void {
    const problems: string[] = [];
    const fail = (message: string): void => {
      problems.push(message);
    };

    const steps = uniqueMap(definition.steps, (step) => step.stepId, 'step', problems);
    const roles = uniqueMap(definition.roles, (role) => role.roleId, 'role', problems);
    const items = uniqueMap(definition.items, (item) => item.itemId, 'item', problems);
    const acts = uniqueMap(definition.acts, (act) => act.actId, 'act', problems);
    const endings = uniqueMap(definition.endings, (ending) => ending.endingId, 'ending', problems);
    uniqueMap(definition.facts, (fact) => fact.factId, 'fact', problems);
    const flags = new Set(definition.flags);
    if (flags.size !== definition.flags.length) fail('duplicate quest flag');

    if (definition.entryStepIds.length === 0) fail('no entry steps');
    for (const stepId of definition.entryStepIds) {
      if (!steps.has(stepId)) fail(`entry step ${stepId} does not exist`);
    }

    for (const step of definition.steps) {
      if (!acts.has(step.actId)) fail(`step ${step.stepId}: unknown act ${step.actId}`);
      if (step.wantedByRoleId !== undefined && !roles.has(step.wantedByRoleId)) {
        fail(`step ${step.stepId}: wanted by unknown role ${step.wantedByRoleId}`);
      }
      checkTarget(step, roles, items, fail);
      for (const itemId of [...step.gives, ...step.needs]) {
        if (!items.has(itemId)) fail(`step ${step.stepId}: unknown item ${itemId}`);
      }
      for (const predicate of [...step.conditions, ...step.next.flatMap((edge) => edge.when)]) {
        checkPredicate(step.stepId, predicate, flags, steps, roles, fail);
      }
      for (const effect of step.effects) {
        if (effect.kind === 'simFlag') {
          if (!roles.has(effect.roleId)) fail(`step ${step.stepId}: effect on unknown role ${effect.roleId}`);
        } else if (!flags.has(effect.flag)) {
          fail(`step ${step.stepId}: effect on undeclared flag ${effect.flag}`);
        }
      }
      for (const edge of step.next) {
        if (!steps.has(edge.toStepId)) fail(`step ${step.stepId}: edge to unknown step ${edge.toStepId}`);
        if (edge.toStepId === step.stepId) fail(`step ${step.stepId}: edge to itself`);
      }
      if (step.branching === 'exclusive') {
        const fallback = step.next.findIndex((edge) => edge.when.length === 0);
        if (fallback >= 0 && fallback !== step.next.length - 1) {
          fail(`step ${step.stepId}: unconditional exclusive edge shadows every edge after it`);
        }
      }
      if (step.next.length === 0) {
        if (step.endingId === undefined) fail(`terminal step ${step.stepId} has no ending`);
        else if (!endings.has(step.endingId)) fail(`step ${step.stepId}: unknown ending ${step.endingId}`);
      } else if (step.endingId !== undefined) {
        fail(`step ${step.stepId} has both edges and an ending`);
      }
    }

    for (const fact of definition.facts) {
      if (!roles.has(fact.roleId)) fail(`fact ${fact.factId}: unknown role ${fact.roleId}`);
      if (fact.gateFlag !== undefined && !flags.has(fact.gateFlag)) {
        fail(`fact ${fact.factId}: undeclared gate flag ${fact.gateFlag}`);
      }
    }
    const referencedEndings = new Set(definition.steps.flatMap((step) => step.endingId ? [step.endingId] : []));
    for (const endingId of endings.keys()) {
      if (!referencedEndings.has(endingId)) fail(`ending ${endingId} is unreachable`);
    }
    const usedRoles = collectUsedRoles(definition);
    for (const roleId of roles.keys()) {
      if (!usedRoles.has(roleId)) fail(`role ${roleId} is never used`);
    }
    checkAcyclicAndReachable(definition, steps, fail);

    if (problems.length > 0) {
      throw new AuthoringError('E_INVALID_FLOW', 'adapted questline failed flow validation', problems);
    }
  }
}

type QuestItem = QuestlineDefinition['items'][number];

function checkTarget(
  step: QuestStep,
  roles: Map<string, unknown>,
  items: Map<string, QuestItem>,
  fail: (message: string) => void,
): void {
  const requireRole = (roleId: string): void => {
    if (!roles.has(roleId)) fail(`step ${step.stepId}: unknown role ${roleId}`);
  };
  const requirePhysicalItem = (itemId: string): QuestItem | undefined => {
    const item = items.get(itemId);
    if (item === undefined) {
      fail(`step ${step.stepId}: unknown item ${itemId}`);
      return undefined;
    }
    if (item.kind === 'information') fail(`step ${step.stepId}: ${step.target.kind} on information item ${itemId}`);
    return item;
  };
  const target = step.target;
  if (target.kind === 'talk' || target.kind === 'assassinate') requireRole(target.roleId);
  else if (target.kind === 'listen') {
    target.roleIds.forEach(requireRole);
    if (target.roleIds[0] === target.roleIds[1]) fail(`step ${step.stepId}: listen needs two distinct roles`);
  } else if (target.kind === 'pickup') {
    const item = requirePhysicalItem(target.itemId);
    if (item && item.atParcelId === undefined) fail(`step ${step.stepId}: pickup item ${target.itemId} has no parcel`);
  } else if (target.kind === 'deliver') requirePhysicalItem(target.itemId);
  else if (target.kind === 'steal') {
    requirePhysicalItem(target.itemId);
    requireRole(target.fromRoleId);
  } else if (target.kind === 'investigation') {
    const evidence = items.get(target.evidenceItemId);
    if (evidence === undefined) fail(`step ${step.stepId}: unknown evidence item ${target.evidenceItemId}`);
    else if (evidence.kind !== 'information') fail(`step ${step.stepId}: evidence item ${target.evidenceItemId} is not information`);
    if (!step.gives.includes(target.evidenceItemId)) fail(`step ${step.stepId}: investigation does not give evidence item ${target.evidenceItemId}`);
    target.subjectRoleIds.forEach(requireRole);
    requireCompletionEffect(step, target.completionFlag, fail);
  } else if (target.kind === 'rescue') {
    requireRole(target.roleId);
    requireCompletionEffect(step, target.completionFlag, fail);
  } else if (target.kind === 'escort') {
    requireRole(target.roleId);
    if (samePlace(target.from, target.to)) fail(`step ${step.stepId}: escort route starts and ends at the same place`);
    requireCompletionEffect(step, target.completionFlag, fail);
  } else if (target.kind === 'access') {
    const credential = items.get(target.credentialItemId);
    if (credential === undefined) fail(`step ${step.stepId}: unknown credential item ${target.credentialItemId}`);
    else if (!['key', 'information', 'device'].includes(credential.kind)) {
      fail(`step ${step.stepId}: access credential ${target.credentialItemId} has ineligible kind ${credential.kind}`);
    }
    if (!step.needs.includes(target.credentialItemId)) fail(`step ${step.stepId}: access does not need credential item ${target.credentialItemId}`);
    requireCompletionEffect(step, target.completionFlag, fail);
  } else if (target.kind === 'hacking' || target.kind === 'sabotage') {
    requireCompletionEffect(step, target.completionFlag, fail);
  } else if (target.kind === 'transportation') {
    target.passengerRoleIds.forEach(requireRole);
    for (const itemId of target.cargoItemIds) {
      requirePhysicalItem(itemId);
      if (!step.needs.includes(itemId)) fail(`step ${step.stepId}: transportation does not need cargo item ${itemId}`);
    }
    if (samePlace(target.from, target.to)) fail(`step ${step.stepId}: transportation starts and ends at the same place`);
    requireCompletionEffect(step, target.completionFlag, fail);
  }
}

function requireCompletionEffect(step: QuestStep, completionFlag: string, fail: (message: string) => void): void {
  if (!step.effects.some((effect) => effect.kind === 'setFlag' && effect.flag === completionFlag)) {
    fail(`step ${step.stepId}: ${step.target.kind} completion flag ${completionFlag} is not set by its effects`);
  }
}

function checkPredicate(
  stepId: string,
  predicate: Predicate,
  flags: Set<string>,
  steps: Map<string, unknown>,
  roles: Map<string, unknown>,
  fail: (message: string) => void,
): void {
  if (predicate.kind === 'flagSet' || predicate.kind === 'flagNotSet') {
    if (!flags.has(predicate.flag)) fail(`step ${stepId}: predicate on undeclared flag ${predicate.flag}`);
  } else if (predicate.kind === 'stepDone') {
    if (!steps.has(predicate.stepId)) fail(`step ${stepId}: predicate on unknown step ${predicate.stepId}`);
  } else if (!roles.has(predicate.roleId)) {
    fail(`step ${stepId}: predicate on unknown role ${predicate.roleId}`);
  }
}

function collectUsedRoles(definition: QuestlineDefinition): Set<string> {
  const used = new Set<string>();
  for (const step of definition.steps) {
    const target = step.target;
    if (step.wantedByRoleId !== undefined) used.add(step.wantedByRoleId);
    if (target.kind === 'talk' || target.kind === 'assassinate' || target.kind === 'rescue' || target.kind === 'escort') {
      used.add(target.roleId);
    }
    if (target.kind === 'listen') target.roleIds.forEach((roleId) => used.add(roleId));
    if (target.kind === 'steal') used.add(target.fromRoleId);
    if (target.kind === 'investigation') target.subjectRoleIds.forEach((roleId) => used.add(roleId));
    if (target.kind === 'transportation') target.passengerRoleIds.forEach((roleId) => used.add(roleId));
    for (const predicate of [...step.conditions, ...step.next.flatMap((edge) => edge.when)]) {
      if (predicate.kind === 'roleAlive' || predicate.kind === 'roleOnDuty') used.add(predicate.roleId);
    }
    for (const effect of step.effects) {
      if (effect.kind === 'simFlag') used.add(effect.roleId);
    }
  }
  for (const fact of definition.facts) used.add(fact.roleId);
  return used;
}

function samePlace(left: import('./schema.js').PlaceTarget, right: import('./schema.js').PlaceTarget): boolean {
  return 'parcelId' in left
    ? 'parcelId' in right && left.parcelId === right.parcelId
    : 'districtId' in right && left.districtId === right.districtId;
}

function checkAcyclicAndReachable(
  definition: QuestlineDefinition,
  steps: Map<string, QuestStep>,
  fail: (message: string) => void,
): void {
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (stepId: string): void => {
    const mark = state.get(stepId);
    if (mark === 'visiting') {
      fail(`cycle through step ${stepId}`);
      return;
    }
    if (mark === 'done') return;
    state.set(stepId, 'visiting');
    for (const edge of steps.get(stepId)?.next ?? []) {
      if (steps.has(edge.toStepId)) visit(edge.toStepId);
    }
    state.set(stepId, 'done');
  };
  for (const stepId of definition.entryStepIds) {
    if (steps.has(stepId)) visit(stepId);
  }
  for (const stepId of steps.keys()) {
    if (!state.has(stepId)) fail(`step ${stepId} unreachable from entry`);
  }
}

function uniqueMap<T>(values: T[], id: (value: T) => string, subject: string, problems: string[]): Map<string, T> {
  const found = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (found.has(key)) problems.push(`duplicate ${subject} id ${key}`);
    found.set(key, value);
  }
  return found;
}
