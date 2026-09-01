/**
 * Per-NPC conversation memory in tiers: a verbatim tail, and older windows
 * folded into compact digest notes by the injected LLM. Serializable so
 * memory survives saves.
 */

import { readFileSync } from 'node:fs';
import type { LLMPort } from '../ports/llm.js';
import type { DialogTurn, MemorySnapshot } from './schema.js';

export interface MemoryStoreOptions {
  /** Verbatim turns kept before folding kicks in. */
  tailSize?: number;
  /** Oldest turns folded per compaction. */
  foldSize?: number;
}

const SUMMARIZE_PROMPT = readFileSync(new URL('./prompts/summarize.md', import.meta.url), 'utf8');

export class MemoryStore {
  private readonly memories = new Map<string, { digest: string[]; turns: DialogTurn[] }>();
  private readonly tailSize: number;
  private readonly foldSize: number;

  constructor(
    private readonly llm: LLMPort,
    options: MemoryStoreOptions = {},
  ) {
    this.tailSize = options.tailSize ?? 12;
    this.foldSize = options.foldSize ?? 6;
  }

  async record(npcId: string, turn: DialogTurn): Promise<void> {
    const memory = this.memory(npcId);
    memory.turns.push(turn);
    if (memory.turns.length <= this.tailSize) return;
    const folded = memory.turns.splice(0, this.foldSize);
    const transcript = folded.map((t) => `${t.speaker}: ${t.text}`).join('\n');
    const note = await this.llm.complete({ system: SUMMARIZE_PROMPT, prompt: transcript });
    memory.digest.push(note.trim());
  }

  snapshot(npcId: string): MemorySnapshot {
    const memory = this.memory(npcId);
    return { digest: [...memory.digest], turns: [...memory.turns] };
  }

  serialize(): Record<string, MemorySnapshot> {
    return Object.fromEntries([...this.memories].map(([npcId]) => [npcId, this.snapshot(npcId)]));
  }

  restore(data: Record<string, MemorySnapshot>): void {
    this.memories.clear();
    for (const [npcId, snapshot] of Object.entries(data)) {
      this.memories.set(npcId, { digest: [...snapshot.digest], turns: [...snapshot.turns] });
    }
  }

  private memory(npcId: string): { digest: string[]; turns: DialogTurn[] } {
    let memory = this.memories.get(npcId);
    if (!memory) {
      memory = { digest: [], turns: [] };
      this.memories.set(npcId, memory);
    }
    return memory;
  }
}
