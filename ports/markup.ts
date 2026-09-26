/**
 * Model markup that is never meant as text: `<think>` blocks and chat-template
 * tokens such as `<|im_end|>`. Works on a stream: the pieces `push` and `end`
 * return join to exactly what the whole text gives.
 */

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
/** A template token: `<|` and a short name of word characters, then `|>`. */
const TOKEN = /^<\|([\w.-]{1,28})\|>/;
/** Text that could still grow into a template token. */
const TOKEN_START = /^<\|[\w.-]{0,28}\|?$/;

/**
 * Drops `<think>` blocks (an unclosed one to the end), stray `</think>` tags and
 * template tokens. Before any text, a start token such as `<|im_start|>` drops
 * the role line it opens. After text, a template token means the model ran
 * into another turn: the text ends there and `closed` turns true.
 */
export class ModelMarkup {
  private held = '';
  private thinking = false;
  private roleLine = false;
  private wrote = false;
  private ended = false;

  /** True once everything further is dropped. */
  get closed(): boolean {
    return this.ended;
  }

  push(text: string): string {
    if (this.ended) return '';
    let rest = this.held + text;
    this.held = '';
    let out = '';
    for (;;) {
      if (this.roleLine) {
        const newline = rest.indexOf('\n');
        if (newline < 0) return this.emit(out);
        rest = rest.slice(newline + 1);
        this.roleLine = false;
      }
      if (this.thinking) {
        const close = rest.indexOf(THINK_CLOSE);
        if (close < 0) {
          this.held = partialSuffix(rest, THINK_CLOSE);
          return this.emit(out);
        }
        rest = rest.slice(close + THINK_CLOSE.length);
        this.thinking = false;
        continue;
      }
      const at = rest.indexOf('<');
      if (at < 0) return this.emit(out + rest);
      out += rest.slice(0, at);
      rest = rest.slice(at);
      const token = TOKEN.exec(rest);
      if (rest.startsWith(THINK_OPEN)) {
        this.thinking = true;
        rest = rest.slice(THINK_OPEN.length);
      } else if (rest.startsWith(THINK_CLOSE)) {
        rest = rest.slice(THINK_CLOSE.length);
      } else if (token) {
        if (this.wrote || /\S/.test(out)) {
          this.ended = true;
          return this.emit(out);
        }
        rest = rest.slice(token[0].length);
        this.roleLine = token[1]!.includes('start');
      } else if (TOKEN_START.test(rest) || THINK_OPEN.startsWith(rest) || THINK_CLOSE.startsWith(rest)) {
        this.held = rest;
        return this.emit(out);
      } else {
        out += '<';
        rest = rest.slice(1);
      }
    }
  }

  /** The rest once the model has finished; the stage is then ready for new text. */
  end(): string {
    const rest = this.thinking || this.roleLine || this.ended || this.held.startsWith('<|') ? '' : this.held;
    this.held = '';
    this.thinking = this.roleLine = this.wrote = this.ended = false;
    return rest;
  }

  private emit(out: string): string {
    if (/\S/.test(out)) this.wrote = true;
    return out;
  }
}

/** Text without think blocks and template tokens, trimmed: for model output that is not speech. */
export function cleanMarkup(text: string): string {
  const markup = new ModelMarkup();
  return (markup.push(text) + markup.end()).trim();
}

/** The longest end of `text` that could still grow into `tag`. */
function partialSuffix(text: string, tag: string): string {
  for (let length = Math.min(text.length, tag.length - 1); length > 0; length--) {
    if (tag.startsWith(text.slice(-length))) return text.slice(-length);
  }
  return '';
}
