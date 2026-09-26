/** What the creation CLIs read from their arguments and files. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorldContextNormalizer, type AtlasQuestWorld, type NamedWorld, type NormalizedWorldContext, type NPCTypeSet } from '../../world/index.js';

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), 'utf8')) as T;

/**
 * Options as `--name value` or `--name=value`, among positional arguments.
 * An option outside `names`, or one with no value, is a usage error; the
 * next option is never taken as a value (`--name=--text` passes one).
 */
export function parseArgs(args: readonly string[], names: readonly string[]): { positional: string[]; options: Map<string, string> } {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const name = flag.slice(2);
    if (!names.includes(name)) throw new Error(`unknown option ${flag}`);
    const value = inline ?? (args[i + 1]?.startsWith('--') ? undefined : args[++i]);
    if (value === undefined) throw new Error(`${flag} needs a value`);
    options.set(name, value);
  }
  return { positional, options };
}

/** A literal, or `@path` for the contents of that file. */
export const readText = (value: string): string => (value.startsWith('@') ? readFileSync(resolve(value.slice(1)), 'utf8') : value);

/**
 * `p0,p3,p12` or `@open-parcels.json` (a JSON array, a `{ "parcels": [...] }`
 * object, or ids separated by commas or whitespace): the buildings the story
 * may use. Omitted, the whole city is open.
 */
export function readParcels(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const text = readText(value);
  const ids = (value.startsWith('@') ? jsonList(text) : undefined) ?? text.split(/[\s,]+/);
  return ids.map((id) => String(id).trim()).filter((id) => id.length > 0);
}

function jsonList(text: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const carried = (parsed as { parcels?: unknown } | null)?.parcels;
    return Array.isArray(carried) ? carried : undefined;
  } catch {
    return undefined;
  }
}

/** A Naming world or a raw Atlas blueprint with its type set, projected onto the surface Quests reads. */
export function loadWorld(worldPath: string, typesPath: string): NormalizedWorldContext {
  return new WorldContextNormalizer().normalize({
    world: readJson<NamedWorld | AtlasQuestWorld>(worldPath),
    types: readJson<NPCTypeSet>(typesPath),
  });
}
