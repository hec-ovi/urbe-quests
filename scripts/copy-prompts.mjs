/** Copies Markdown runtime assets beside compiled modules in dist/. */
import { cpSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.git']);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry === 'prompts' || (entry === 'skills' && dir === 'authoring')) {
      cpSync(path, join('dist', path), { recursive: true });
    }
    else walk(path);
  }
}

walk('.');
