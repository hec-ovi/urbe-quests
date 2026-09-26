/** Dialog context types: cache-ordered segments, the world they read, memory turns, digests. */

import type { NamedDistrict, NamedWorld } from '../world/types/named-world.js';

export type SegmentId = 'world' | 'type' | 'npc' | 'quest' | 'memory' | 'place' | 'turns';

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
  /** Authored identity used in dialog while npcId and simulation records remain unchanged. */
  characterName?: { given: string; family: string };
  segments: ContextSegment[];
}

/**
 * The world the dialog layers read: Naming output, or a world whose districts
 * and parcels are not named yet. Unnamed places are described, never shown by id.
 */
export interface DialogWorld {
  meta: { naming: { theme: string } };
  districts: Array<Omit<NamedDistrict, 'name'> & { name?: string }>;
  parcels: NamedWorld['parcels'];
  transit?: NamedWorld['transit'];
}

/** A place the NPC has led the player to, as the host describes it. */
export interface DialogGuide {
  placeId: string;
  /** Simulation place kind: a building parcel, or a stop or station. */
  kind: 'parcel' | 'stop';
  /** What the player sees it called; the world's name or the kind of building when absent. */
  name?: string;
  /** What the host shows there right now, one plain sentence each. */
  notes?: string[];
}

export interface ContextOptions {
  /** Adds the `place` segment. */
  guide?: DialogGuide;
}

export interface DialogTurn {
  speaker: 'player' | 'npc';
  text: string;
  atMin: number;
}

/** One completed exchange: the player's line and the NPC's reply. */
export interface DialogExchange {
  line: string;
  reply: string;
  atMin: number;
}

export interface MemorySnapshot {
  /** Older conversation folded into compact notes, oldest first. */
  digest: string[];
  /** Recent turns kept verbatim. */
  turns: DialogTurn[];
}
