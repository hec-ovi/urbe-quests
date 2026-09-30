/** Authoring limits for text shown during play. Saved definitions remain readable. */
import { stripCues } from '../flow/cues.js';
import type { QuestlineDefinition, QuestStep } from '../flow/schema.js';

export const QUEST_TEXT_LIMITS = {
  title: { words: 6, characters: 60 },
  prologue: { words: 45, characters: 300, sentences: 3 },
  objective: { words: 10, characters: 90, sentences: 1 },
  scene: { words: 24, characters: 180, sentences: 1 },
  stake: { words: 24, characters: 180, sentences: 1 },
  speech: { words: 45, characters: 300, sentences: 3 },
  choice: { words: 12, characters: 100, sentences: 2 },
} as const;

type TextKind = keyof typeof QUEST_TEXT_LIMITS;
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Whitespace-separated visible words; contractions and hyphenated words count once. */
const wordCount = (visible: string): number => visible ? visible.split(/\s+/u).length : 0;
export function textWords(text: string): number {
  return wordCount(stripCues(text));
}

/** Never truncate: each failure names the field and limit for an author's repair. */
export function textProblems(path: string, text: string, kind: TextKind): string[] {
  const visible = kind === 'speech' ? stripCues(text) : text.trim();
  const limit = QUEST_TEXT_LIMITS[kind];
  const problems: string[] = [];
  const words = wordCount(visible);
  const characters = [...visible].length;
  if (!visible && kind !== 'scene') problems.push(`${path} must not be blank`);
  if (words > limit.words) problems.push(`${path} has ${words} words; use at most ${limit.words}`);
  if (characters > limit.characters) problems.push(`${path} has ${characters} characters; use at most ${limit.characters}`);
  if ('sentences' in limit) {
    const count = [...sentences.segment(visible.replace(/\b(Dr|Mr|Mrs|Ms|Prof|St)\.(?=\s+\p{Lu})/gu, '$1'))].filter((part) => /[\p{L}\p{N}]/u.test(part.segment)).length;
    if (count > limit.sentences) problems.push(`${path} has ${count} sentences; use at most ${limit.sentences}`);
  }
  if (kind !== 'prologue' && /[\r\n\u2028\u2029]/u.test(visible)) problems.push(`${path} must fit one line`);
  return problems;
}

export function questHeadingProblems(quest: Pick<QuestlineDefinition, 'title' | 'prologue'>): string[] {
  return [
    ...textProblems('title', quest.title, 'title'),
    ...(!quest.prologue?.trim() ? [] : textProblems('prologue', quest.prologue, 'prologue')),
  ];
}

export function stepTextProblems(step: QuestStep): string[] {
  const path = `steps.${step.stepId}`;
  return [
    ...textProblems(`${path}.narrative.playerHint`, step.narrative.playerHint, 'objective'),
    ...textProblems(`${path}.narrative.description`, step.narrative.description, 'scene'),
    ...(step.narrative.stake === undefined ? [] : textProblems(`${path}.narrative.stake`, step.narrative.stake, 'stake')),
    ...(step.dialogue === undefined ? [] : [
      ...textProblems(`${path}.dialogue.opening`, step.dialogue.opening, 'speech'),
      ...step.dialogue.choices.flatMap((choice) => [
        ...textProblems(`${path}.dialogue.choices.${choice.id}.text`, choice.text, 'choice'),
        ...textProblems(`${path}.dialogue.choices.${choice.id}.reply`, choice.reply, 'speech'),
      ]),
    ]),
  ];
}

/** Creation/adaptation audit, deliberately separate from the legacy flow/save validator. */
export function questTextProblems(quest: QuestlineDefinition): string[] {
  return [
    ...questHeadingProblems(quest),
    ...quest.steps.flatMap(stepTextProblems),
    ...quest.acts.flatMap((act) => textProblems(`acts.${act.actId}.title`, act.title, 'title')),
    ...quest.endings.flatMap((ending) => textProblems(`endings.${ending.endingId}.title`, ending.title, 'title')),
  ];
}
