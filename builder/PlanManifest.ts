/**
 * The manifest closes the plan: the exact ids of the roles, items, acts,
 * endings and steps the builder may commit. Parsed from the plan's last
 * section by code, so the build's work is bounded before the tool loop starts.
 */

import { ProseShortfall } from '../story/headings.js';

export type ManifestKind = 'roles' | 'items' | 'acts' | 'endings' | 'steps';
export const MANIFEST_KINDS: readonly ManifestKind[] = ['roles', 'items', 'acts', 'endings', 'steps'];

export type PlanManifest = Record<ManifestKind, string[]>;

/** Lists that cannot be empty: a questline without a role, act, ending or step is not a questline. */
const REQUIRED: readonly ManifestKind[] = ['roles', 'acts', 'endings', 'steps'];

const HEADING = /^\s*(?:#{1,4}\s*|\*\*)?\s*(?:\d+[.)]\s*)?manifest\**\s*:?\s*$/im;
const LIST_LINE = /^\s*(?:[-*]\s+|#{1,4}\s*)?\**(roles|items|acts|endings|steps)\**\s*:?\s*(.*)$/i;
const BULLET_LINE = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function parsePlanManifest(plan: string): PlanManifest {
  const body = manifestBody(plan);
  if (body === undefined) throw new ProseShortfall(['no "## Manifest" section at the end of the plan']);

  const lists: Partial<Record<ManifestKind, string[]>> = {};
  const problems: string[] = [];
  let current: ManifestKind | undefined;
  const add = (kind: ManifestKind, text: string) => {
    lists[kind] = [...(lists[kind] ?? []), ...entries(text, kind, problems)];
  };
  for (const line of body.split('\n')) {
    const list = LIST_LINE.exec(line);
    if (list !== null) {
      current = list[1]!.toLowerCase() as ManifestKind;
      add(current, list[2]!);
      continue;
    }
    const bullet = current !== undefined ? BULLET_LINE.exec(line) : null;
    if (bullet !== null) add(current!, bullet[1]!);
  }

  for (const kind of MANIFEST_KINDS) {
    const ids = lists[kind];
    if (ids === undefined) problems.push(`manifest has no "${kind}:" line`);
    else if (ids.length === 0 && REQUIRED.includes(kind) && !problems.some((p) => p.startsWith(`${kind} entry`))) {
      problems.push(`manifest lists no ${kind}`);
    }
  }
  if (problems.length > 0) throw new ProseShortfall(problems);
  return { roles: lists.roles!, items: lists.items!, acts: lists.acts!, endings: lists.endings!, steps: lists.steps! };
}

export function manifestSize(manifest: PlanManifest): number {
  return MANIFEST_KINDS.reduce((sum, kind) => sum + manifest[kind].length, 0);
}

/** Text after the last Manifest heading; the section is meant to close the plan. */
function manifestBody(plan: string): string | undefined {
  let last: RegExpExecArray | undefined;
  const heading = new RegExp(HEADING.source, 'gim');
  for (let match = heading.exec(plan); match !== null; match = heading.exec(plan)) last = match;
  return last === undefined ? undefined : plan.slice(last.index + last[0].length);
}

/** "i_ledger (document), i_stall (information)" -> ids; parentheses and backticks are dressing, "none" is empty. */
function entries(text: string, kind: ManifestKind, problems: string[]): string[] {
  const bare = text.replace(/\([^)]*\)/g, '').replace(/`/g, '').trim();
  if (bare.length === 0 || /^none\.?$/i.test(bare)) return [];
  const ids: string[] = [];
  for (const raw of bare.split(/[,;]/)) {
    const id = raw.trim().replace(/\.$/, '');
    if (id.length === 0) continue;
    if (!ID.test(id)) problems.push(`${kind} entry "${id}" is not a machine id (letters, digits, underscores)`);
    else if (ids.includes(id)) problems.push(`${kind} id ${id} listed twice`);
    else ids.push(id);
  }
  return ids;
}
