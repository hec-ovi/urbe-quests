/**
 * Reading a definition for one role: the steps that name it, the venue those
 * steps pin it to, and the hour they meet it at. Pure functions over the
 * document, used wherever a role has to be placed or cast.
 */

import type { QuestlineDefinition, QuestStep, TimeWindow } from './schema.js';

/** Every step that names this role, as its target or as the one who wants it. */
export function stepsOfRole(def: QuestlineDefinition, roleId: string): QuestStep[] {
  return def.steps.filter((step) => namesRole(step, roleId));
}

export function namesRole(step: QuestStep, roleId: string): boolean {
  if (step.wantedByRoleId === roleId) return true;
  const t = step.target;
  if ('roleId' in t && t.roleId === roleId) return true;
  if (t.kind === 'listen') return t.roleIds.includes(roleId);
  if (t.kind === 'steal') return t.fromRoleId === roleId;
  if (t.kind === 'investigation') return t.subjectRoleIds.includes(roleId);
  if (t.kind === 'transportation') return t.passengerRoleIds.includes(roleId);
  return false;
}

/** The parcel a role is pinned to by the steps that meet it. */
export function workplaceOf(def: QuestlineDefinition, roleId: string): string | undefined {
  for (const step of def.steps) {
    const t = step.target;
    if (t.kind === 'talk' && t.roleId === roleId && t.atParcelId !== undefined) return t.atParcelId;
    if (t.kind === 'listen' && t.roleIds.includes(roleId)) return t.atParcelId;
  }
  return undefined;
}

/** The hour the story meets this role at, when any of its steps names one. */
export function storyWindow(def: QuestlineDefinition, roleId: string): TimeWindow | undefined {
  return stepsOfRole(def, roleId).find((step) => step.window !== undefined)?.window;
}
