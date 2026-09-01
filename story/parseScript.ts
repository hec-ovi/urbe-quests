/** Deterministic, tolerant parser for the script pass format; enforces the minimums. */

import { ProseShortfall, sectionNamed, splitSections, titleOf } from './headings.js';
import { MOVEMENTS, type MovementName, type Passage, type ScriptCharacter, type ScriptMinimums, type StoryScript } from './schema.js';

const CARD_FIELDS = ['role', 'background', 'want', 'voice'] as const;
type CardField = (typeof CARD_FIELDS)[number];

export function parseScript(raw: string, prompt: string, minimums: ScriptMinimums): StoryScript {
  const problems: string[] = [];
  const sections = splitSections(raw, 2);

  const title = titleOf(raw);
  if (title.length === 0) problems.push('no "# Title" line');
  const logline = sectionNamed(sections, 'logline')?.body ?? '';
  if (logline.length === 0) problems.push('"## Logline" missing or empty');

  const characters = splitSections(sectionNamed(sections, 'characters')?.body ?? '', 3).map(parseCharacter);
  if (characters.length < minimums.characters) {
    problems.push(`${characters.length} character cards under "## Characters", at least ${minimums.characters} needed`);
  }

  const movements = {} as Record<MovementName, Passage[]>;
  for (const name of MOVEMENTS) {
    const passages = splitSections(sectionNamed(sections, name)?.body ?? '', 3)
      .map((s) => ({ heading: s.heading, text: s.body }))
      .filter((p) => p.text.length > 0);
    if (passages.length < minimums.passagesPerMovement) {
      problems.push(`${passages.length} passages under "## ${capitalize(name)}", at least ${minimums.passagesPerMovement} needed`);
    }
    movements[name] = passages;
  }

  if (problems.length > 0) throw new ProseShortfall(problems);
  return { prompt, title, logline, characters, movements };
}

/** Labeled lines (Role:, Background:, Want:, Voice:) fill the card; unlabeled text goes to background. */
function parseCharacter(section: { heading: string; body: string }): ScriptCharacter {
  const card: Record<CardField, string[]> = { role: [], background: [], want: [], voice: [] };
  let current: CardField = 'background';
  for (const line of section.body.split('\n')) {
    const labeled = /^\s*\**(role|background|want|voice)\**\s*:\**\s*(.*)$/i.exec(line);
    if (labeled !== null) {
      current = labeled[1]!.toLowerCase() as CardField;
      card[current].push(labeled[2]!);
    } else {
      card[current].push(line);
    }
  }
  const text = (field: CardField) => card[field].join('\n').trim();
  return { name: section.heading, role: text('role'), background: text('background'), want: text('want'), voice: text('voice') };
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
