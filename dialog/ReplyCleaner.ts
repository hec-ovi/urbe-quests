/**
 * Turns raw model text into the words an NPC says. Removes think blocks and
 * chat-template tokens, a speaker tag in front of a line, a transcript the
 * model continues past its own turn, one pair of quotes wrapping the whole
 * reply, and surrounding whitespace. It works on a stream: the pieces `push`
 * and `end` return join to exactly what `cleanReply` returns for the whole text.
 */

interface Stage {
  push(text: string): string;
  end(): string;
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const TOKEN_OPEN = '<|';
/** Template tokens are short (`<|im_end|>`); a longer `<|` run is literal text. */
const TOKEN_LONGEST = 32;
const MARKUP = [THINK_OPEN, THINK_CLOSE, TOKEN_OPEN];

/** Drops `<think>` blocks, stray `</think>` tags and `<|...|>` template tokens. */
class Markup implements Stage {
  private held = '';
  private thinking = false;

  push(text: string): string {
    let rest = this.held + text;
    let out = '';
    for (;;) {
      if (this.thinking) {
        const close = rest.indexOf(THINK_CLOSE);
        if (close < 0) {
          this.held = partialSuffix(rest, THINK_CLOSE);
          return out;
        }
        rest = rest.slice(close + THINK_CLOSE.length);
        this.thinking = false;
        continue;
      }
      const at = rest.indexOf('<');
      if (at < 0) {
        this.held = '';
        return out + rest;
      }
      out += rest.slice(0, at);
      rest = rest.slice(at);
      if (rest.startsWith(THINK_OPEN)) {
        this.thinking = true;
        rest = rest.slice(THINK_OPEN.length);
      } else if (rest.startsWith(THINK_CLOSE)) {
        rest = rest.slice(THINK_CLOSE.length);
      } else if (rest.startsWith(TOKEN_OPEN)) {
        const close = rest.indexOf('|>');
        if (close >= 0) {
          rest = rest.slice(close + 2);
        } else if (rest.length <= TOKEN_LONGEST) {
          this.held = rest;
          return out;
        } else {
          out += '<';
          rest = rest.slice(1);
        }
      } else if (MARKUP.some((tag) => tag.startsWith(rest))) {
        this.held = rest;
        return out;
      } else {
        out += '<';
        rest = rest.slice(1);
      }
    }
  }

  end(): string {
    const rest = this.thinking || this.held.startsWith(TOKEN_OPEN) ? '' : this.held;
    this.held = '';
    this.thinking = false;
    return rest;
  }
}

/** The longest end of `text` that could still grow into `tag`. */
function partialSuffix(text: string, tag: string): string {
  for (let length = Math.min(text.length, tag.length - 1); length > 0; length--) {
    if (tag.startsWith(text.slice(-length))) return text.slice(-length);
  }
  return '';
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
  private closed = false;

  constructor(names: string[]) {
    const labels = [...names, 'assistant', 'npc'].filter((n) => n.length > 0).map(escape);
    this.own = new RegExp(`^[ \\t*]*(${labels.join('|')})[ \\t*]*:[ \\t*]*`, 'i');
    this.longest = Math.max(...labels.map((l) => l.length)) + 8;
  }

  push(text: string): string {
    let rest = text;
    let out = '';
    while (rest.length > 0 && !this.closed) {
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
    while (!this.closed && this.head.length > 0) out += this.push(this.decide(true)!);
    this.head = '';
    this.lineStart = true;
    this.closed = false;
    return out;
  }

  /** The line's text once its head is known, or undefined while a tag could still be forming. */
  private decide(final: boolean): string | undefined {
    const head = this.head;
    if (this.other.test(head)) {
      this.closed = true;
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

/** Trims the reply and drops one pair of quotes wrapping all of it. */
class Wrapping implements Stage {
  private held = '';
  private started = false;
  private opened = false;
  private inner = false;

  push(text: string): string {
    let body = this.held + text;
    this.held = '';
    if (!this.started) {
      body = body.trimStart();
      if (!this.opened && QUOTES.test(body.charAt(0))) {
        this.opened = true;
        body = body.slice(1).trimStart();
      }
      if (body.length === 0) return '';
      this.started = true;
    }
    const keep = /[\s"“”]*$/.exec(body)!.index;
    const out = body.slice(0, keep);
    this.held = body.slice(keep);
    if (this.opened && QUOTES.test(out)) this.inner = true;
    return out;
  }

  end(): string {
    let tail = this.held.trimEnd();
    if (this.opened && !this.inner && QUOTES.test(tail.slice(-1))) tail = tail.slice(0, -1).trimEnd();
    this.held = '';
    this.started = this.opened = this.inner = false;
    return tail;
  }
}

export class ReplyCleaner {
  private readonly stages: Stage[];

  /** @param names what the NPC is called, so a leading `Name:` tag is recognised */
  constructor(names: string[] = []) {
    this.stages = [new Markup(), new SpeakerTags(names), new Wrapping()];
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
