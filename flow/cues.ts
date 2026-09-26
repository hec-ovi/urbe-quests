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

/** The inside of a bracketed tag in speech: a cue, or a stage direction such as `leans in`. */
export const TAG_BODY = '[a-zA-Z][a-zA-Z ]{0,31}';

const CUE = `\\[(?:${CUES.join('|')})\\]`;
/** Cues opening the text, a line or a quote, with the whitespace after them. */
const OPENING_CUES = new RegExp(`(^|["“(])(?:${CUE}\\s*)+`, 'gim');
/** Any other cue, with the whitespace before it. */
const INNER_CUE = new RegExp(`\\s*${CUE}`, 'gi');
const TAG = new RegExp(`\\[${TAG_BODY}\\]`);

/** A whole line or sentence as it is shown: without its cues, trimmed. */
export function stripCues(text: string): string {
  return text.replace(OPENING_CUES, '$1').replace(INNER_CUE, '').trim();
}

/** Whether the text carries a bracketed tag, a cue or any other. */
export function hasTag(text: string): boolean {
  return TAG.test(text);
}
