/**
 * Turns raw model text into the words an NPC says, with its inline cues.
 * Removes think blocks and chat-template tokens (a token after the reply ends
 * it), a speaker tag in front of a line, a transcript the model continues past
 * its own turn, bracketed tags that are not cues, one pair of quotes wrapping
 * the whole reply, and surrounding whitespace. It works on a stream: the
 * pieces `push` and `end` return join to exactly what `cleanReply` returns for
 * the whole text, and no piece splits a cue.
 */

import { CUES, TAG_BODY, type Cue } from '../flow/cues.js';
import { ModelMarkup } from '../ports/markup.js';

interface Stage {
  push(text: string): string;
  end(): string;
  /** True once everything further is dropped. */
  readonly closed?: boolean;
}

/**
 * Looks at the head of every line: `Name:` or `assistant:` in front of the
 * NPC's own words is dropped; `Player:` or `User:` means the model is writing
 * the player's turn, so that line and everything after it is dropped.
 */
class SpeakerTags implements Stage {
  private readonly own: RegExp;
  private readonly other = /^[ \t*]*(player|user)[ \t*]*:/i;
  private readonly longest: number;
  private head = '';
  private lineStart = true;
  private ended = false;

  constructor(names: string[]) {
    const labels = [...names, 'assistant', 'npc'].filter((n) => n.length > 0).map(escape);
    this.own = new RegExp(`^[ \\t*]*(${labels.join('|')})[ \\t*]*:[ \\t*]*`, 'i');
    this.longest = Math.max(...labels.map((l) => l.length)) + 8;
  }

  push(text: string): string {
    let rest = text;
    let out = '';
    while (rest.length > 0 && !this.ended) {
      if (!this.lineStart) {
        const newline = rest.indexOf('\n');
        if (newline < 0) return out + rest;
        out += rest.slice(0, newline + 1);
        rest = rest.slice(newline + 1);
        this.lineStart = true;
        continue;
      }
      this.head += rest;
      rest = '';
      const decided = this.decide(false);
      if (decided === undefined) return out;
      rest = decided;
    }
    return out;
  }

  end(): string {
    let out = '';
    while (!this.ended && this.head.length > 0) out += this.push(this.decide(true)!);
    this.head = '';
    this.lineStart = true;
    this.ended = false;
    return out;
  }

  get closed(): boolean {
    return this.ended;
  }

  /** The line's text once its head is known, or undefined while a tag could still be forming. */
  private decide(final: boolean): string | undefined {
    const head = this.head;
    if (this.other.test(head)) {
      this.ended = true;
      this.head = '';
      return '';
    }
    const own = this.own.exec(head);
    // A tag that reaches the end of the head may still gain the spaces or `**` that close it.
    if (!final && (own ? own[0].length === head.length : !/[:\n]/.test(head) && head.length <= this.longest)) return undefined;
    this.head = '';
    this.lineStart = false;
    return own ? head.slice(own[0].length) : head;
  }
}

const TAG = new RegExp(`^\\[(${TAG_BODY})\\]`);
/** Text that could still grow into a tag. */
const TAG_START = new RegExp(`^\\[(?:${TAG_BODY})?$`);
/** What a model also writes for a cue. */
const CUE_FORMS: Record<string, Cue> = {
  laughs: 'laugh', laughing: 'laugh', chuckles: 'laugh',
  sighs: 'sigh', sighing: 'sigh',
  whispers: 'whisper', whispering: 'whisper',
  angrily: 'angry',
  gasps: 'gasp', gasping: 'gasp',
  cries: 'cry', crying: 'cry', sobs: 'cry', sobbing: 'cry',
};

/**
 * Keeps the cues, each as its name in lower case, and drops any other
 * bracketed tag, a stage direction such as `[leans in]`, with the whitespace
 * before it. A tag split across pieces waits until it is whole.
 */
class Cues implements Stage {
  private held = '';

  push(text: string): string {
    const body = this.held + text;
    let out = '';
    let from = 0;
    let at = body.indexOf('[');
    for (; at >= 0; at = body.indexOf('[', at + 1)) {
      const rest = body.slice(at);
      if (TAG_START.test(rest)) break;
      const tag = TAG.exec(rest);
      if (!tag) continue;
      const cue = cueOf(tag[1]!);
      const before = body.slice(from, at);
      out += cue ? `${before}[${cue}]` : before.trimEnd();
      from = at + tag[0].length;
    }
    // Whitespace waits for what follows it: a dropped tag takes it along.
    const keep = from + body.slice(from, at < 0 ? undefined : at).trimEnd().length;
    this.held = body.slice(keep);
    return out + body.slice(from, keep);
  }

  end(): string {
    const rest = this.held;
    this.held = '';
    return rest;
  }
}

function cueOf(word: string): Cue | undefined {
  const name = word.toLowerCase();
  return CUES.find((cue) => cue === name) ?? CUE_FORMS[name];
}

const QUOTES = /["“”]/;
/** Cues in front of the reply's first word, which a wrapping quote may follow. */
const LEAD = /^(?:\[[a-z]+\]\s*)*/;
/** What may follow a wrapping quote's close: cues and whitespace. */
const TAIL = /^(?:\s*\[[a-z]+\])*\s*$/;

/**
 * Trims the reply and drops one pair of quotes wrapping all of it, cues in
 * front of or behind the pair aside. A reply that opens with a quote is held
 * until its first closing quote: when that quote ends the reply both go,
 * otherwise the text streams with its quotes.
 */
class Wrapping implements Stage {
  private held = '';
  private started = false;
  /** Where the opening quote stands while the reply may still turn out to be wrapped in it. */
  private opening = -1;

  push(text: string): string {
    let body = this.held + text;
    this.held = '';
    if (!this.started) {
      body = body.trimStart();
      const lead = LEAD.exec(body)![0].length;
      if (lead === body.length) {
        this.held = body;
        return '';
      }
      this.started = true;
      if (QUOTES.test(body[lead]!)) this.opening = lead;
    }
    if (this.opening >= 0) {
      const close = this.closing(body);
      if (close < 0 || TAIL.test(body.slice(close + 1))) {
        this.held = body;
        return '';
      }
      this.opening = -1;
    }
    const keep = body.trimEnd().length;
    this.held = body.slice(keep);
    return body.slice(0, keep);
  }

  end(): string {
    let rest = this.started ? '' : this.held;
    if (this.opening >= 0) {
      const close = this.closing(this.held);
      rest = this.held.slice(0, this.opening) + (close < 0
        ? this.held.slice(this.opening + 1)
        : this.held.slice(this.opening + 1, close) + this.held.slice(close + 1));
    }
    this.held = '';
    this.started = false;
    this.opening = -1;
    return rest.trim();
  }

  /** Where the quote closing the opening one stands, or -1. */
  private closing(body: string): number {
    const close = body.slice(this.opening + 1).search(QUOTES);
    return close < 0 ? -1 : this.opening + 1 + close;
  }
}

export class ReplyCleaner {
  private readonly stages: Stage[];

  /** @param names what the NPC is called, so a leading `Name:` tag is recognised */
  constructor(names: string[] = []) {
    this.stages = [new ModelMarkup(), new SpeakerTags(names), new Cues(), new Wrapping()];
  }

  /** True once the model has moved past the NPC's turn, so the rest of its text can only be dropped. */
  get done(): boolean {
    return this.stages.some((stage) => stage.closed === true);
  }

  /** The cleaned text that is certain so far. */
  push(text: string): string {
    return this.stages.reduce((piece, stage) => stage.push(piece), text);
  }

  /** The rest, once the model has finished. The cleaner is then ready for a new reply. */
  end(): string {
    let piece = '';
    for (const stage of this.stages) piece = stage.push(piece) + stage.end();
    return piece;
  }
}

/** The spoken words in a whole model reply, with their cues. */
export function cleanReply(text: string, names: string[] = []): string {
  const cleaner = new ReplyCleaner(names);
  return cleaner.push(text) + cleaner.end();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
