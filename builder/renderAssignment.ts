import { promptLoader } from '../prompts.js';
import type { QuestAssignment } from './schema.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export function renderAssignment(assignment: QuestAssignment): string {
  return prompt('assignment.md', { ...assignment }).trim();
}
