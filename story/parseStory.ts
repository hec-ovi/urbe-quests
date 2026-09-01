/** Deterministic parser for the story pass markdown format. */

import type { StoryDocument } from './schema.js';

export class StoryParseError extends Error {
  constructor(readonly missing: string[]) {
    super(`story output missing sections: ${missing.join(', ')}`);
    this.name = 'StoryParseError';
  }
}

const MOVEMENTS = ['introduction', 'development', 'conflict', 'resolution'] as const;

export function parseStory(raw: string, theme: string): StoryDocument {
  const sections = new Map<string, string>();
  const parts = raw.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim().toLowerCase();
    const body = (newline === -1 ? '' : part.slice(newline + 1)).trim();
    sections.set(heading, body);
  }

  const missing: string[] = [];
  const movement = (name: (typeof MOVEMENTS)[number]): string => {
    const body = sections.get(name) ?? '';
    if (body.length === 0) missing.push(name);
    return body;
  };

  const mainline = {
    introduction: movement('introduction'),
    development: movement('development'),
    conflict: movement('conflict'),
    resolution: movement('resolution'),
  };

  const sideRaw = sections.get('side quests') ?? '';
  const sidePremises = sideRaw
    .split(/^###\s+/m)
    .slice(1)
    .map((block, index) => {
      const newline = block.indexOf('\n');
      const title = (newline === -1 ? block : block.slice(0, newline)).trim();
      const premise = (newline === -1 ? '' : block.slice(newline + 1)).trim();
      return { premiseId: `sp_${index + 1}`, title, premise };
    })
    .filter((p) => p.title.length > 0 && p.premise.length > 0);
  if (sidePremises.length === 0) missing.push('side quests');

  if (missing.length > 0) throw new StoryParseError(missing);
  return { theme, mainline, sidePremises };
}
