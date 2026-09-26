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
    return { digest: [...memory.digest], turns: [...memory.turns] };
  }

  serialize(): Record<string, MemorySnapshot> {
    return Object.fromEntries([...this.memories.keys()].map((npcId) => [npcId, this.snapshot(npcId)]));
  }

  restore(data: Record<string, MemorySnapshot>): void {
    this.memories.clear();
    for (const [npcId, snapshot] of Object.entries(data)) {
      this.memories.set(npcId, { digest: [...snapshot.digest], turns: [...snapshot.turns] });
    }
  }

  private async fold(memory: Memory): Promise<void> {
    while (memory.turns.length > this.tailSize) {
      const folded = memory.turns.slice(0, this.foldSize);
      const transcript = folded.map((t) => `${t.speaker}: ${t.text}`).join('\n');
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
