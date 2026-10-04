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

/** The tools these options allow; empty when the NPC may agree to nothing. */
export function offerTools(options: OfferOptions = {}): ChatTool[] {
  const none = { type: 'object', properties: {}, additionalProperties: false };
  const tools: ChatTool[] = [];
  if (options.follow) tools.push(tool(FOLLOW, prompt('offers.md#follow_player'), none));
  const places = options.places ?? [];
  if (places.length > 0) {
    const listing = places.map((place) => `- ${place.placeId}: ${place.name}`).join('\n');
    const parameters = {
      type: 'object',
      properties: {
        placeId: { type: 'string', enum: places.map((place) => place.placeId), description: prompt('offers.md#place-id') },
      },
      required: ['placeId'],
      additionalProperties: false,
    };
    tools.push(tool(LEAD, prompt('offers.md#lead_player_to', { places: listing }), parameters));
    if (options.walk) tools.push(tool(WALK, prompt('offers.md#walk_to', { places: listing }), parameters));
  }
  for (const action of PLAIN) if (options[action.option]) tools.push(tool(action.tool, prompt(`offers.md#${action.tool}`), none));
  if (options.meet) tools.push(tool(MEET, prompt('offers.md#meet_player', { place: options.meet.name }), none));
  const items = options.give?.items ?? [];
  if (items.length > 0) {
    tools.push(tool(GIVE, prompt('offers.md#give_item', { items: items.map((item) => `- ${item.itemId}: ${item.name}`).join('\n') }), {
      type: 'object',
      properties: { itemId: { type: 'string', enum: items.map((item) => item.itemId), description: prompt('offers.md#item-id') } },
      required: ['itemId'],
      additionalProperties: false,
    }));
  }
  return tools;
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
