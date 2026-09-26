/**
 * The step kinds a questline may use: the whole flow vocabulary, or the
 * host's allowlist of what it can play. Every prompt and tool the planner and
 * builder read is rendered for that list, so a model never sees a kind it
 * cannot use.
 */

import { STEP_KINDS, type StepKind } from '../flow/schema.js';
import { promptLoader } from '../prompts.js';

/** The target fields each kind needs, and the ones it may add, in the order its tool line names them. */
export const TARGET_FIELDS: Record<StepKind, { needs: readonly string[]; may?: readonly string[] }> = {
  goto: { needs: ['place'] },
  observe: { needs: ['districtId'] },
  talk: { needs: ['roleId'], may: ['atParcelId'] },
  listen: { needs: ['roleIds', 'atParcelId'] },
  pickup: { needs: ['itemId'] },
  deliver: { needs: ['itemId', 'place'] },
  steal: { needs: ['itemId', 'fromRoleId'] },
  assassinate: { needs: ['roleId'] },
  work: { needs: ['atParcelId', 'role'] },
  investigation: { needs: ['sceneId', 'evidenceId', 'evidenceItemId', 'subjectRoleIds', 'place', 'completionFlag'] },
  rescue: { needs: ['roleId', 'releaseTargetId', 'place', 'completionFlag'] },
  escort: { needs: ['roleId', 'routeId', 'mode', 'from', 'to', 'completionFlag'] },
  access: { needs: ['accessPointId', 'credentialItemId', 'place', 'completionFlag'] },
  hacking: { needs: ['targetId', 'place', 'completionFlag'] },
  sabotage: { needs: ['targetId', 'place', 'completionFlag'] },
  transportation: { needs: ['journeyId', 'mode', 'from', 'to', 'passengerRoleIds', 'cargoItemIds', 'completionFlag'] },
};

/** Kinds whose step can give the player an information item. */
const INFORMING: readonly StepKind[] = ['talk', 'listen', 'observe', 'investigation', 'hacking'];

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export const isStepKind = (value: unknown): value is StepKind => STEP_KINDS.includes(value as StepKind);

/**
 * The playable kinds in catalog order: every kind when `mechanics` is
 * omitted. An unknown or empty list is a caller error.
 */
export function playableKinds(mechanics?: readonly string[]): readonly StepKind[] {
  if (mechanics === undefined) return STEP_KINDS;
  const unknown = mechanics.filter((kind) => !isStepKind(kind));
  if (unknown.length > 0) throw new Error(`unknown step kind ${unknown.join(', ')}; the vocabulary is ${STEP_KINDS.join(', ')}`);
  if (mechanics.length === 0) throw new Error('mechanics names no step kind');
  return STEP_KINDS.filter((kind) => mechanics.includes(kind));
}

/** Placeholder values the planner and builder prompts share: `{{mechanics}}` and `{{informs}}`. */
export function mechanicVars(kinds: readonly StepKind[]): Record<string, string> {
  const informing = INFORMING.filter((kind) => kinds.includes(kind));
  const informs = informing.length > 0
    ? prompt('informs.md#some', { article: /^[aeiou]/.test(informing[0]!) ? 'an' : 'a', kinds: orList(informing) })
    : prompt('informs.md#none');
  return { mechanics: kinds.join(', '), informs };
}

/** What a kind's target takes, as the add_step tool describes it: `listen: roleIds, exactly two different roles; atParcelId.` */
export const targetLine = (kind: StepKind): string =>
  prompt('tools/add_step.md#target').split('\n').find((line) => line.startsWith(`- ${kind}:`))!.slice(2);

/** The step catalog with only the playable kinds' sections. */
export function stepCatalog(kinds: readonly StepKind[]): string {
  const [head, ...sections] = prompt('step-catalog.md', mechanicVars(kinds)).split('\n## ');
  return [head, ...sections.filter((section) => kinds.includes(section.split(' ', 1)[0] as StepKind))].join('\n## ');
}

const orList = (words: readonly string[]): string =>
  words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
