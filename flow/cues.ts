/**
 * Inline emotion cues: a sound or a manner an NPC line carries at the point it
 * happens, written in square brackets, as in `Fine. [sigh] Go on, then.`. A
 * voice performs them and a screen shows the line without them. One list
 * serves free-chat replies, authored quest lines and their hosts.
 */

export const CUES = ['laugh', 'sigh', 'whisper', 'angry', 'gasp', 'cry'] as const;

export type Cue = (typeof CUES)[number];

/** The cues as a prompt lists them: `[laugh] [sigh] ...`. */
export const CUE_LIST = CUES.map((cue) => `[${cue}]`).join(' ');

/** One cue as the list writes it, as a pattern. */
export const CUE_TAG = `\\[(?:${CUES.join('|')})\\]`;

/** The inside of a bracketed tag in speech: a cue, or a stage direction such as `leans in` or `voice low, almost a whisper`. */
export const TAG_BODY = "[a-zA-Z][a-zA-Z ,'’-]{0,31}";

/** A bracketed tag, its brackets possibly doubled as in `[[sigh]]`; group 1 is its inside. */
export const TAG = `\\[+(${TAG_BODY})\\]+`;

/** Cues opening the text, a line or a quote, with the whitespace after them. */
const OPENING_CUES = new RegExp(`(^[ \\t]*|[“‘(]|(?:^|\\s)["'])(?:${CUE_TAG}\\s*)+`, 'gimu');
/** Any other cue with the whitespace before it; the lookahead catches a letter or digit right after it. */
const INNER_CUE = new RegExp(`(\\s*)${CUE_TAG}(?=([\\p{L}\\p{N}])?)`, 'giu');
const ANY_TAG = new RegExp(TAG);
const TAGS = new RegExp(TAG, 'g');
const WRITTEN = new Set(CUES.map((cue) => `[${cue}]`));

/**
 * A whole line or sentence as it is shown: without its cues, trimmed. A cue
 * goes with the whitespace before it, or after it where it opens the text, a
 * line or a quote; a cue between two words leaves one space.
 */
export function stripCues(text: string): string {
  return text
    .replace(OPENING_CUES, '$1')
    .replace(INNER_CUE, (_cue, space: string, word?: string) => (word === undefined ? '' : space || ' '))
    .trim();
}

/** Whether the text carries a bracketed tag, a cue or any other. */
export function hasTag(text: string): boolean {
  return ANY_TAG.test(text);
}

/** The bracketed tags in a text other than cues written as the list writes them: `[Sigh]`, `[[sigh]]`, `[leans in]`. */
export function foreignTags(text: string): string[] {
  return (text.match(TAGS) ?? []).filter((tag) => !WRITTEN.has(tag));
}
