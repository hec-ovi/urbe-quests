import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { FlowValidator } from '../../flow/validate.js';
import { QUEST_TEXT_LIMITS, questTextProblems, textProblems, textWords } from '../QuestText.js';

const fixture = (): QuestlineDefinition => JSON.parse(readFileSync(new URL('../../authoring/fixtures/adaptation.json', import.meta.url), 'utf8')).definition;

describe('quest text reading budgets', () => {
  it.each(Object.entries(QUEST_TEXT_LIMITS))('%s accepts its exact word limit and refuses one more without clipping', (kind, limit) => {
    const atLimit = Array(limit.words).fill('a').join(' ');
    expect(textProblems('field', atLimit, kind as keyof typeof QUEST_TEXT_LIMITS)).toEqual([]);
    expect(textProblems('field', `${atLimit} a`, kind as keyof typeof QUEST_TEXT_LIMITS)).toContain(`field has ${limit.words + 1} words; use at most ${limit.words}`);
  });

  it('counts visible speech, contractions and Unicode; unbroken text cannot evade character limits', () => {
    expect(textWords("[sigh] I'm here, Mira. [whisper] Go on.")).toBe(5);
    expect(textProblems('reply', '[sigh] Hello. [whisper] Sit down. Tell me.', 'speech')).toEqual([]);
    expect(textProblems('hint', 'é'.repeat(91), 'objective')).toContain('hint has 91 characters; use at most 90');
    expect(textProblems('hint', '🌆'.repeat(90), 'objective')).toEqual([]);
    expect(textProblems('hint', 'Talk to\nMira.', 'objective')).toContain('hint must fit one line');
  });

  it('allows an absent scene but refuses blank speech and multiple scene sentences', () => {
    expect(textProblems('scene', '', 'scene')).toEqual([]);
    expect(textProblems('opening', ' [sigh] ', 'speech')).toContain('opening must not be blank');
    expect(textProblems('scene', 'Mira waits. A door shuts.', 'scene')).toContain('scene has 2 sentences; use at most 1');
    expect(textProblems('opening', 'One. Two. Three. Four.', 'speech')).toContain('opening has 4 sentences; use at most 3');
    expect(textProblems('scene', 'Dr. Mira waits here.', 'scene')).toEqual([]);
  });

  it('reports stable field paths, preserves journal prose and leaves legacy flow validation available', () => {
    const quest = fixture();
    quest.premise = 'Story detail. '.repeat(300);
    quest.steps[0]!.narrative.playerHint = 'Talk '.repeat(11).trim();
    const before = JSON.stringify(quest);
    expect(questTextProblems(quest)).toContain('steps.s_request.narrative.playerHint has 11 words; use at most 10');
    expect(JSON.stringify(quest)).toBe(before);
    expect(() => new FlowValidator().validate(quest)).not.toThrow();
  });
});
