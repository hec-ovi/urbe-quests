/**
 * Checks a tool call against that tool's own schema before it reaches the
 * draft: required fields, their types, the closed enums. A model that sends
 * half a step (or arguments that did not parse) gets told what the call needs
 * instead of throwing a TypeError through the build loop.
 */

type Schema = Record<string, unknown>;

/** Every shape problem in the call, as field paths the agent can act on. */
export function toolInputProblems(schema: Schema, input: unknown): string[] {
  const problems: string[] = [];
  check(schema, input, '', problems);
  return problems;
}

function check(schema: Schema, value: unknown, path: string, problems: string[]): void {
  const allowed = schema['enum'];
  if (Array.isArray(allowed)) {
    if (!allowed.includes(value)) problems.push(`${label(path)} must be one of ${allowed.join(', ')}`);
    return;
  }
  if (schema['type'] === 'object') checkObject(schema, value, path, problems);
  else if (schema['type'] === 'array') checkArray(schema, value, path, problems);
  else if (schema['type'] === 'string' || schema['type'] === 'boolean') {
    if (typeof value !== schema['type']) problems.push(`${label(path)} must be a ${String(schema['type'])}`);
  }
}

function checkObject(schema: Schema, value: unknown, path: string, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${label(path)} must be an object`);
    return;
  }
  const required = schema['required'];
  if (Array.isArray(required)) {
    for (const name of required) {
      if (value[String(name)] === undefined || value[String(name)] === null) problems.push(`${label(join(path, String(name)))} is missing`);
    }
  }
  const properties = schema['properties'];
  if (!isRecord(properties)) return;
  for (const [name, sub] of Object.entries(properties)) {
    const held = value[name];
    if (held !== undefined && held !== null && isRecord(sub)) check(sub, held, join(path, name), problems);
  }
}

function checkArray(schema: Schema, value: unknown, path: string, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push(`${label(path)} must be an array`);
    return;
  }
  const items = schema['items'];
  if (isRecord(items)) value.forEach((entry, i) => check(items, entry, `${path}[${i}]`, problems));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const label = (path: string) => (path === '' ? 'the call' : path);

const join = (path: string, name: string) => (path === '' ? name : `${path}.${name}`);
