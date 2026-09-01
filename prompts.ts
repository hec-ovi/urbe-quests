/**
 * Loads a box's prompt .md files. Every prompt, boilerplate and few-shot set
 * lives in a file, never inline; `{{name}}` placeholders take the given values.
 */

import { readFileSync } from 'node:fs';

export type PromptLoader = (file: string, vars?: Record<string, string | number>) => string;

export function promptLoader(promptsDir: URL): PromptLoader {
  return (file, vars = {}) => {
    const text = readFileSync(new URL(file, promptsDir), 'utf8');
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  };
}
