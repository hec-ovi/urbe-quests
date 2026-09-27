/** Dialog context types: cache-ordered segments, the world they read, memory turns, digests. */

import type { NamedDistrict, NamedWorld } from '../world/types/named-world.js';

export type SegmentId = 'world' | 'type' | 'npc' | 'quest' | 'memory' | 'place' | 'events' | 'turns';

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

/**
 * Something the host saw happen near where the NPC stands, which the NPC saw
 * or heard of: `struck`, a car hit someone; `scene`, a quest scene stands there.
 */
export type DialogEvent = {
  /** When it happened, or since when the scene stands. */
  atMin: number;
  /** The building it happened at or in front of. */
  parcelId: string;
  /** How far from where the NPC stands, in metres. */
  metres: number;
} & (
  | {
    kind: 'struck';
    /** The car was fast. */
    hard?: boolean;
    /** The NPC talked to is the person the car hit. */
    self?: boolean;
    /** The person hit still lies where they fell. */
    down?: boolean;
  }
  | {
    kind: 'scene';
    /** What shows there, one plain sentence each, never who someone is or what happened. */
    notes: string[];
  }
);

export interface ContextOptions {
  /** Adds the `place` segment. */
  guide?: DialogGuide;
  /** Adds the `events` segment, in the order given. */
  events?: DialogEvent[];
  /** Lines the host showed in this conversation that memory does not hold yet, oldest first; they follow the remembered turns. */
  prior?: DialogLine[];
}

/** One line said in a conversation that no model reply carried: an authored opening, a story choice and its reply, a greeting. */
export interface DialogLine {
  speaker: 'player' | 'npc';
  text: string;
  /** The minute it was said; without it, the minute of the exchange it goes with. */
  atMin?: number;
}

export interface DialogTurn extends DialogLine {
  atMin: number;
}

/** One completed exchange: the player's line and the NPC's reply, after the prior lines shown since the last one. */
export interface DialogExchange {
  line: string;
  reply: string;
  atMin: number;
  /** Stored ahead of the exchange, each at its own minute or else the exchange's. */
  prior?: DialogLine[];
}

export interface MemorySnapshot {
  /** Older conversation folded into compact notes, oldest first. */
  digest: string[];
  /** Recent turns kept verbatim. */
  turns: DialogTurn[];
}
