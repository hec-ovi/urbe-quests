/**
 * The actions an NPC may take while it replies, offered to the model as
 * OpenAI tools: come along with the player, lead them somewhere or walk
 * somewhere alone, stop, go home or to work, wait where it stands, sit down,
 * give the player its number, a copy of one of its access cards or one of
 * the things it carries, take what the player hands it, pay the player or
 * take the credits they hold out, name a sum it wants, sell from its counter,
 * buy one of the player's things, or, on a call, come to where the player is.
 * The model calls one when it agrees to what the player asked; the host
 * decides whether it happens, moves the body and moves what changes hands.
 */

import { promptLoader } from '../prompts.js';
import type { ChatTool, ChatToolCall } from '../ports/chat.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

const FOLLOW = 'come_along';
const LEAD = 'take_them_to';
const WALK = 'walk_to';
const MEET = 'meet_them';
const GIVE = 'give_item';
const TAKE = 'take_item';
const GIVE_CREDITS = 'give_credits';
const TAKE_CREDITS = 'take_credits';
const ASK_CREDITS = 'ask_credits';
const SELL = 'sell_item';
const BUY = 'buy_item';
/** The most credits one tool call names. */
const MOST = 1000;
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
  /**
   * Items the NPC may hand the player, by the id the host knows each by and
   * what the player sees it called: a copy of an access card it holds
   * (`copy`), or one of the things it carries, which then leaves it.
   */
  give?: { items: OfferItem[] };
  /** Items the player may hand the NPC, which it may take (`take_item`). */
  take?: { items: OfferItem[] };
  /** The money on the table: what the NPC carries, what the player has, and a sum the player holds out now. */
  credits?: OfferCredits;
  /** What the NPC sells from the counter it works at, each at its price. */
  sell?: { items: PricedItem[] };
  /** The player's things the NPC may buy, each at the most it would pay. */
  buy?: { items: PricedItem[] };
}

export interface OfferItem {
  itemId: string;
  /** What it is, as the player reads it: "Kessler Block 1407 key card, which opens apartment 1407". */
  name: string;
  /** A copy of an access card: the NPC keeps its own. */
  copy?: boolean;
}

/** An item with a price in whole credits. */
export interface PricedItem {
  itemId: string;
  name: string;
  price: number;
}

/** Whole credits: what the NPC carries, what the player has (`purse`), and what the player holds out to it now (`offered`). */
export interface OfferCredits {
  carried: number;
  purse: number;
  offered?: number;
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
  | { kind: 'give'; itemId: string; name: string }
  /** The NPC takes what the player hands it. */
  | { kind: 'take'; itemId: string; name: string }
  /** The NPC gives the player credits from what it carries. */
  | { kind: 'pay'; amount: number }
  /** The NPC takes the credits the player holds out. */
  | { kind: 'accept'; amount: number }
  /** The NPC names a sum it wants from the player. */
  | { kind: 'ask'; amount: number }
  /** The NPC sells the player one item from its counter, at its price. */
  | { kind: 'sell'; itemId: string; name: string; price: number }
  /** The NPC buys one of the player's things for `amount`. */
  | { kind: 'buy'; itemId: string; name: string; amount: number };

/** Whether these options let the NPC agree to anything at all. */
export function offersAnything(options: OfferOptions = {}): boolean {
  return Boolean(
    options.follow || (options.places?.length ?? 0) > 0 || options.meet || (options.give?.items.length ?? 0) > 0 ||
      (options.take?.items.length ?? 0) > 0 || (options.sell?.items.length ?? 0) > 0 || (options.buy?.items.length ?? 0) > 0 ||
      options.credits !== undefined || PLAIN.some((action) => options[action.option]),
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
    const itemId = one('itemId', prompt('offers.md#item-id-any'));
    const amount = { type: 'integer', minimum: 1, maximum: MOST, description: prompt('offers.md#amount') };
    const credits = { type: 'object', properties: { amount }, required: ['amount'], additionalProperties: false };
    const priced = {
      type: 'object',
      properties: { itemId: { type: 'string', description: prompt('offers.md#item-id-any') }, amount },
      required: ['itemId', 'amount'],
      additionalProperties: false,
    };
    everyTool = [
      tool(FOLLOW, prompt('offers.md#come_along'), none),
      tool(LEAD, prompt('offers.md#take_them_to'), placeId),
      tool(WALK, prompt('offers.md#walk_to'), placeId),
      ...PLAIN.map((action) => tool(action.tool, prompt(`offers.md#${action.tool}`), none)),
      tool(MEET, prompt('offers.md#meet_them'), none),
      tool(GIVE, prompt('offers.md#give_item-any'), itemId),
      tool(TAKE, prompt('offers.md#take_item'), itemId),
      tool(GIVE_CREDITS, prompt('offers.md#give_credits'), credits),
      tool(TAKE_CREDITS, prompt('offers.md#take_credits'), credits),
      tool(ASK_CREDITS, prompt('offers.md#ask_credits'), credits),
      tool(SELL, prompt('offers.md#sell_item'), itemId),
      tool(BUY, prompt('offers.md#buy_item'), priced),
    ];
  }
  return everyTool;
}

/**
 * What the person may do for the player right now, for the turn's message:
 * the tools they may call, the places take_them_to and walk_to take by id,
 * the things give_item and take_item take by id, the credits on the table,
 * what they sell and what they may buy, and, on a call, where meet_them goes.
 */
export function offerListing(options: OfferOptions = {}): string {
  const credits = options.credits;
  const allowed = [
    ...(options.follow ? [FOLLOW] : []),
    ...((options.places?.length ?? 0) > 0 ? [LEAD, ...(options.walk ? [WALK] : [])] : []),
    ...PLAIN.filter((action) => options[action.option]).map((action) => action.tool),
    ...(options.meet ? [MEET] : []),
    ...((options.give?.items.length ?? 0) > 0 ? [GIVE] : []),
    ...((options.take?.items.length ?? 0) > 0 ? [TAKE] : []),
    ...(credits && credits.carried > 0 ? [GIVE_CREDITS] : []),
    ...(credits?.offered ? [TAKE_CREDITS] : []),
    ...(credits ? [ASK_CREDITS] : []),
    ...((options.sell?.items.length ?? 0) > 0 ? [SELL] : []),
    ...((options.buy?.items.length ?? 0) > 0 ? [BUY] : []),
  ];
  const parts = [prompt('offers.md#available', { tools: allowed.join(', ') })];
  const places = options.places ?? [];
  if (places.length > 0) parts.push(prompt('offers.md#available-places', { places: places.map((place) => `- ${place.placeId}: ${place.name}`).join('\n') }));
  const items = options.give?.items ?? [];
  if (items.length > 0) {
    parts.push(prompt('offers.md#available-things', {
      items: items.map((item) => `- ${item.itemId}: ${item.copy ? prompt('offers.md#available-copy', { name: item.name }) : item.name}`).join('\n'),
    }));
  }
  const taken = options.take?.items ?? [];
  if (taken.length > 0) parts.push(prompt('offers.md#available-take', { items: taken.map((item) => `- ${item.itemId}: ${item.name}`).join('\n') }));
  if (credits && credits.carried > 0) parts.push(prompt('offers.md#available-credits', { carried: credits.carried }));
  if (credits?.offered) parts.push(prompt('offers.md#available-offered', { amount: credits.offered }));
  const sold = options.sell?.items ?? [];
  if (sold.length > 0) parts.push(prompt('offers.md#available-sell', { items: sold.map((item) => `- ${item.itemId}: ${item.name}, ${item.price} credits`).join('\n') }));
  const bought = options.buy?.items ?? [];
  if (bought.length > 0) parts.push(prompt('offers.md#available-buy', { items: bought.map((item) => `- ${item.itemId}: ${item.name}, up to ${item.price} credits`).join('\n') }));
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
  if (name === GIVE || name === TAKE) {
    const itemId = argumentOf(call.function.arguments, 'itemId');
    const item = (name === GIVE ? options.give : options.take)?.items.find((candidate) => candidate.itemId === itemId);
    return item && { kind: name === GIVE ? 'give' : 'take', itemId: item.itemId, name: item.name };
  }
  if (name === GIVE_CREDITS || name === TAKE_CREDITS || name === ASK_CREDITS) {
    const amount = argumentOf(call.function.arguments, 'amount');
    const offer: CompanionOffer | undefined = isAmount(amount)
      ? { kind: name === GIVE_CREDITS ? 'pay' : name === TAKE_CREDITS ? 'accept' : 'ask', amount }
      : undefined;
    return offer && creditsAllowed(offer, options) ? offer : undefined;
  }
  if (name === SELL) {
    const itemId = argumentOf(call.function.arguments, 'itemId');
    const item = options.sell?.items.find((candidate) => candidate.itemId === itemId);
    return item && { kind: 'sell', itemId: item.itemId, name: item.name, price: item.price };
  }
  if (name === BUY) {
    const itemId = argumentOf(call.function.arguments, 'itemId');
    const item = options.buy?.items.find((candidate) => candidate.itemId === itemId);
    if (!item) return undefined;
    const said = argumentOf(call.function.arguments, 'amount');
    const amount = buyAmount(item, isAmount(said) ? said : undefined, options);
    return amount === undefined ? undefined : { kind: 'buy', itemId: item.itemId, name: item.name, amount };
  }
  const action = PLAIN.find((candidate) => candidate.tool === name);
  return action && options[action.option] ? { kind: action.kind } : undefined;
}

/**
 * Whether a sum of credits stands within the money on the table: what the
 * NPC pays from what it carries, what it takes up to what the player holds
 * out and has, and a sum it asks for of 1 to 1000.
 */
export function creditsAllowed(offer: CompanionOffer, options: OfferOptions = {}): boolean {
  const credits = options.credits;
  if (!credits || !('amount' in offer) || !isAmount(offer.amount)) return false;
  if (offer.kind === 'pay') return offer.amount <= credits.carried;
  if (offer.kind === 'accept') return credits.offered !== undefined && offer.amount <= credits.offered && offer.amount <= credits.purse;
  if (offer.kind === 'ask') return true;
  return false;
}

/**
 * What the NPC pays for one of the player's things: the sum it named, else
 * the item's price, no more than the price and, with `credits`, no more than
 * it carries; undefined when that leaves nothing.
 */
export function buyAmount(item: PricedItem, said: number | undefined, options: OfferOptions = {}): number | undefined {
  const amount = Math.min(said ?? item.price, item.price, options.credits?.carried ?? Infinity);
  return isAmount(amount) ? amount : undefined;
}

/** The key one offer keeps among the offers of a reply: a lead or walk per place, a thing per item, any other action once. */
export function offerKey(offer: CompanionOffer): string {
  if (offer.kind === 'give' || offer.kind === 'take' || offer.kind === 'sell' || offer.kind === 'buy') return `${offer.kind}:${offer.itemId}`;
  return offer.kind === 'lead' || offer.kind === 'walk' ? `${offer.kind}:${offer.placeId}` : offer.kind;
}

/** A whole number of credits from 1 to 1000. */
function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MOST;
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
