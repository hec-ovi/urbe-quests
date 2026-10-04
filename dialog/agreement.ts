/**
 * Words and actions agree. The model is asked to call a tool whenever its
 * person agrees to something, but a reply may agree in words alone. This
 * reads what the player's line asks, what the reply says to it, and what the
 * person offered or was asked a moment ago, against what the person may do
 * now (the talk's offers), so a reply that says "Fine" to "come with me"
 * still comes along, and "I follow you" after "Want me to walk you there?"
 * goes there.
 */

import type { CompanionOffer, OfferItem, OfferOptions, OfferPlace } from './offers.js';
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

/** What the player's line asks of the person, of what they may do now, or undefined. */
export function askedOf(line: string, options: OfferOptions = {}): CompanionOffer | undefined {
  const text = plain(line);
  const places = options.places ?? [];
  const items = options.give?.items ?? [];
  if (options.contact && ASK_CONTACT.test(text)) return { kind: 'contact' };
  if (items.length > 0 && ASK_CARD.test(text)) {
    const item = itemIn(text, items);
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

/** Whether an offer is still one the person may make now. */
function allowed(offer: CompanionOffer, options: OfferOptions): boolean {
  if (offer.kind === 'lead' || offer.kind === 'walk') {
    if (offer.kind === 'walk' && !options.walk) return false;
    return (options.places ?? []).some((place) => place.placeId === offer.placeId);
  }
  if (offer.kind === 'give') return (options.give?.items ?? []).some((item) => item.itemId === offer.itemId);
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
  if (stance !== 'agree') return [];
  const asked = askedOf(input.line, options);
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
  follow: 'follow_player',
  lead: 'lead_player_to',
  walk: 'walk_to',
  stop: 'stop',
  home: 'go_home',
  work: 'go_to_work',
  wait: 'wait_here',
  sit: 'sit',
  contact: 'give_number',
  meet: 'meet_player',
  give: 'give_item',
};
