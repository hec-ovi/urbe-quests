/**
 * Per-NPC conversation memory in tiers: a verbatim tail, and older windows
 * folded into compact digest notes by the injected LLM. Serializable so
 * memory survives saves.
 */

import { QuestError } from '../errors.js';
import type { LLMPort } from '../ports/llm.js';
import { cleanMarkup } from '../ports/markup.js';
import { promptLoader } from '../prompts.js';
import type { DialogTurn, MemorySnapshot } from './schema.js';

/** An overheard note keeps this many of the newest lines of one talk, each cut to OVERHEARD_CHARS. */
const OVERHEARD_LINES = 4;
const OVERHEARD_CHARS = 160;
/** One line of an overheard note: `The player said: "…"` or `Mira Chen said: "…"`. */
export interface HeardLine {
  who: string;
  text: string;
}

export interface MemoryStoreOptions {
  /** Verbatim turns kept before folding kicks in. */
  tailSize?: number;
  /** Oldest turns folded per compaction. */
  foldSize?: number;
}

interface Memory extends MemorySnapshot {
  /** The fold in flight, so one NPC never folds twice at once. */
  folding?: Promise<void>;
}

const SUMMARIZE_PROMPT = promptLoader(new URL('./prompts/', import.meta.url))('summarize.md');

export class MemoryStore {
  private readonly memories = new Map<string, Memory>();
  private readonly tailSize: number;
  private readonly foldSize: number;

  constructor(
    private readonly llm: LLMPort,
    options: MemoryStoreOptions = {},
  ) {
    this.tailSize = options.tailSize ?? 12;
    this.foldSize = options.foldSize ?? 6;
  }

  /**
   * Stores the turns at once and returns the fold they start. Folded turns
   * leave the tail only when their note is written, so context read meanwhile
   * still holds them; a failed fold (a provider error or an empty note) keeps
   * them for the next record to retry.
   */
  record(npcId: string, turns: DialogTurn[]): Promise<void> {
    const memory = this.memory(npcId);
    memory.turns.push(...turns);
    if (memory.folding === undefined && memory.turns.length > this.tailSize) {
      memory.folding = this.fold(memory).finally(() => {
        memory.folding = undefined;
      });
    }
    return memory.folding ?? Promise.resolve();
  }

  snapshot(npcId: string): MemorySnapshot {
    const memory = this.memory(npcId);
    return {
      digest: [...memory.digest], turns: [...memory.turns],
      ...(memory.heardAtMin === undefined ? {} : { heardAtMin: memory.heardAtMin }),
      ...(memory.life === undefined ? {} : { life: memory.life }),
    };
  }

  /** This person's life so far: the one kept, else `tell()` told now and kept from then on. */
  life(npcId: string, tell: () => string): string {
    const memory = this.memory(npcId);
    memory.life ??= tell();
    return memory.life;
  }

  /**
   * Notes what this person overheard of the player talking to somebody else,
   * as one short note of its own: `header` says who talked (marked as other
   * people's words), then the newest OVERHEARD_LINES lines of that talk, each
   * cut to OVERHEARD_CHARS. While the same talk goes on, its note stays the
   * newest and is written again with the new lines instead of a second note.
   */
  overhear(npcId: string, header: string, lines: HeardLine[], atMin: number): void {
    const memory = this.memory(npcId);
    const last = memory.digest.at(-1);
    const earlier = last !== undefined && last.startsWith(`${header} `) ? heardLines(last.slice(header.length), lines.map((line) => line.who)) : [];
    if (earlier.length > 0) memory.digest.pop();
    const kept = [...earlier, ...lines.map((line) => ({ who: line.who, text: cut(line.text) }))].filter((line) => line.text.length > 0).slice(-OVERHEARD_LINES);
    if (kept.length === 0) return;
    memory.digest.push(`${header} ${kept.map((line) => `${line.who} said: "${line.text}"`).join(' ')}`);
    memory.heardAtMin = Math.max(memory.heardAtMin ?? atMin, atMin);
  }

  serialize(): Record<string, MemorySnapshot> {
    return Object.fromEntries([...this.memories.keys()].map((npcId) => [npcId, this.snapshot(npcId)]));
  }

  restore(data: Record<string, MemorySnapshot>): void {
    this.memories.clear();
    for (const [npcId, snapshot] of Object.entries(data)) {
      this.memories.set(npcId, {
        digest: [...snapshot.digest],
        turns: [...snapshot.turns],
        ...(snapshot.heardAtMin === undefined ? {} : { heardAtMin: snapshot.heardAtMin }),
        ...(snapshot.life === undefined ? {} : { life: snapshot.life }),
      });
    }
  }

  private async fold(memory: Memory): Promise<void> {
    while (memory.turns.length > this.tailSize) {
      const folded = memory.turns.slice(0, this.foldSize);
      const transcript = folded.map((t) => `${t.speaker === 'player' ? 'them' : 'you'}: ${t.text}`).join('\n');
      const note = cleanMarkup(await this.llm.complete({ system: SUMMARIZE_PROMPT, prompt: transcript }));
      if (note.length === 0) throw new QuestError('E_LLM', 'the model wrote no memory note');
      memory.turns.splice(0, folded.length);
      memory.digest.push(note);
    }
  }

  private memory(npcId: string): Memory {
    let memory = this.memories.get(npcId);
    if (!memory) {
      memory = { digest: [], turns: [] };
      this.memories.set(npcId, memory);
    }
    return memory;
  }
}

/** A line as an overheard note quotes it: no double quotes inside, cut at a word to OVERHEARD_CHARS. */
function cut(text: string): string {
  const plain = text.replace(/["\u201c\u201d]/g, "'").replace(/\s+/g, ' ').trim();
  if (plain.length <= OVERHEARD_CHARS) return plain;
  const head = plain.slice(0, OVERHEARD_CHARS - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > OVERHEARD_CHARS / 2 ? head.slice(0, space) : head).replace(/[\s,;:.]+$/, '')}\u2026`;
}

/** The lines an overheard note already holds, read back by the speakers it can name. */
function heardLines(body: string, speakers: string[]): HeardLine[] {
  const names = [...new Set(speakers)].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (names.length === 0) return [];
  const pattern = new RegExp(`(${names.join('|')}) said: "([^"]*)"`, 'g');
  return [...body.matchAll(pattern)].map((match) => ({ who: match[1]!, text: match[2]! }));
}
