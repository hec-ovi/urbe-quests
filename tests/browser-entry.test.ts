/**
 * The browser entry's promise, checked the only way that fails early: walk
 * every module reachable from runtime.ts and let no specifier out of the box.
 * The engine loads dist/runtime.js in a page, where one node: import (a
 * prompt file read behind a helper) breaks the page and not a test.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('../runtime.ts', import.meta.url));

/** `import ... from 'x'`, `export ... from 'x'` and side-effect imports; type-only ones vanish at build time. */
const FROM = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(FROM)) {
    if (!/^type\b/.test(match[1]!)) found.push(match[2]!);
  }
  for (const match of source.matchAll(SIDE_EFFECT)) found.push(match[1]!);
  return found;
}

/** Follows relative imports from the entry; anything else is what the test is looking for. */
function outsideSpecifiers(entry: string): string[] {
  const seen = new Set<string>();
  const outside = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        outside.add(specifier);
        continue;
      }
      const base = resolve(dirname(file), specifier).replace(/\.js$/, '');
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}/index.ts`;
      expect(existsSync(target), `${file} imports ${specifier}`).toBe(true);
      walk(target);
    }
  };
  walk(entry);
  return [...outside];
}

describe('runtime.ts, the browser entry', () => {
  it('reaches nothing outside the box: no node builtin, no package', () => {
    expect(outsideSpecifiers(ENTRY)).toEqual([]);
  });
});
