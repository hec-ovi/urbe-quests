/** The assignment as the planner and the builder read it. */

import type { QuestAssignment } from './schema.js';

export function renderAssignment(assignment: QuestAssignment): string {
  return [`Title: ${assignment.title}`, `Synopsis:\n${assignment.synopsis}`, `Characters:\n${assignment.characters}`].join('\n\n');
}
