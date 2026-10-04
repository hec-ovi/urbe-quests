/** Dialog context types: cache-ordered segments, the world they read, memory turns, digests. */

import type { NamedDistrict, NamedWorld } from '../world/types/named-world.js';
import type { StreetGeometry } from '../world/streets.js';
import type { DialogPeople } from './people.js';

export type SegmentId = 'world' | 'type' | 'npc' | 'address' | 'quest' | 'memory' | 'conversation' | 'overheard' | 'place' | 'events' | 'people' | 'turns';

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
  meta: { naming: { theme: string }; gridAngle?: number };
  districts: Array<Omit<NamedDistrict, 'name'> & { name?: string }>;
  parcels: NamedWorld['parcels'];
  transit?: NamedWorld['transit'];
  /** Atlas `streets`: with it, places carry their street and a person knows where they stand. */
  streets?: StreetGeometry;
  /**
   * The parcels whose buildings nobody can go into (no interior was built
   * for them): a person does not name them as places around them to go to.
   * Absent, every building is open.
   */
  closed?: string[];
}

/** A place the NPC has led the player to, as the host describes it. */
export interface DialogGuide {
  placeId: string;
  /**
   * Simulation place kind: a building parcel, or a stop or station; `street` a
   * street by its StreetNames id; `person` somebody the NPC walked the player
   * to (`placeId` their npcId) and `spot` a place inside a building (a lift,
   * the stairs, a room, a floor), both told by `name`.
   */
  kind: 'parcel' | 'stop' | 'street' | 'person' | 'spot';
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
  /** What the person looks like, as the host draws them: the npc segment carries it. */
  look?: DialogLook;
  /** Where the person stands now: the turns segment says where that is and what is around. */
  here?: DialogHere;
  /** Who the person knows and where they are, and the names the player asked about that they do not know (`peopleKnown`): adds the `people` segment. */
  people?: DialogPeople;
  /** What the person is doing for the player now, as the host runs it: the turns segment says it. */
  task?: DialogTask;
  /** The player is not with the person but talking to them on the phone: the turns segment says so. */
  call?: DialogCall;
  /** Where the person lives and works by address, where they stand now indoors, and the doors they hold cards for: adds the `address` segment, and the turns segment says where they stand. */
  addresses?: DialogAddresses;
  /**
   * What a person along with the player (following them, leading them) heard
   * the player say to other people and those people say back, oldest first:
   * adds the `overheard` segment, marked as other people's words.
   */
  overheard?: DialogOverheard[];
}

/** One exchange the person overheard between the player and somebody else. */
export interface DialogOverheard {
  /** Who the player talked to, as this person would know them: a name, else what they are. */
  name: string;
  /** What they are (`receptionist`), told beside a name. */
  role?: string;
  /** What the player said, and what the other person said back. */
  player: string;
  reply: string;
}

/**
 * A private place by its address, as the host numbers the furnished
 * buildings: the building, the floor as its numbers count it (0 the ground
 * floor, below it basements), and on it the dwelling or private room
 * (`apartment 1407`, `office 305`) and the kind of room in words.
 */
export interface DialogAddress {
  parcelId: string;
  floor?: number;
  unit?: string;
  room?: string;
}

/** One access card a person holds: what it opens in words (`apartment 1407`, `the staff rooms`) in which building, and whether it is their home's or their work's. */
export interface DialogAccess {
  parcelId: string;
  opens: string;
  tie?: 'home' | 'work';
}

/** Where a person belongs, by address, and the cards they carry. */
export interface DialogAddresses {
  home?: DialogAddress;
  work?: DialogAddress;
  /** Where they stand now, inside a furnished building. */
  here?: DialogAddress;
  /** The doors they hold cards for; they can hand the player a copy of any. */
  access?: DialogAccess[];
  /** How many times they caught the player lifting a card off them. */
  caught?: number;
  /** How far the places that matter in this talk lie from where they stand now: their home, their work, the place a story sends the player to, an address the talk named. */
  ways?: DialogWay[];
}

/** One place and the way to it from where the person stands, as the host measures it. */
export interface DialogWay {
  /** `home` and `work` are the person's own; `quest` the place the player's story points to; `named` an address or place the talk named. */
  what: 'home' | 'work' | 'quest' | 'named';
  /** The place as the player knows it, for `quest` and `named`. */
  name?: string;
  /** The walk there, in metres, and the compass point it lies toward ("north-east"). */
  metres: number;
  point: string;
  /** Minutes on foot. */
  minutes: number;
  /** A lift ride up or down at the end of it. */
  lift?: 'up' | 'down';
}

/** A talk over the phone: the player called the person, who is wherever their day has them. */
export interface DialogCall {
  /** Who rang whom; only the player calls for now. */
  caller: 'player';
}

/** Something a person is doing for the player now: following them, leading them somewhere, or on an errand they asked for. */
export interface DialogTask {
  kind: 'following' | 'leading' | 'brought' | 'walking' | 'waiting' | 'sitting' | 'home' | 'work';
  /** Where to, as the player knows the place: a leader's (or where they brought the player) or a walker's place. */
  place?: string;
}

/** What a person looks like, in plain words the host takes from the look it draws them in. */
export interface DialogLook {
  /** "tall", "of average height", "short". */
  height: string;
  /** "a slight build", "a broad, heavy build". */
  build: string;
  /** Face features worth a word, "a wide jaw", "large eyes"; may be empty. */
  face: string[];
  /** "short black hair, slicked back", "a shaved head". */
  hair: string;
  /** Skin tone: "deep brown". */
  skin: string;
  /** Eye colour: "grey-green". */
  eyes: string;
  /** What they wear, top to toe: "a navy bomber jacket with slate-grey sleeves". */
  wearing: string[];
  /** The fabric the clothes are made of: "leather". */
  fabric?: string;
}

/** Where a person stands, as the host sees it. */
export interface DialogHere {
  /** World position on the ground plane, metres (Atlas XZ). */
  x: number;
  z: number;
  /** The building they stand in, and its floor (0 the ground floor), when inside one. */
  parcelId?: string;
  floor?: number;
  /** The light where they stand, in plain words: "night, under street lamps and neon". */
  light?: string;
  /** The building they stand in, as the host's interior data has it: its floors, the ways between them and who is inside now. */
  building?: DialogBuilding;
}

/** A building a person stands in, in plain words from the host's interior data. */
export interface DialogBuilding {
  /** Each floor from the ground up: the kinds of rooms people share on it, and the numbers on its apartment doors. */
  floors: Array<{ index: number; rooms: string[]; apartments?: string[] }>;
  /** The kind of room the person stands in: "lobby", "reception". */
  room?: string;
  /** How many lifts and staircases join the floors. */
  lifts: number;
  stairs: number;
  /** Who else the host sees in the building now: a name when this person knows them, what they are, their floor and room. */
  people?: Array<{ name?: string; role: string; floor: number; room?: string }>;
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
