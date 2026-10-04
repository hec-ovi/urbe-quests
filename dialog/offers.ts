/**
 * The actions an NPC may take while it replies, offered to the model as
 * OpenAI tools: come along with the player, lead them somewhere or walk
 * somewhere alone, stop, go home or to work, wait where it stands, sit down,
 * give the player its number or a copy of one of its access cards, or, on a
 * call, come to where the player is.
 * The model calls one when it agrees to what the player asked; the host
 * decides whether it happens and moves the body.
 */

import { promptLoader } from '../prompts.js';
import type { ChatTool, ChatToolCall } from '../ports/chat.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

const FOLLOW = 'follow_player';
const LEAD = 'lead_player_to';
const WALK = 'walk_to';
const MEET = 'meet_player';
const GIVE = 'give_item';
/** The actions that take no argument, by tool name, with the option that allows each and the offer kind it makes. */
const PLAIN = [
  { tool: 'stop', option: 'stop', kind: 'stop' },
  { tool: 'go_home', option: 'home', kind: 'home' },
  { tool: 'go_to_work', option: 'work', kind: 'work' },
  { tool: 'wait_here', option: 'wait', kind: 'wait' },
  { tool: 'sit', option: 'sit', kind: 'sit' },
  { tool: 'give_number', option: 'contact', kind: 'contact' },
] as const;

export interface OfferPlace {
  placeId: string;
  /** What the player knows the place as. */
  name: string;
  /** What the place is to this person, when the host knows: `home`, `work`, a `haunt`, a `venue`, a `street`... */
  relation?: string;
}

/** What the host lets this NPC agree to right now. */
export interface OfferOptions {
  /** The NPC may agree to follow the player. */
  follow?: boolean;
  /** Places the NPC may agree to lead the player to: buildings, streets, people, spots inside a building. */
  places?: OfferPlace[];
  /** The NPC may walk to one of `places` on its own, without the player. */
  walk?: boolean;
  /** The NPC may stop what it is doing for the player: following, leading or waiting. */
  stop?: boolean;
  /** The NPC may set off home, or to its work. */
  home?: boolean;
  work?: boolean;
  /** The NPC may stay where it stands for the player, or sit down nearby. */
  wait?: boolean;
  sit?: boolean;
  /** The NPC may give the player its number, so the player can call it. */
  contact?: boolean;
  /** On a call, the NPC may come to where the player is now: `name` is that place as the player knows it. */
  meet?: { name: string };
  /** Items the NPC may hand the player: a copy of each access card it holds, by the id the host knows it by and what the player sees it called. */
  give?: { items: OfferItem[] };
}

export interface OfferItem {
  itemId: string;
  /** What it is, as the player reads it: "Kessler Block 1407 key card, which opens apartment 1407". */
  name: string;
}

export type CompanionOffer =
  | { kind: 'follow' }
  | { kind: 'lead'; placeId: string; name: string }
  | { kind: 'walk'; placeId: string; name: string }
  | { kind: 'stop' }
  | { kind: 'home' }
  | { kind: 'work' }
  | { kind: 'wait' }
  | { kind: 'sit' }
  | { kind: 'contact' }
  | { kind: 'meet'; name: string }
  | { kind: 'give'; itemId: string; name: string };

/** Whether these options let the NPC agree to anything at all. */
export function offersAnything(options: OfferOptions = {}): boolean {
  return Boolean(
    options.follow || (options.places?.length ?? 0) > 0 || options.meet || (options.give?.items.length ?? 0) > 0 ||
      PLAIN.some((action) => options[action.option]),
  );
}

let everyTool: ChatTool[] | undefined;

/**
 * Every action tool, the same for every person and every turn whenever the
 * person may agree to anything, empty when they may agree to nothing. Model
 * servers render tools at the very start of the prompt, so tools that never
 * change keep that start, and the prompt cache behind it, the same from one
 * call to the next; what this person may do now, with its places and cards,
 * goes in the turn's message (`offerListing`), and a call outside it is refused.
 */
export function offerTools(options: OfferOptions = {}): ChatTool[] {
  if (!offersAnything(options)) return [];
  if (everyTool === undefined) {
    const none = { type: 'object', properties: {}, additionalProperties: false };
    const one = (key: string, description: string) => ({
      type: 'object',
      properties: { [key]: { type: 'string', description } },
      required: [key],
      additionalProperties: false,
    });
    const placeId = one('placeId', prompt('offers.md#place-id'));
    everyTool = [
      tool(FOLLOW, prompt('offers.md#follow_player'), none),
      tool(LEAD, prompt('offers.md#lead_player_to'), placeId),
      tool(WALK, prompt('offers.md#walk_to'), placeId),
      ...PLAIN.map((action) => tool(action.tool, prompt(`offers.md#${action.tool}`), none)),
      tool(MEET, prompt('offers.md#meet_player'), none),
      tool(GIVE, prompt('offers.md#give_item'), one('itemId', prompt('offers.md#item-id'))),
    ];
  }
  return everyTool;
}

/**
 * What the person may do for the player right now, for the turn's message:
 * the tools they may call, the places lead_player_to and walk_to take by id,
 * the cards give_item takes by id and, on a call, where meet_player goes.
 */
export function offerListing(options: OfferOptions = {}): string {
  const allowed = [
    ...(options.follow ? [FOLLOW] : []),
    ...((options.places?.length ?? 0) > 0 ? [LEAD, ...(options.walk ? [WALK] : [])] : []),
    ...PLAIN.filter((action) => options[action.option]).map((action) => action.tool),
    ...(options.meet ? [MEET] : []),
    ...((options.give?.items.length ?? 0) > 0 ? [GIVE] : []),
  ];
  const parts = [prompt('offers.md#available', { tools: allowed.join(', ') })];
  const places = options.places ?? [];
  if (places.length > 0) parts.push(prompt('offers.md#available-places', { places: places.map((place) => `- ${place.placeId}: ${place.name}`).join('\n') }));
  const items = options.give?.items ?? [];
  if (items.length > 0) parts.push(prompt('offers.md#available-items', { items: items.map((item) => `- ${item.itemId}: ${item.name}`).join('\n') }));
  if (options.meet) parts.push(prompt('offers.md#available-meet', { place: options.meet.name }));
  return parts.join('\n\n');
}

/** The offer a tool call makes, or undefined when the options allow no such tool or place. */
export function offerOf(call: ChatToolCall, options: OfferOptions = {}): CompanionOffer | undefined {
  const name = call.function.name;
  if (name === FOLLOW) return options.follow ? { kind: 'follow' } : undefined;
  if (name === LEAD || name === WALK) {
    if (name === WALK && !options.walk) return undefined;
    const placeId = placeIdOf(call.function.arguments);
    const place = options.places?.find((candidate) => candidate.placeId === placeId);
    return place && { kind: name === LEAD ? 'lead' : 'walk', placeId: place.placeId, name: place.name };
  }
  if (name === MEET) return options.meet ? { kind: 'meet', name: options.meet.name } : undefined;
  if (name === GIVE) {
    const itemId = argumentOf(call.function.arguments, 'itemId');
    const item = options.give?.items.find((candidate) => candidate.itemId === itemId);
    return item && { kind: 'give', itemId: item.itemId, name: item.name };
  }
  const action = PLAIN.find((candidate) => candidate.tool === name);
  return action && options[action.option] ? { kind: action.kind } : undefined;
}

/** The key one offer keeps among the offers of a reply: a lead or walk per place, any other action once. */
export function offerKey(offer: CompanionOffer): string {
  if (offer.kind === 'give') return `give:${offer.itemId}`;
  return offer.kind === 'lead' || offer.kind === 'walk' ? `${offer.kind}:${offer.placeId}` : offer.kind;
}

function tool(name: string, description: string, parameters: Record<string, unknown>): ChatTool {
  return { type: 'function', function: { name, description, parameters } };
}

function placeIdOf(json: string): unknown {
  return argumentOf(json, 'placeId');
}

function argumentOf(json: string, key: string): unknown {
  try {
    return (JSON.parse(json) as Record<string, unknown> | null)?.[key];
  } catch {
    return undefined;
  }
}
