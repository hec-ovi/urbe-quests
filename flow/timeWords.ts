/**
 * Named hours in a step's own text. A hint that says "during the slow hour"
 * becomes a window the runtime checks, so the text and the gate cannot drift
 * apart. Clock times bind to the post that holds them, day parts to their post.
 */

import { POST_WINDOWS, type Post } from '../world/venues.js';
import type { QuestStep, TimeWindow } from './schema.js';

const POST_WORDS: [Post, string[]][] = [
  ['evening', [
    'slow hour', 'last call', 'after dark', 'after hours', 'closing time', 'close of service',
    'night shift', 'late shift', 'this evening', 'tonight', 'at night', 'evening', 'nightfall', 'sundown', 'dusk',
  ]],
  ['day', [
    'first light', 'opening hour', 'day shift', 'morning', 'daybreak', 'sunrise', 'dawn',
    'midday', 'afternoon', 'noon', 'lunch', 'breakfast', 'daylight',
  ]],
];

const CLOCK = /\b(?<hour24>[01]?\d|2[0-3]):(?<minute>[0-5]\d)\b|\b(?<hour12>1[0-2]|0?[1-9])\s?(?<half>am|pm)\b/i;

/** One hour wide, for a clock time no post covers. */
const HOUR = 60;

export interface NamedTime {
  /** The words as the text wrote them. */
  phrase: string;
  window: TimeWindow;
}

/** The hour this text names, if it names one. */
export function namedTime(text: string): NamedTime | undefined {
  const lower = text.toLowerCase();
  const clock = CLOCK.exec(text);
  if (clock !== null) {
    const groups = clock.groups ?? {};
    const minuteOfDay =
      groups.hour24 !== undefined
        ? Number(groups.hour24) * 60 + Number(groups.minute)
        : (Number(groups.hour12) % 12) * 60 + (groups.half?.toLowerCase() === 'pm' ? 720 : 0);
    return { phrase: clock[0], window: windowAt(minuteOfDay, clock[0]) };
  }
  const matches = POST_WORDS.flatMap(([post, words]) =>
    words.flatMap((word) => {
      const at = lower.indexOf(word);
      return at < 0 ? [] : [{ post, at, phrase: text.slice(at, at + word.length) }];
    }),
  );
  const first = matches.sort((a, b) => a.at - b.at || b.phrase.length - a.phrase.length)[0];
  if (first === undefined) return undefined;
  return { phrase: first.phrase, window: { label: first.phrase, ...POST_WINDOWS[first.post] } };
}

/** The window a step's own text asks for: the hint first, then what happens in the beat. */
export function namedStepTime(step: QuestStep): NamedTime | undefined {
  return namedTime(step.narrative.playerHint) ?? namedTime(step.narrative.description);
}

function windowAt(minuteOfDay: number, phrase: string): TimeWindow {
  const post = (Object.keys(POST_WINDOWS) as Post[]).find((kind) => {
    const window = POST_WINDOWS[kind];
    return minuteOfDay >= window.startMin && minuteOfDay < window.endMin;
  });
  if (post !== undefined) return { label: phrase, ...POST_WINDOWS[post] };
  return { label: phrase, days: [0, 1, 2, 3, 4, 5, 6], startMin: minuteOfDay, endMin: Math.min(minuteOfDay + HOUR, 1440) };
}
