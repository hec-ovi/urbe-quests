/**
 * Words and actions agree. The model is asked to call a tool whenever its
 * person agrees to something, but a reply may agree in words alone. This
 * reads what the player's line asks, what the reply says to it, and what the
 * person offered or was asked a moment ago, against what the person may do
 * now (the talk's offers), so a reply that says "Fine" to "come with me"
 * still comes along, "I follow you" after "Want me to walk you there?" goes
 * there, and "Here you go" to "Can you lend me 5?" hands the 5 over.
 * It imports types alone, so a browser host may use it.
 */

import type { CompanionOffer, OfferCredits, OfferItem, OfferOptions, OfferPlace, PricedItem } from './offers.js';
import type { DialogLine } from './schema.js';

/** What a reply says to what is on the table. */
export type Stance = 'agree' | 'refuse' | 'none';

/** An action on the table from the last exchange: one the person offered, or one the player asked and the person has not answered. */
export interface Pending {
  offer: CompanionOffer;
  by: 'npc' | 'player';
}

const AGREE = new RegExp(
  '\\b(?:fine|sure|okay|ok|alright|all right|yes|yeah|yep|yup|of course|certainly|absolutely|gladly|why not|deal|no problem|no worries|' +
    'with pleasure|happy to|glad to|let\'s go|let\'s do (?:it|this)|come on|follow me|this way|lead on|lead the way|after you|you lead|' +
    'keep up|stay close|stick with me|stay with me|walk behind me|stay behind me|come along|on my way|i\'m coming|i\'ll come|' +
    'i\'ll (?:show|take|walk|lead|bring|guide|follow|go|head|give|hand|send|call)|i can (?:show|take|walk|lead|bring|do that)|' +
    'let me (?:show|take|walk|give)|here(?:\'s| is| you go| you are)|take it|take this|there you go|you got it|i\'m in)\\b',
  'i',
);
const REFUSE = new RegExp(
  '\\b(?:no|nope|nah|not a chance|no way|no chance|forget it|never|i won\'t|i will not|i can\'t|i cannot|can\'t do|won\'t do|' +
    'i\'m not (?:going|gonna|giving|coming|following|taking|leading|showing|handing|doing|leaving)|' +
    'i don\'t (?:give|hand|do|take|go|think so)|not happening|not now|not today|not tonight|maybe later|another time|some other time|' +
    'i\'d rather not|i\'ll pass|leave me alone|get lost|back off|go away|i\'m busy|too busy|on duty|save your breath|' +
    'not for strangers|ask someone else)\\b',
  'i',
);
/** Courtesies that start with "no" and agree. */
const COURTESY = /\bno (?:problem|worries|trouble)\b/gi;
/** A short line that agrees by acknowledging: "Good.", "Move." */
const NOD = /^(?:good|great|perfect|right|move|here|then come on|let's move)[.!]*$/i;

/** The person offers to take the player somewhere: "Want me to walk you there?" */
const OFFER_LEAD = /\b(?:want me to|shall i|should i|do you want me to|would you like me to|i could|i can|need me to|like me to)\s+(?:walk|take|show|lead|bring|guide)\b/i;
/** The person offers to come along: "Want me to come with you?" */
const OFFER_FOLLOW = /\b(?:want me to|shall i|should i|do you want me to|would you like me to|i could|i can)\s+(?:come(?: along)?(?: with you)?|follow you|tag along|join you)\b/i;
/** The person says in words that they lead the way. */
const SAYS_LEAD = /\b(?:follow me|i'll (?:show|take|walk|lead|bring|guide) you|let me (?:show|take|walk) you|this way|i'll lead)\b/i;

/** The player accepts what was offered. */
const ACCEPT_START = /^(?:ok(?:ay|ey)?|k|yes|yeah|yep|yup|sure|fine|alright|all right|please|deal|great|perfect|sounds good|go on|go ahead|after you|lead on|lead the way|let's go|let's do (?:it|this)|show me|take me(?: there)?|coming|i'm coming)\b/i;
const ACCEPT_ANY = /\b(?:i(?:'ll| will| can|'m going to| am going to)? follow you|lead the way|after you|let's go|show me the way|walk me there|take me there|i'm right behind you|right behind you|i'll come with you|i'll go with you)\b/i;
/** The player turns it down. */
const DECLINE = /^(?:no|nope|nah|never ?mind|forget it|not now|maybe later|no thanks)\b/i;

const ASK_CONTACT = /\b(?:your (?:phone )?number|phone number|your digits|how (?:can|do) i (?:reach|call) you|can i call you)\b/i;
const ASK_CARD = /\b(?:access|key ?card|card|keys?|let me in|get me in|pass)\b/i;
const ASK_STOP = /\b(?:stop following|stop leading|you can go(?: now)?|you can leave|go back to (?:your|what you)|you're free to go)\b/i;
const ASK_FOLLOW = /\b(?:come with me|come along|follow me|tag along|walk with me|join me|keep me company|stick with me|stay with me|accompany me|come on with me)\b/i;
const ASK_HOME = /\b(?:go home|head home|get home|go back home)\b/i;
const ASK_WORK = /\b(?:go to work|head to work|get to work|go back to work)\b/i;
const ASK_WAIT = /\b(?:wait here|wait for me|stay here|wait a (?:minute|moment|sec(?:ond)?))\b/i;
const ASK_SIT = /\b(?:sit down|take a seat|have a seat)\b/i;
const ASK_LEAD = /\b(?:show me|take me|lead me|bring me|walk me|guide me|point me|lead the way|show (?:me )?the way|can you show|where (?:do|does) you live|where you live|where you work|how do i get to)\b/i;
const ASK_WALK = /\b(?:go to|head to|head over to|wait for me at|meet me at|go wait at|go ahead to)\b/i;

/** The player hands the person a thing: "take this", "this is for you", "I brought you...", "here's the...", "you can have...". */
const ASK_THING = /(?:^|[,.!?;:]\s*|\b(?:here|please|just|go on|you)\s*,?\s+)take (?:this|these|it|the|my|a)\b|\b(?:this is for you|these are for you|i brought you|i got you|i've got something for you|here'?s (?:the|a|an|your|my|some|this)|here is (?:the|a|an|your|my|some|this)|you can have|you can keep|have this|keep this|it's yours|it's for you)\b/i;
/** The player holds out money: "here, ...", "I'll pay", "let me pay", "here's", "for your trouble", "a tip", "keep the change". */
const ASK_PAY = /(?:^here\b|\bhere,)|\b(?:i'll pay|i will pay|let me pay|i can pay|here'?s|here is|here are|for your (?:trouble|time|help)|a tip|keep the change|take (?:these|this|it)|this is for you)\b/i;
/** The player asks the person for money: "lend me", "spare (me)", "can you give me", "I need money", "you owe me". */
const ASK_MONEY = /\b(?:lend me|spare(?: me)?|(?:can|could|would|will) you (?:give|pay|lend|loan) me|i need (?:some )?(?:money|credits|cash|notes)|you owe me|loan me)\b/i;
/** The player orders from a counter: "I'll have", "can I get", "I'd like", "sell me", "a cup of". Asking a price is no order. */
const ASK_BUY = /\b(?:i'll have|i will have|i'll take|i will take|can i (?:get|have)|could i (?:get|have)|may i have|i'd like|i would like|i want|sell me|give me a|a cup of|a glass of|a pack of|a loaf of)\b/i;
/** The player offers the person one of their things for money: "would you buy", "I'm selling", "what would you give for". */
const ASK_SELL = /\b(?:would you buy|will you buy|do you want to buy|want to buy|wanna buy|buy (?:this|these|my|it)|i'm selling|i am selling|i'll sell|i will sell|what would you (?:give|pay)|what will you (?:give|pay)|how much would you (?:give|pay))\b/i;
/** The player asks for one of the things the person carries: "can I have your flask", "could you lend me your pen". */
const ASK_GIVE = /\b(?:(?:can|could|may) i (?:have|get|borrow|take)|(?:can|could|would|will) you (?:give|hand|lend|spare|pass) me|give me|hand me|lend me|i(?:'d| would) like|i need)\b/i;
/** A thank-you, which takes what was handed: "Thanks", "much obliged". */
const THANKS = /\b(?:thanks|thank you|thank ya|cheers|much obliged|obliged|kind of you|appreciated|i appreciate|that's generous|generous of you|i'll take it)\b/i;

/** The money words a sum stands next to: "10 credits", "twenty cr", "5 notes". */
const MONEY_WORD = /^\s*(?:credits?|cr|notes?|bureau notes?)\b/i;
/** The words a sum follows within 20 characters: "pay you 10", "lend me 5", "here's 20", "for 8". */
const MONEY_VERB = /\b(?:pay|give|lend|loan|spare|here's|heres|here is|here are|take|tip|owe|for)\b/gi;
/** What a sum after a money verb may be followed by; any other word makes it a count of something else ("give me 2 beers"). */
const AFTER_SUM = /^(?:\s*$|\s*[.,!?;:)\u2014-]|\s+(?:please|now|then|and|or|so|for|to|if|until|till|back|today|tomorrow|tonight|by|at|on|before|after|each|apiece|yeah|ok|okay|right|eh|mate|friend|sir|madam|i|you|we|it|that|this|but|because|max|tops|at most|more|is|was|will|should|would|could|can|do|ok)\b)/i;
/** Words that make the number after them an address, a count or a time: "floor 14", "apartment 1407". */
const NOT_SUM_BEFORE = /\b(?:floor|floors|apartment|apt|flat|room|unit|number|no|block|street|avenue|level|platform|line|bus|tram|office|suite|door|gate|archive|records|desk|counter|window|page|year|age|aged|at)\s*#?$/i;
/** Words that make the number before them a count or a measure: "5 minutes", "2 floors". */
const NOT_SUM_AFTER = /^(?:\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|months?|years?|metres?|meters?|km|blocks?|floors?|o'clock|am|pm|people|times|of)\b|[:.]\d|\s*%|(?:st|nd|rd|th)\b)/i;
/** Sums in words, as people say them. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};
const SUM = /\b(?:(\d{1,4})|(?:a |one )?(hundred)|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty))\b/gi;
/** Words of an item's name that say nothing of which item it is. */
const ITEM_STOP = new Set(['with', 'from', 'your', 'their', 'this', 'that', 'which', 'opens', 'there', 'have', 'into', 'some', 'copy']);

const HOME_WORDS = /\b(?:where you live|you live|your (?:home|place|apartment|flat|house|building|door|room))\b/i;
const WORK_WORDS = /\b(?:where you work|your (?:work|job|office|workplace|shop|store|post|desk|bar|cafe|clinic))\b/i;
const OWN_HOME = /\b(?:where i live|my (?:place|home|apartment|flat|building|door))\b/i;
const OWN_WORK = /\b(?:where i work|my (?:work|job|office|shop|store|post))\b/i;
const STOP_WORDS = new Set(['the', 'and', 'with', 'from', 'your', 'floor', 'street', 'avenue', 'building', 'block', 'apartment', 'room']);

/** The words of a line as these read them: one kind of apostrophe, no cues, single spaces. */
function plain(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(text: string): string[] {
  return plain(text)
    .split(/(?<=[.!?…])\s+|\s+[—-]{1,2}\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * What a reply says to what was asked or offered: the first sentence that
 * agrees or refuses decides, questions aside ("You want me to come? Fine.").
 * In one sentence a refusal outweighs an agreement ("Sure, I'm not going").
 */
export function stanceOf(reply: string): Stance {
  for (const sentence of sentences(reply)) {
    if (sentence.endsWith('?')) continue;
    const words = sentence.replace(COURTESY, ' ');
    if (REFUSE.test(words)) return 'refuse';
    if (AGREE.test(sentence) || NOD.test(sentence)) return 'agree';
  }
  return 'none';
}

/** The player's line accepts what was offered: "ok", "yes", "I follow you", "lead the way". */
export function accepts(line: string): boolean {
  const text = plain(line);
  return !DECLINE.test(text) && (ACCEPT_START.test(text) || ACCEPT_ANY.test(text));
}

/** The player's line turns down what was offered. */
export function declines(line: string): boolean {
  return DECLINE.test(plain(line));
}

/**
 * The place a text names among `places`: the person's home or work by what
 * it is to them (`own` reads "my place" as theirs, else "your place" is),
 * else the place whose number or name the text holds, the longest match.
 */
export function placeIn(text: string, places: OfferPlace[] = [], own = false): OfferPlace | undefined {
  const words = plain(text).toLowerCase();
  const byRelation = (relation: string) => places.find((place) => place.relation === relation);
  if ((own ? OWN_HOME : HOME_WORDS).test(words) && byRelation('home')) return byRelation('home');
  if ((own ? OWN_WORK : WORK_WORDS).test(words) && byRelation('work')) return byRelation('work');
  let best: { place: OfferPlace; score: number } | undefined;
  for (const place of places) {
    const name = plain(place.name).toLowerCase();
    let score = 0;
    if (words.includes(name)) score = name.length + 100;
    else {
      const numbers = name.match(/\b\d{2,5}\b/g) ?? [];
      if (numbers.some((number) => new RegExp(`\\b${number}\\b`).test(words))) score = 50;
      const significant = name.split(/[^a-z0-9']+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word));
      if (significant.length > 0 && significant.every((word) => words.includes(word))) score = Math.max(score, significant.join('').length);
    }
    if (score > 0 && (!best || score > best.score)) best = { place, score };
  }
  return best?.place;
}

/** The card a line asks for among `items`: their home's or their work's by the words it uses, else the only one. */
function itemIn(line: string, items: OfferItem[]): OfferItem | undefined {
  const words = plain(line).toLowerCase();
  if (/\b(?:home|apartment|flat|place|where you live|door)\b/.test(words)) {
    const home = items.find((item) => /\b(?:apartment|home|key card)\b/i.test(item.name));
    if (home) return home;
  }
  if (/\b(?:work|office|staff|job|service|security|back room)\b/.test(words)) {
    const work = items.find((item) => /\b(?:staff|service|security|office)\b/i.test(item.name));
    if (work) return work;
  }
  return items[0];
}

/**
 * The sum of credits a line names, or undefined: a number of 1 to 4 digits,
 * or one to twenty, thirty, forty, fifty or a hundred in words, next to a
 * money word ("10 credits", "twenty cr") or within 20 characters after a
 * word that pays ("lend me 5", "here's 20", "for 8"). A number that is an
 * address, a count or a time ("floor 14", "apartment 1407", "5 minutes",
 * "give me 2 beers") is none.
 */
export function amountIn(text: string): number | undefined {
  const line = plain(text);
  for (const match of line.matchAll(SUM)) {
    const value = match[1] !== undefined ? Number(match[1]) : match[2] !== undefined ? 100 : NUMBER_WORDS[match[3]!.toLowerCase()]!;
    if (value < 1) continue;
    const start = match.index;
    const end = start + match[0].length;
    const before = line.slice(0, start);
    const after = line.slice(end);
    if (MONEY_WORD.test(after)) return value;
    if (NOT_SUM_BEFORE.test(before.trimEnd()) || NOT_SUM_AFTER.test(after) || !AFTER_SUM.test(after)) continue;
    // "one" alone is a thing ("this one") unless money is named.
    if (match[3]?.toLowerCase() === 'one') continue;
    const verbs = [...before.matchAll(MONEY_VERB)];
    const last = verbs.at(-1);
    if (last && start - (last.index + last[0].length) <= 20) return value;
  }
  return undefined;
}

/** The sum the player's line holds out to the person ("Here's 10 credits for your trouble"), when they have that much. */
export function heldOut(line: string, credits: OfferCredits | undefined): number | undefined {
  if (!credits || !ASK_PAY.test(plain(line))) return undefined;
  const amount = amountIn(line);
  return amount !== undefined && amount <= credits.purse ? amount : undefined;
}

/** The talk's offers with the sum the player's line holds out, unless the host already gave one. */
export function withHeldOut(options: OfferOptions | undefined, line: string): OfferOptions | undefined {
  const credits = options?.credits;
  if (!credits || credits.offered !== undefined) return options;
  const offered = heldOut(line, credits);
  return offered === undefined ? options : { ...options, credits: { ...credits, offered } };
}

/** The item a line names among `items`: the one with the most of its words of four letters or more in the line, else the only one. */
export function thingIn<T extends OfferItem | PricedItem>(line: string, items: T[], named = false): T | undefined {
  const words = plain(line).toLowerCase();
  let best: { item: T; score: number } | undefined;
  for (const item of items) {
    const significant = [...new Set(plain(item.name).toLowerCase().split(/[^a-z0-9']+/).filter((word) => word.length > 3 && !ITEM_STOP.has(word)))];
    const score = significant.filter((word) => new RegExp(`\\b${word}`).test(words)).length;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  if (best) return best.item;
  return !named && items.length === 1 ? items[0] : undefined;
}

/** What the player's line asks of the person, of what they may do now, or undefined. */
export function askedOf(line: string, options: OfferOptions = {}): CompanionOffer | undefined {
  const text = plain(line);
  const places = options.places ?? [];
  const items = options.give?.items ?? [];
  const credits = options.credits;
  if (options.contact && ASK_CONTACT.test(text)) return { kind: 'contact' };
  // Money named beside a sum is money, not a thing: "here's the 10 credits".
  const money = moneyIn(text);
  const taken = options.take?.items ?? [];
  if (taken.length > 0 && !money && ASK_THING.test(text)) {
    const item = thingIn(text, taken);
    if (item) return { kind: 'take', itemId: item.itemId, name: item.name };
  }
  if (credits && ASK_PAY.test(text)) {
    const amount = amountIn(text);
    if (amount !== undefined && amount <= credits.purse) return { kind: 'accept', amount };
  }
  if (credits && ASK_MONEY.test(text)) {
    const amount = amountIn(text);
    if (amount !== undefined && amount <= credits.carried) return { kind: 'pay', amount };
  }
  const sold = options.sell?.items ?? [];
  if (sold.length > 0 && ASK_BUY.test(text)) {
    const item = thingIn(text, sold, true);
    if (item) return { kind: 'sell', itemId: item.itemId, name: item.name, price: item.price };
  }
  const bought = options.buy?.items ?? [];
  if (bought.length > 0 && ASK_SELL.test(text)) {
    const item = thingIn(text, bought, true);
    const amount = item && Math.min(amountIn(text) ?? item.price, item.price, credits?.carried ?? Infinity);
    if (item && amount !== undefined && amount >= 1) return { kind: 'buy', itemId: item.itemId, name: item.name, amount };
  }
  if (items.length > 0 && ASK_CARD.test(text)) {
    const item = itemIn(text, items);
    if (item) return { kind: 'give', itemId: item.itemId, name: item.name };
  }
  // One of the things they carry, by its name: "can I have your flask?".
  const things = items.filter((item) => !item.copy);
  if (things.length > 0 && ASK_GIVE.test(text)) {
    const item = thingIn(text, things, true);
    if (item) return { kind: 'give', itemId: item.itemId, name: item.name };
  }
  if (options.stop && ASK_STOP.test(text)) return { kind: 'stop' };
  if (options.home && ASK_HOME.test(text)) return { kind: 'home' };
  if (options.work && ASK_WORK.test(text)) return { kind: 'work' };
  if (ASK_LEAD.test(text)) {
    const place = placeIn(text, places);
    if (place) return { kind: 'lead', placeId: place.placeId, name: place.name };
  }
  if (options.follow && ASK_FOLLOW.test(text)) return { kind: 'follow' };
  if (options.walk && ASK_WALK.test(text)) {
    const place = placeIn(text, places);
    if (place) return { kind: 'walk', placeId: place.placeId, name: place.name };
  }
  if (options.wait && ASK_WAIT.test(text)) return { kind: 'wait' };
  if (options.sit && ASK_SIT.test(text)) return { kind: 'sit' };
  return undefined;
}

/**
 * What the last exchange left on the table, from the turns said so far: a
 * place the person offered to take the player to ("Want me to walk you
 * there?" after "Show me where you live" is their home), their offer to come
 * along, or what the player asked that the person neither agreed to nor
 * refused. Undefined when nothing is pending.
 */
export function pendingOf(turns: DialogLine[] = [], options: OfferOptions = {}): Pending | undefined {
  const last = turns.length - 1;
  if (last < 0 || turns[last]!.speaker !== 'npc') return undefined;
  const said = turns[last]!.text;
  let asked: string | undefined;
  for (let index = last - 1; index >= 0; index--) {
    if (turns[index]!.speaker === 'player') {
      asked = turns[index]!.text;
      break;
    }
  }
  const request = asked ? askedOf(asked, options) : undefined;
  const places = options.places ?? [];
  if (OFFER_LEAD.test(plain(said))) {
    const place = placeIn(said, places, true) ?? (request?.kind === 'lead' ? places.find((entry) => entry.placeId === request.placeId) : undefined);
    if (place) return { offer: { kind: 'lead', placeId: place.placeId, name: place.name }, by: 'npc' };
  }
  if (options.follow && OFFER_FOLLOW.test(plain(said))) return { offer: { kind: 'follow' }, by: 'npc' };
  if (request && stanceOf(said) === 'none') return { offer: request, by: 'player' };
  return undefined;
}

/** Whether an offer is still one the person may make now: within the same bounds a tool call is held to. */
function allowed(offer: CompanionOffer, options: OfferOptions): boolean {
  if (offer.kind === 'lead' || offer.kind === 'walk') {
    if (offer.kind === 'walk' && !options.walk) return false;
    return (options.places ?? []).some((place) => place.placeId === offer.placeId);
  }
  if (offer.kind === 'give') return (options.give?.items ?? []).some((item) => item.itemId === offer.itemId);
  if (offer.kind === 'take') return (options.take?.items ?? []).some((item) => item.itemId === offer.itemId);
  const credits = options.credits;
  const whole = (amount: number) => Number.isInteger(amount) && amount >= 1 && amount <= 1000;
  if (offer.kind === 'pay') return Boolean(credits && whole(offer.amount) && offer.amount <= credits.carried);
  // Held out by this line, or by the line before when the person had not answered it yet.
  if (offer.kind === 'accept') return Boolean(credits && whole(offer.amount) && offer.amount <= credits.purse && (credits.offered === undefined || offer.amount <= credits.offered));
  if (offer.kind === 'ask') return Boolean(credits && whole(offer.amount));
  if (offer.kind === 'sell') return (options.sell?.items ?? []).some((item) => item.itemId === offer.itemId && item.price === offer.price);
  if (offer.kind === 'buy') {
    const item = (options.buy?.items ?? []).find((entry) => entry.itemId === offer.itemId);
    return Boolean(item && whole(offer.amount) && offer.amount <= item.price && (credits === undefined || offer.amount <= credits.carried));
  }
  if (offer.kind === 'meet') return Boolean(options.meet);
  const option = { follow: 'follow', stop: 'stop', home: 'home', work: 'work', wait: 'wait', sit: 'sit', contact: 'contact' }[offer.kind];
  return Boolean(option && options[option as keyof OfferOptions]);
}

/**
 * The offers a reply makes in words, when its tool calls made `made`:
 * - the player accepts what the person offered a moment ago: that offer,
 *   unless the reply refuses, and in place of a walk or a follow the model
 *   called for an errand of its own;
 * - the player asks for something and the reply agrees: what they asked;
 * - the reply agrees to what the player asked a moment ago: that;
 * - the reply says it leads the way to a place it or the talk names: a lead.
 * What the model called stands otherwise. Only what `options` allows.
 */
export function inferOffers(input: {
  line: string;
  reply: string;
  turns?: DialogLine[];
  options?: OfferOptions;
  made?: CompanionOffer[];
}): CompanionOffer[] {
  const options = input.options ?? {};
  const made = input.made ?? [];
  if (declines(input.line)) return made;
  const pending = pendingOf(input.turns, options);
  const stance = stanceOf(input.reply);
  const ok = (offer: CompanionOffer | undefined): offer is CompanionOffer => Boolean(offer && allowed(offer, options));

  if (pending?.by === 'npc' && accepts(input.line) && stance !== 'refuse' && ok(pending.offer)) {
    const leads = made.some((offer) => offer.kind === 'lead');
    if (pending.offer.kind === 'lead' && !leads) return [pending.offer, ...made.filter((offer) => offer.kind !== 'walk' && offer.kind !== 'follow')];
    if (made.length === 0) return [pending.offer];
    return made;
  }
  if (made.length > 0) return made;
  const asked = askedOf(input.line, options);
  // A thank-you takes what was handed or held out.
  if (stance === 'none' && asked && (asked.kind === 'take' || asked.kind === 'accept') && THANKS.test(plain(input.reply)) && ok(asked)) return [asked];
  if (stance !== 'agree') return [];
  if (ok(asked)) return [asked];
  if (pending && ok(pending.offer) && (pending.by === 'player' || accepts(input.line))) return [pending.offer];
  if (SAYS_LEAD.test(plain(input.reply))) {
    const place = placeIn(input.reply, options.places, true) ?? placeIn(input.line, options.places);
    if (place) return [{ kind: 'lead', placeId: place.placeId, name: place.name }];
  }
  return [];
}

/** The line the prompt adds for what is pending, keyed for offers.md: the tool to call when the player's line takes it up. */
export function pendingPrompt(pending: Pending | undefined): { key: string; values: Record<string, string> } | undefined {
  if (!pending) return undefined;
  const offer = pending.offer;
  const tool = TOOLS[offer.kind];
  if (pending.by === 'player') {
    if (offer.kind === 'take') return { key: 'pending-offered-item', values: { tool, name: offer.name, itemId: offer.itemId } };
    if (offer.kind === 'sell') return { key: 'pending-asked-item', values: { tool, name: offer.name, itemId: offer.itemId } };
    if (offer.kind === 'buy') return { key: 'pending-offered-buy', values: { tool, name: offer.name, itemId: offer.itemId, amount: String(offer.amount) } };
    if (offer.kind === 'pay') return { key: 'pending-asked-amount', values: { tool, amount: String(offer.amount) } };
    if (offer.kind === 'accept') return { key: 'pending-offered-amount', values: { tool, amount: String(offer.amount) } };
  }
  const place = offer.kind === 'lead' || offer.kind === 'walk' ? offer.name : '';
  const placeId = offer.kind === 'lead' || offer.kind === 'walk' ? offer.placeId : '';
  if (pending.by === 'npc') {
    return offer.kind === 'lead'
      ? { key: 'pending-lead', values: { place, placeId } }
      : { key: 'pending-offer', values: { tool } };
  }
  return { key: 'pending-asked', values: { tool, ...(place ? { place: ` to ${place} (placeId ${placeId})` } : { place: '' }) } };
}

const TOOLS: Record<CompanionOffer['kind'], string> = {
  follow: 'come_along',
  lead: 'take_them_to',
  walk: 'walk_to',
  stop: 'stop',
  home: 'go_home',
  work: 'go_to_work',
  wait: 'wait_here',
  sit: 'sit',
  contact: 'give_number',
  meet: 'meet_them',
  give: 'give_item',
  take: 'take_item',
  pay: 'give_credits',
  accept: 'take_credits',
  ask: 'ask_credits',
  sell: 'sell_item',
  buy: 'buy_item',
};

/** Whether a line names a sum beside a money word: "10 credits", "twenty cr". */
function moneyIn(text: string): boolean {
  for (const match of text.matchAll(SUM)) {
    if (MONEY_WORD.test(text.slice(match.index + match[0].length))) return true;
  }
  return false;
}
