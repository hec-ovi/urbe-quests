/** Structural validation of a QuestlineDefinition. Throws E_INVALID_FLOW. */

import { QuestError } from '../errors.js';
import type { Predicate, QuestItem, QuestlineDefinition, QuestStep } from './schema.js';

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
        return;
      case 'steal':
        requirePhysicalItem(t.itemId);
        requireRole(t.fromRoleId);
        return;
      case 'assassinate':
        requireRole(t.roleId);
        return;
      case 'goto':
      case 'observe':
      case 'work':
        return;
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
      if (t.kind === 'talk' || t.kind === 'assassinate') used.add(t.roleId);
      if (t.kind === 'listen') t.roleIds.forEach((r) => used.add(r));
      if (t.kind === 'steal') used.add(t.fromRoleId);
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
