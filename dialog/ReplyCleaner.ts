/**
 * Turns raw model text into the words an NPC says. Removes think blocks and
 * chat-template tokens (a token after the reply ends it), a speaker tag in
 * front of a line, a transcript the model continues past its own turn, one
 * pair of quotes wrapping the whole reply, and surrounding whitespace. It works
 * on a stream: the pieces `push` and `end` return join to exactly what
 * `cleanReply` returns for the whole text.
 */

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

const QUOTES = /["“”]/;

/**
 * Trims the reply and drops one pair of quotes wrapping all of it. A reply
 * that opens with a quote is held until its first closing quote: when that
 * quote ends the reply both go, otherwise the text streams with its quotes.
 */
class Wrapping implements Stage {
  private held = '';
  private started = false;
  /** The opening quote while the reply may still turn out to be wrapped in it. */
  private opening = '';

  push(text: string): string {
    let body = this.held + text;
    this.held = '';
    if (!this.started) {
      body = body.trimStart();
      if (body.length === 0) return '';
      this.started = true;
      if (QUOTES.test(body[0]!)) {
        this.opening = body[0]!;
        body = body.slice(1);
      }
    }
    if (this.opening) {
      const close = body.search(QUOTES);
      if (close < 0 || body.slice(close + 1).trim().length === 0) {
        this.held = body;
        return '';
      }
      body = this.opening + body;
      this.opening = '';
    }
    const keep = body.trimEnd().length;
    this.held = body.slice(keep);
    return body.slice(0, keep);
  }

  end(): string {
    const close = this.held.search(QUOTES);
    const rest = this.opening ? this.held.slice(0, close < 0 ? undefined : close).trim() : '';
    this.held = this.opening = '';
    this.started = false;
    return rest;
  }
}

export class ReplyCleaner {
  private readonly stages: Stage[];

  /** @param names what the NPC is called, so a leading `Name:` tag is recognised */
  constructor(names: string[] = []) {
    this.stages = [new ModelMarkup(), new SpeakerTags(names), new Wrapping()];
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

/** The spoken words in a whole model reply. */
export function cleanReply(text: string, names: string[] = []): string {
  const cleaner = new ReplyCleaner(names);
  return cleaner.push(text) + cleaner.end();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
