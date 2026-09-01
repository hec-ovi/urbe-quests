/** Deterministic, tolerant parser for the situations pass format; enforces the minimum count. */

import { ProseShortfall, sectionNamed, splitSections } from './headings.js';
import type { Situation, SituationCharacter, SituationMinimums } from './schema.js';

const PARTS = ['presentation', 'development', 'conflict', 'resolution'] as const;

export function parseSituations(raw: string, minimums: SituationMinimums): Situation[] {
  const problems: string[] = [];
  const situations: Situation[] = [];

  for (const block of splitSections(raw, 2)) {
    const parts = splitSections(block.body, 3);
    const part = (name: (typeof PARTS)[number]): string => {
      const body = sectionNamed(parts, name)?.body ?? '';
      if (body.length === 0) problems.push(`situation "${block.heading}": "### ${name}" missing or empty`);
      return body;
    };
    situations.push({
      situationId: `sit_${situations.length + 1}`,
      title: block.heading,
      characters: parseCharacters(sectionNamed(parts, 'characters')?.body ?? ''),
      presentation: part('presentation'),
      development: part('development'),
      conflict: part('conflict'),
      resolution: part('resolution'),
    });
  }
  if (situations.length < minimums.situations) {
    problems.push(`${situations.length} situations, at least ${minimums.situations} needed`);
  }

  if (problems.length > 0) throw new ProseShortfall(problems);
  return situations;
}

/** "- Name: who they are" lines. */
function parseCharacters(body: string): SituationCharacter[] {
  const characters: SituationCharacter[] = [];
  for (const line of body.split('\n')) {
    const entry = /^\s*[-*]\s*\**([^:*]+?)\**\s*:\s*(.+)$/.exec(line);
    if (entry !== null) characters.push({ name: entry[1]!.trim(), description: entry[2]!.trim() });
  }
  return characters;
}
