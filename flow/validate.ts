/** Structural validation of a QuestlineDefinition. Throws E_INVALID_FLOW. */

import { QuestError } from '../errors.js';
import type { PlaceTarget, Predicate, QuestItem, QuestlineDefinition, QuestStep } from './schema.js';

export class FlowValidator {
  validate(def: QuestlineDefinition): void {
    const fail = (message: string): never => {
      throw new QuestError('E_INVALID_FLOW', `${def.id}: ${message}`);
    };

    this.checkUnique(def.steps.map((s) => s.stepId), 'step', fail);
    this.checkUnique(def.roles.map((r) => r.roleId), 'role', fail);
    this.checkUnique(def.items.map((i) => i.itemId), 'item', fail);
    this.checkUnique(def.acts.map((a) => a.actId), 'act', fail);
    this.checkUnique(def.endings.map((e) => e.endingId), 'ending', fail);
    this.checkUnique(def.facts.map((f) => f.factId), 'fact', fail);

    const stepIds = new Set(def.steps.map((s) => s.stepId));
    const roleIds = new Set(def.roles.map((r) => r.roleId));
    const items = new Map(def.items.map((i) => [i.itemId, i]));
    const actIds = new Set(def.acts.map((a) => a.actId));
    const endingIds = new Set(def.endings.map((e) => e.endingId));
    const flags = new Set(def.flags);

    if (def.entryStepIds.length === 0) fail('no entry steps');
    for (const id of def.entryStepIds) {
      if (!stepIds.has(id)) fail(`entry step ${id} does not exist`);
    }

    for (const step of def.steps) {
      if (!actIds.has(step.actId)) fail(`step ${step.stepId}: unknown act ${step.actId}`);
      if (step.wantedByRoleId !== undefined && !roleIds.has(step.wantedByRoleId)) {
        fail(`step ${step.stepId}: wanted by unknown role ${step.wantedByRoleId}`);
      }
      this.checkTarget(step, roleIds, items, fail);
      for (const itemId of [...step.gives, ...step.needs]) {
        if (!items.has(itemId)) fail(`step ${step.stepId}: unknown item ${itemId}`);
      }
      for (const p of [...step.conditions, ...step.next.flatMap((e) => e.when)]) {
        this.checkPredicate(step.stepId, p, flags, stepIds, roleIds, fail);
      }
      for (const effect of step.effects) {
        if (effect.kind === 'simFlag') {
          if (!roleIds.has(effect.roleId)) fail(`step ${step.stepId}: effect on unknown role ${effect.roleId}`);
        } else if (!flags.has(effect.flag)) {
          fail(`step ${step.stepId}: effect on undeclared flag ${effect.flag}`);
        }
      }
      for (const edge of step.next) {
        if (!stepIds.has(edge.toStepId)) fail(`step ${step.stepId}: edge to unknown step ${edge.toStepId}`);
        if (edge.toStepId === step.stepId) fail(`step ${step.stepId}: edge to itself`);
      }
      if (step.branching === 'exclusive') {
        const fallback = step.next.findIndex((edge) => edge.when.length === 0);
        if (fallback >= 0 && fallback !== step.next.length - 1) {
          fail(`step ${step.stepId}: unconditional exclusive edge shadows every edge after it`);
        }
      }
      if (step.next.length === 0) {
        const endingId = step.endingId;
        if (endingId === undefined) fail(`terminal step ${step.stepId} has no ending`);
        else if (!endingIds.has(endingId)) fail(`step ${step.stepId}: unknown ending ${endingId}`);
      } else if (step.endingId !== undefined) {
        fail(`step ${step.stepId} has both edges and an ending`);
      }
    }

    for (const fact of def.facts) {
      if (!roleIds.has(fact.roleId)) fail(`fact ${fact.factId}: unknown role ${fact.roleId}`);
      if (fact.gateFlag !== undefined && !flags.has(fact.gateFlag)) {
        fail(`fact ${fact.factId}: undeclared gate flag ${fact.gateFlag}`);
      }
    }

    const referencedEndings = new Set(def.steps.map((s) => s.endingId).filter((id) => id !== undefined));
    for (const ending of def.endings) {
      if (!referencedEndings.has(ending.endingId)) fail(`ending ${ending.endingId} is unreachable`);
    }

    const usedRoles = this.collectUsedRoles(def);
    for (const role of def.roles) {
      if (!usedRoles.has(role.roleId)) fail(`role ${role.roleId} is never used`);
    }

    this.checkAcyclicAndReachable(def, fail);
  }

  private checkUnique(ids: string[], kind: string, fail: (m: string) => never): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) fail(`duplicate ${kind} id ${id}`);
      seen.add(id);
    }
  }

  private checkTarget(step: QuestStep, roles: Set<string>, items: Map<string, QuestItem>, fail: (m: string) => never): void {
    const t = step.target;
    const requireRole = (roleId: string) => {
      if (!roles.has(roleId)) fail(`step ${step.stepId}: unknown role ${roleId}`);
    };
    /** Physical items only: information is told by a step's gives, never handled. */
    const requirePhysicalItem = (itemId: string): QuestItem => {
      const item = items.get(itemId);
      if (item === undefined) return fail(`step ${step.stepId}: unknown item ${itemId}`);
      if (item.kind === 'information') fail(`step ${step.stepId}: ${t.kind} on information item ${itemId}`);
      return item;
    };
    const requirePlace = (place: PlaceTarget): void => {
      const entries = Object.entries(place);
      const allowed = new Set(['parcelId', 'districtId', 'stationId', 'stopId']);
      if (entries.length !== 1 || !allowed.has(entries[0]?.[0] ?? '') || typeof entries[0]?.[1] !== 'string' || entries[0][1].length === 0) {
        fail(`step ${step.stepId}: ${t.kind} has an invalid place`);
      }
    };
    switch (t.kind) {
      case 'talk':
        requireRole(t.roleId);
        return;
      case 'listen':
        t.roleIds.forEach(requireRole);
        if (t.roleIds[0] === t.roleIds[1]) fail(`step ${step.stepId}: listen needs two distinct roles`);
        return;
      case 'pickup':
        if (requirePhysicalItem(t.itemId).atParcelId === undefined) {
          fail(`step ${step.stepId}: pickup item ${t.itemId} has no parcel`);
        }
        return;
      case 'deliver':
        requirePhysicalItem(t.itemId);
        requirePlace(t.place);
        return;
      case 'steal':
        requirePhysicalItem(t.itemId);
        requireRole(t.fromRoleId);
        return;
      case 'assassinate':
        requireRole(t.roleId);
        return;
      case 'investigation': {
        requirePlace(t.place);
        const evidence = items.get(t.evidenceItemId);
        if (evidence === undefined) fail(`step ${step.stepId}: unknown evidence item ${t.evidenceItemId}`);
        else if (evidence.kind !== 'information') fail(`step ${step.stepId}: evidence item ${t.evidenceItemId} is not information`);
        if (!step.gives.includes(t.evidenceItemId)) fail(`step ${step.stepId}: investigation does not give evidence item ${t.evidenceItemId}`);
        t.subjectRoleIds.forEach(requireRole);
        this.requireCompletionEffect(step, t.completionFlag, fail);
        return;
      }
      case 'rescue':
        requireRole(t.roleId);
        requirePlace(t.place);
        this.requireCompletionEffect(step, t.completionFlag, fail);
        return;
      case 'escort':
        requireRole(t.roleId);
        requirePlace(t.from);
        requirePlace(t.to);
        if (samePlace(t.from, t.to)) fail(`step ${step.stepId}: escort route starts and ends at the same place`);
        this.requireCompletionEffect(step, t.completionFlag, fail);
        return;
      case 'access': {
        requirePlace(t.place);
        const credential = items.get(t.credentialItemId);
        if (credential === undefined) fail(`step ${step.stepId}: unknown credential item ${t.credentialItemId}`);
        else if (!['key', 'information', 'device'].includes(credential.kind)) {
          fail(`step ${step.stepId}: access credential ${t.credentialItemId} has ineligible kind ${credential.kind}`);
        }
        if (!step.needs.includes(t.credentialItemId)) fail(`step ${step.stepId}: access does not need credential item ${t.credentialItemId}`);
        this.requireCompletionEffect(step, t.completionFlag, fail);
        return;
      }
      case 'hacking':
      case 'sabotage':
        requirePlace(t.place);
        this.requireCompletionEffect(step, t.completionFlag, fail);
        return;
      case 'transportation':
        requirePlace(t.from);
        requirePlace(t.to);
        t.passengerRoleIds.forEach(requireRole);
        for (const itemId of t.cargoItemIds) {
          requirePhysicalItem(itemId);
          if (!step.needs.includes(itemId)) fail(`step ${step.stepId}: transportation does not need cargo item ${itemId}`);
        }
        if (samePlace(t.from, t.to)) fail(`step ${step.stepId}: transportation starts and ends at the same place`);
        this.requireCompletionEffect(step, t.completionFlag, fail);
        return;
      case 'goto':
        requirePlace(t.place);
        return;
      case 'observe':
      case 'work':
        return;
    }
  }

  private requireCompletionEffect(step: QuestStep, completionFlag: string, fail: (m: string) => never): void {
    if (!step.effects.some((effect) => effect.kind === 'setFlag' && effect.flag === completionFlag)) {
      fail(`step ${step.stepId}: ${step.target.kind} completion flag ${completionFlag} is not set by its effects`);
    }
  }

  private checkPredicate(
    stepId: string,
    p: Predicate,
    flags: Set<string>,
    steps: Set<string>,
    roles: Set<string>,
    fail: (m: string) => never,
  ): void {
    switch (p.kind) {
      case 'flagSet':
      case 'flagNotSet':
        if (!flags.has(p.flag)) fail(`step ${stepId}: predicate on undeclared flag ${p.flag}`);
        return;
      case 'stepDone':
        if (!steps.has(p.stepId)) fail(`step ${stepId}: predicate on unknown step ${p.stepId}`);
        return;
      case 'roleAlive':
      case 'roleOnDuty':
        if (!roles.has(p.roleId)) fail(`step ${stepId}: predicate on unknown role ${p.roleId}`);
        return;
    }
  }

  private collectUsedRoles(def: QuestlineDefinition): Set<string> {
    const used = new Set<string>();
    for (const step of def.steps) {
      const t = step.target;
      if (step.wantedByRoleId !== undefined) used.add(step.wantedByRoleId);
      if (t.kind === 'talk' || t.kind === 'assassinate' || t.kind === 'rescue' || t.kind === 'escort') used.add(t.roleId);
      if (t.kind === 'listen') t.roleIds.forEach((r) => used.add(r));
      if (t.kind === 'steal') used.add(t.fromRoleId);
      if (t.kind === 'investigation') t.subjectRoleIds.forEach((r) => used.add(r));
      if (t.kind === 'transportation') t.passengerRoleIds.forEach((r) => used.add(r));
      for (const p of [...step.conditions, ...step.next.flatMap((e) => e.when)]) {
        if (p.kind === 'roleAlive' || p.kind === 'roleOnDuty') used.add(p.roleId);
      }
      for (const e of step.effects) {
        if (e.kind === 'simFlag') used.add(e.roleId);
      }
    }
    for (const fact of def.facts) used.add(fact.roleId);
    return used;
  }

  private checkAcyclicAndReachable(def: QuestlineDefinition, fail: (m: string) => never): void {
    const edges = new Map<string, string[]>(def.steps.map((s) => [s.stepId, s.next.map((e) => e.toStepId)]));
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string): void => {
      const mark = state.get(id);
      if (mark === 'visiting') fail(`cycle through step ${id}`);
      if (mark === 'done') return;
      state.set(id, 'visiting');
      for (const to of edges.get(id) ?? []) visit(to);
      state.set(id, 'done');
    };
    for (const id of def.entryStepIds) visit(id);
    for (const step of def.steps) {
      if (!state.has(step.stepId)) fail(`step ${step.stepId} unreachable from entry`);
    }
  }
}

function samePlace(left: import('./schema.js').PlaceTarget, right: import('./schema.js').PlaceTarget): boolean {
  if ('parcelId' in left) return 'parcelId' in right && left.parcelId === right.parcelId;
  if ('districtId' in left) return 'districtId' in right && left.districtId === right.districtId;
  if ('stationId' in left) return 'stationId' in right && left.stationId === right.stationId;
  return 'stopId' in right && left.stopId === right.stopId;
}
