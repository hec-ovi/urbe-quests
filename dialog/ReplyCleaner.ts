/**
 * Turns raw model text into the words an NPC says, with its inline cues.
 * Removes think blocks and chat-template tokens (a token after the reply ends
 * it), a speaker tag in front of a line, a transcript the model continues past
 * its own turn, bracketed tags that are not cues, one pair of quotes wrapping
 * the whole reply, and surrounding whitespace. It works on a stream: the
 * pieces `push` and `end` return join to exactly what `cleanReply` returns for
 * the whole text, and no piece splits a cue.
 */

import { CUE_TAG, CUES, TAG, TAG_BODY, type Cue } from '../flow/cues.js';
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

/** A tag at the head of the text; group 1 is its inside. */
const TAG_HEAD = new RegExp(`^${TAG}`);
/** A head that may still grow into a tag, or a whole tag that may still gain a closing bracket. */
const PENDING = new RegExp(`^\\[+(?:${TAG_BODY}\\]*)?$`);
/** The open part of a tag ending the text, which a tag dropped after it may complete: `[laugh` in `[laugh [nods]ing]`. */
const OPEN = new RegExp(`\\[+(?:${TAG_BODY})?$`);
/** What a model also writes for a cue. */
const FORMS: Record<Cue, string[]> = {
  laugh: ['laughs', 'laughing', 'laughed', 'laughter', 'chuckle', 'chuckles', 'chuckling', 'chuckled', 'giggle', 'giggles', 'giggling'],
  sigh: ['sighs', 'sighing', 'sighed'],
  whisper: ['whispers', 'whispering', 'whispered', 'hushed'],
  angry: ['angrily', 'anger', 'furious', 'furiously'],
  gasp: ['gasps', 'gasping', 'gasped'],
  cry: ['cries', 'crying', 'cried', 'sob', 'sobs', 'sobbing', 'sobbed', 'weeps', 'weeping', 'tearful', 'tearfully'],
};
const CUE_FORMS = new Map<string, Cue>(CUES.flatMap((cue) => [cue, ...FORMS[cue]].map((form) => [form, cue] as const)));

/**
 * Keeps the cues, each as its name in lower case, and drops any other
 * bracketed tag, a stage direction such as `[leans in]`, with the whitespace
 * before it. Doubled brackets make one tag. A dropped tag joins the text
 * around it, which is scanned again, so no tag outside the list is left. A
 * tag split across pieces, and the text it may still join, wait until settled.
 */
class Cues implements Stage {
  private held = '';

  push(text: string): string {
    return this.scan(this.held + text, false);
  }

  end(): string {
    return this.scan(this.held, true);
  }

  private scan(text: string, final: boolean): string {
    let body = text;
    let at = body.indexOf('[');
    while (at >= 0) {
      const rest = body.slice(at);
      if (!final && PENDING.test(rest)) break;
      const tag = TAG_HEAD.exec(rest);
      if (tag === null) {
        at = body.indexOf('[', at + 1);
        continue;
      }
      const cue = cueOf(tag[1]!);
      if (cue !== undefined) {
        body = `${body.slice(0, at)}[${cue}]${rest.slice(tag[0].length)}`;
        at = body.indexOf('[', at + cue.length + 2);
        continue;
      }
      // A dropped tag takes the whitespace before it; the text it joins may close a tag it sat in, so the scan goes back there.
      const before = body.slice(0, at).trimEnd();
      body = before + rest.slice(tag[0].length);
      at = OPEN.exec(before)?.index ?? body.indexOf('[', before.length);
    }
    // Hold what may still change: a pending tag, whitespace a later tag takes along, and an open tag part it may join.
    let keep = final || at < 0 ? body.length : at;
    while (!final) {
      keep = body.slice(0, keep).trimEnd().length;
      const open = OPEN.exec(body.slice(0, keep));
      if (open === null) break;
      keep = open.index;
    }
    this.held = body.slice(keep);
    return body.slice(0, keep);
  }
}

/** The cue a tag stands for: a cue or a form of it as the tag's first or last word, as in `sighs heavily` or `a bitter laugh`. */
function cueOf(inside: string): Cue | undefined {
  const words = inside.toLowerCase().match(/[a-z]+/g) ?? [];
  return CUE_FORMS.get(words[0] ?? '') ?? CUE_FORMS.get(words.at(-1) ?? '');
}

const QUOTES = /["“”]/;
/** Cues in front of the reply's first word, which a wrapping quote may follow. */
const LEAD = new RegExp(`^(?:${CUE_TAG}\\s*)*`);
/** What may follow a wrapping quote's close: cues and whitespace. */
const TAIL = new RegExp(`^(?:\\s*${CUE_TAG})*\\s*$`);

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
