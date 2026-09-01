/** Dialog context types: cache-ordered segments, memory turns, digests. */

export type SegmentId = 'world' | 'type' | 'npc' | 'quest' | 'memory' | 'turns';

/**
 * One layer of an NPC's dialog context. Segments come in a fixed order so
 * shared ones form a stable prefix (world and type never vary per NPC), which
 * is exactly what provider prompt caching needs.
 */
export interface ContextSegment {
  id: SegmentId;
  text: string;
  /** True when identical across NPCs (world) or across a type (type). */
  shared: boolean;
}

export interface DialogContext {
  npcId: string;
  segments: ContextSegment[];
}

export interface DialogTurn {
  speaker: 'player' | 'npc';
  text: string;
  atMin: number;
}

export interface MemorySnapshot {
  /** Older conversation folded into compact notes, oldest first. */
  digest: string[];
  /** Recent turns kept verbatim. */
  turns: DialogTurn[];
}
