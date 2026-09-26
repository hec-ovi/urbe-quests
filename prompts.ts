/**
 * Loads a box's prompt .md files. Every prompt, boilerplate and few-shot set
 * lives in a file, never inline; `{{name}}` placeholders take the given values,
 * and a placeholder paragraph given an empty value leaves no gap.
 */

import { readFileSync } from 'node:fs';

export type PromptLoader = (file: string, vars?: Record<string, string | number>) => string;

export function promptLoader(promptsDir: URL): PromptLoader {
  return (file, vars = {}) => {
    const [path, section] = file.split('#');
    let text = readFileSync(new URL(path!, promptsDir), 'utf8');
    if (section !== undefined) {
      const body = text.split(`## ${section}\n`)[1];
      if (body === undefined) throw new Error(`missing prompt section ${file}`);
      text = body.split('\n## ')[0]!.trim();
    }
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    }).replace(/\n{3,}/g, '\n\n');
  };
}
