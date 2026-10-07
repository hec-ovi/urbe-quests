/**
 * Words and actions agree: a reply that agrees in words alone still does what
 * it says, and an acceptance of what the person offered goes where it was
 * offered, read through Converse over a model that calls no tools.
 */

import { describe, expect, it } from 'vitest';
import type { ChatDelta, ChatRequest } from '../../ports/chat.js';
import type { StreamingLLMPort } from '../../ports/llm.js';
import { accepts, amountIn, askedOf, heldOut, inferOffers, pendingOf, pendingPrompt, placeIn, stanceOf, thingIn, withHeldOut } from '../agreement.js';
import { Converse, type ReplyEvent } from '../Converse.js';
import type { OfferOptions } from '../offers.js';
import type { DialogContext, DialogLine } from '../schema.js';

const context: DialogContext = { npcId: 'a59987', segments: [{ id: 'npc', text: 'NPC LAYER', shared: false }] };

const HOME = { placeId: 'p1724', name: 'Seventh Avenue, floor 7, apartment 701', relation: 'home' };
const SHOP = { placeId: 'p1688', name: 'Corner Mart', relation: 'venue' };
const CAFE = { placeId: 'p1322', name: 'Noodle Saint', relation: 'venue' };
const WORK = { placeId: 'p2', name: 'Fifteenth Street works', relation: 'work' };
const CARD = { itemId: 'card:home:p1724/floor:7/f7-unit-1', name: 'Seventh Avenue 701 key card, which opens Seventh Avenue, floor 7, apartment 701' };
const OFFERS: OfferOptions = { follow: true, walk: true, stop: false, home: true, work: true, wait: true, sit: true, contact: true, places: [HOME, SHOP, CAFE, WORK], give: { items: [CARD] } };

/** A model that says `words` and calls no tool, and keeps what it was asked. */
function wordsOnly(words: string) {
  const requests: ChatRequest[] = [];
  const port: StreamingLLMPort = {
    complete: async () => '',
    async *stream(request) {
      requests.push(structuredClone(request));
      yield { content: words } as ChatDelta;
    },
  };
  return { port, requests };
}

async function offered(line: string, words: string, turns: DialogLine[] = [], offers = OFFERS) {
  const { port, requests } = wordsOnly(words);
  const seen: ReplyEvent[] = [];
  for await (const event of new Converse(port).replyStream({ context, name: 'Pearl Vance', line, offers, turns })) seen.push(event);
  return { offers: seen.flatMap((event) => (event.type === 'offer' ? [event] : [])), done: seen.at(-1), requests };
}

const PEARL: DialogLine[] = [
  { speaker: 'player', text: 'Show me where you live' },
  { speaker: 'npc', text: 'Seventh Avenue, near the corner of Sixth. Floor seven, apartment 701. You’ll know the building when you see it—charcoal and steel, not much prettier than the rest. Want me to walk you there, or do you think you can navigate on your own?' },
];

describe('words and actions agree', () => {
  it('takes "i follow you" after the person offered to walk the player home as a lead to that home, not a tag-along on an errand of theirs', async () => {
    const { offers, requests } = await offered(
      'i follow you',
      'Fine. Keep up then, but don’t drag your feet. I’m heading to that shop on the corner to kill some time before I have to be somewhere else.',
      PEARL,
    );
    expect(offers).toEqual([{ type: 'offer', kind: 'lead', placeId: 'p1724', name: HOME.name }]);
    // The prompt said so too: the offer stands, and accepting it is a lead there.
    expect(requests[0]!.messages[1]!.content).toContain('A moment ago you offered to take them to Seventh Avenue, floor 7, apartment 701. If what they say now accepts, that is their consent: call take_them_to with placeId p1724');
    expect(requests[0]!.messages[0]!.content).toContain('never make up a shop, a bar or a corner to head for');
  });

  it('turns a walk_to the model called for its own errand into the lead the player accepted', async () => {
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream() {
        yield { content: 'Fine. Keep up.' };
        yield { tool_calls: [{ index: 0, id: 'c1', function: { name: 'walk_to', arguments: '{"placeId":"p1688"}' } }] };
      },
    };
    const seen: ReplyEvent[] = [];
    for await (const event of new Converse(port).replyStream({ context, name: 'Pearl Vance', line: 'ok lead the way', offers: OFFERS, turns: PEARL })) seen.push(event);
    expect(seen.filter((event) => event.type === 'offer')).toEqual([{ type: 'offer', kind: 'lead', placeId: 'p1724', name: HOME.name }]);
  });

  it('comes along when the person says "Fine" to "come with me", and calls nothing when they refuse', async () => {
    expect((await offered('Come with me', 'Fine, you lead. Just keep your distance from the mess.')).offers).toEqual([{ type: 'offer', kind: 'follow' }]);
    expect((await offered('why dont you follow me and we find coffee shop?', 'You think I’m going to drop everything for caffeine? Bold move. But fine, lead on.')).offers).toEqual([{ type: 'offer', kind: 'follow' }]);
    expect((await offered('Come with me', 'Not a chance. I’m busy.')).offers).toEqual([]);
    expect((await offered('Come with me', 'Where to? And why should I?')).offers).toEqual([]);
  });

  it('leads, walks, gives a number and hands a card over on words alone', async () => {
    expect((await offered('Show me where you live', 'Fine, follow me. It’s not far.')).offers).toEqual([{ type: 'offer', kind: 'lead', placeId: 'p1724', name: HOME.name }]);
    expect((await offered('Can you go to Noodle Saint and wait for me there?', 'Sure, I’ll head over.')).offers).toEqual([{ type: 'offer', kind: 'walk', placeId: 'p1322', name: 'Noodle Saint' }]);
    expect((await offered('Can I have your number?', 'Sure. Call me when you need me.')).offers).toEqual([{ type: 'offer', kind: 'contact' }]);
    expect((await offered('Can you give me access to your apartment?', 'Here. Don’t lose it.')).offers).toEqual([{ type: 'offer', kind: 'give', itemId: CARD.itemId, name: CARD.name }]);
    expect((await offered('Can I have your number?', 'I don’t give my number to strangers.')).offers).toEqual([]);
  });

  it('does what the player asked a moment ago once the person agrees to it, and nothing the talk does not allow', async () => {
    const asked: DialogLine[] = [{ speaker: 'player', text: 'Show me where you live' }, { speaker: 'npc', text: 'Sixth floor. Apartment 601. Seventh Avenue.' }];
    expect(pendingOf(asked, OFFERS)).toEqual({ offer: { kind: 'lead', placeId: 'p1724', name: HOME.name }, by: 'player' });
    expect((await offered('but you are going there now correct? sorry i am new!', 'Yes, I’m going there. I live there.', asked)).offers)
      .toEqual([{ type: 'offer', kind: 'lead', placeId: 'p1724', name: HOME.name }]);
    expect((await offered('Come with me', 'Fine.', [], { places: [HOME] })).offers).toEqual([]);
    expect((await offered('no thanks', 'Suit yourself.', PEARL)).offers).toEqual([]);
  });

  it('reads stances, acceptances, asks and places', () => {
    expect(stanceOf('No problem, come on.')).toBe('agree');
    expect(stanceOf('Sure, I’m not going anywhere with you.')).toBe('refuse');
    expect(stanceOf('Help me? You’re asking me? Fine.')).toBe('agree');
    expect(stanceOf('Factory operator. I run the line.')).toBe('none');
    expect(accepts('which window? okey i follow you rthen')).toBe(true);
    expect(accepts('ok')).toBe(true);
    expect(accepts('no, I know the way')).toBe(false);
    expect(askedOf('Show me where you work', OFFERS)).toEqual({ kind: 'lead', placeId: 'p2', name: WORK.name });
    expect(askedOf('take me to 701', OFFERS)).toEqual({ kind: 'lead', placeId: 'p1724', name: HOME.name });
    expect(askedOf('go home', OFFERS)).toEqual({ kind: 'home' });
    expect(askedOf('i can follow you', OFFERS)).toBeUndefined();
    expect(placeIn('my place is up there', [HOME, SHOP], true)).toEqual(HOME);
    expect(inferOffers({ line: 'hello', reply: 'Follow me, the noodle saint is close.', options: OFFERS })).toEqual([{ kind: 'lead', placeId: 'p1322', name: 'Noodle Saint' }]);
  });
});

const WHISKY = { itemId: 'quest:DRINK_WHISKY_KESSEL', name: 'amber whisky' };
const MYCARD = { itemId: 'own:card-records', name: 'records floor 3 card' };
const COFFEE = { itemId: 'coffee', name: 'cup of coffee', price: 3 };
const WHISKY_GLASS = { itemId: 'whisky', name: 'glass of whisky', price: 18 };
const WATCH = { itemId: 'own:watch-1', name: 'a pocket watch', price: 7 };
const TRADE: OfferOptions = {
  ...OFFERS,
  take: { items: [WHISKY, MYCARD] },
  credits: { carried: 30, purse: 40 },
  sell: { items: [COFFEE, WHISKY_GLASS] },
  buy: { items: [WATCH] },
};

describe('things and money change hands in words', () => {
  it('reads the sum a line names, and no address, count or time', () => {
    expect(amountIn("here's 10 credits")).toBe(10);
    expect(amountIn('twenty cr')).toBe(20);
    expect(amountIn('Can you lend me 5?')).toBe(5);
    expect(amountIn('I will pay you fifty for it')).toBe(50);
    expect(amountIn('a hundred credits, no less')).toBe(100);
    expect(amountIn('Take these 12 notes.')).toBe(12);
    expect(amountIn('floor 14')).toBeUndefined();
    expect(amountIn('apartment 1407')).toBeUndefined();
    expect(amountIn('I am looking for apartment 1407')).toBeUndefined();
    expect(amountIn('give me 5 minutes')).toBeUndefined();
    expect(amountIn('can you give me 2 beers')).toBeUndefined();
    expect(amountIn('take this one')).toBeUndefined();
    expect(amountIn('one credit')).toBe(1);
    expect(amountIn('meet me at 10')).toBeUndefined();
  });

  it('reads credits held out only when the player has them', () => {
    expect(heldOut("Here's 10 credits for your trouble.", { carried: 0, purse: 40 })).toBe(10);
    expect(heldOut("Here's 10 credits for your trouble.", { carried: 0, purse: 5 })).toBeUndefined();
    expect(heldOut('Can you lend me 10?', { carried: 30, purse: 40 })).toBeUndefined();
    expect(heldOut("Here's 10 credits", undefined)).toBeUndefined();
    expect(withHeldOut({ credits: { carried: 3, purse: 40 } }, 'A tip, 5 cr.')).toEqual({ credits: { carried: 3, purse: 40, offered: 5 } });
    // What the host held out stands.
    expect(withHeldOut({ credits: { carried: 3, purse: 40, offered: 20 } }, 'A tip, 5 cr.')).toEqual({ credits: { carried: 3, purse: 40, offered: 20 } });
    expect(thingIn('Here, have the whisky', [WHISKY, MYCARD])).toEqual(WHISKY);
    expect(thingIn('Here, this is for you', [WHISKY])).toEqual(WHISKY);
    expect(thingIn('Here, this is for you', [WHISKY, MYCARD])).toBeUndefined();
    expect(thingIn('one coffee', [COFFEE], true)).toEqual(COFFEE);
    expect(thingIn('something', [COFFEE], true)).toBeUndefined();
  });

  it('reads what the player asks: take, accept, pay, sell and buy', () => {
    expect(askedOf('Here, take the whisky.', TRADE)).toEqual({ kind: 'take', ...WHISKY });
    expect(askedOf('I brought you this whisky', TRADE)).toEqual({ kind: 'take', ...WHISKY });
    expect(askedOf("Here's 10 credits for your help.", TRADE)).toEqual({ kind: 'accept', amount: 10 });
    expect(askedOf("Here's 10 credits for your help.", { ...TRADE, credits: { carried: 30, purse: 5 } })).toBeUndefined();
    expect(askedOf('Can you lend me 5?', TRADE)).toEqual({ kind: 'pay', amount: 5 });
    expect(askedOf('Can you lend me 50?', TRADE)).toBeUndefined();
    expect(askedOf("I'll have a cup of coffee, please.", TRADE)).toEqual({ kind: 'sell', itemId: 'coffee', name: 'cup of coffee', price: 3 });
    expect(askedOf('Can I get a whisky?', TRADE)).toEqual({ kind: 'sell', itemId: 'whisky', name: 'glass of whisky', price: 18 });
    expect(askedOf('Would you buy my pocket watch?', TRADE)).toEqual({ kind: 'buy', itemId: WATCH.itemId, name: WATCH.name, amount: 7 });
    expect(askedOf('Would you buy my pocket watch for 5 credits?', TRADE)).toEqual({ kind: 'buy', itemId: WATCH.itemId, name: WATCH.name, amount: 5 });
    expect(askedOf('Would you buy my pocket watch for 50 credits?', TRADE)).toMatchObject({ kind: 'buy', amount: 7 });
    // Handing a card over is no asking for one, and asking a price is no order.
    expect(askedOf('here, take this card', { ...TRADE, take: { items: [MYCARD] } })).toEqual({ kind: 'take', ...MYCARD });
    expect(askedOf('Can you give me access to your apartment?', TRADE)).toEqual({ kind: 'give', itemId: CARD.itemId, name: CARD.name });
    expect(askedOf('how much is the whisky', TRADE)).toBeUndefined();
    // One of the things they carry, asked for by its name; a copy of a card stays with the card ask.
    const FLASK = { itemId: 'carry:flask', name: 'a hip flask of schnapps' };
    const carrying = { ...TRADE, give: { items: [{ ...CARD, copy: true }, FLASK] } };
    expect(askedOf('Could you lend me your flask?', carrying)).toEqual({ kind: 'give', itemId: FLASK.itemId, name: FLASK.name });
    expect(askedOf('Can I have your key card?', carrying)).toEqual({ kind: 'give', itemId: CARD.itemId, name: CARD.name });
    expect(askedOf('Can I have something?', carrying)).toBeUndefined();
    expect(askedOf("I'll take the coffee", { ...TRADE, take: { items: [WHISKY] } })).toEqual({ kind: 'sell', itemId: 'coffee', name: 'cup of coffee', price: 3 });
    expect(askedOf("Here's the 10 credits", { ...TRADE, take: { items: [WHISKY] } })).toEqual({ kind: 'accept', amount: 10 });
  });

  it('makes no offer for a price asked', async () => {
    expect((await offered('how much is the whisky', 'Eighteen. Sure.', [], TRADE)).offers).toEqual([]);
  });

  it('hands money over when the person agrees in words, and nothing when they refuse', async () => {
    expect((await offered('Can you lend me 5?', 'Here you go.', [], TRADE)).offers).toEqual([{ type: 'offer', kind: 'pay', amount: 5 }]);
    expect((await offered('Can you lend me 5?', 'No.', [], TRADE)).offers).toEqual([]);
    expect(inferOffers({ line: 'Can you lend me 5?', reply: 'Here you go.', options: TRADE })).toEqual([{ kind: 'pay', amount: 5 }]);
    expect(inferOffers({ line: 'Can you lend me 5?', reply: 'No.', options: TRADE })).toEqual([]);
    // A pending ask the person takes up a turn later.
    const asked: DialogLine[] = [{ speaker: 'player', text: 'Can you lend me 5?' }, { speaker: 'npc', text: 'What for?' }];
    expect(pendingOf(asked, TRADE)).toEqual({ offer: { kind: 'pay', amount: 5 }, by: 'player' });
    expect(pendingPrompt(pendingOf(asked, TRADE))).toEqual({ key: 'pending-asked-amount', values: { tool: 'give_credits', amount: '5' } });
    expect(inferOffers({ line: 'please', reply: 'Fine.', turns: asked, options: TRADE })).toEqual([{ kind: 'pay', amount: 5 }]);
    expect((await offered('please', 'Fine.', asked, TRADE)).offers).toEqual([{ type: 'offer', kind: 'pay', amount: 5 }]);
  });

  it('takes what is handed or held out on a thank-you, and money held out a turn before', async () => {
    expect((await offered('Here, take the whisky.', 'Thank you. Kind of you.', [], TRADE)).offers).toEqual([{ type: 'offer', kind: 'take', ...WHISKY }]);
    expect((await offered("Here's 10 credits for your help.", 'Thanks.', [], TRADE)).offers).toEqual([{ type: 'offer', kind: 'accept', amount: 10 }]);
    expect((await offered("Here's 10 credits for your help.", 'Thanks, but I cannot take that.', [], TRADE)).offers).toEqual([]);
    expect((await offered('Come with me', 'Thanks for asking. I have somewhere to be.', [], TRADE)).offers).toEqual([]);
    const held: DialogLine[] = [{ speaker: 'player', text: "Here's 10 credits." }, { speaker: 'npc', text: 'What is this for?' }];
    expect(pendingPrompt(pendingOf(held, TRADE))).toEqual({ key: 'pending-offered-amount', values: { tool: 'take_credits', amount: '10' } });
    expect((await offered('For your help earlier.', 'All right.', held, TRADE)).offers).toEqual([{ type: 'offer', kind: 'accept', amount: 10 }]);
  });

  it('never makes money or a thing change hands on the person\'s own words alone', async () => {
    expect((await offered('hello', 'Here, take 5 credits for the tram.', [], TRADE)).offers).toEqual([]);
    expect((await offered('Nice day.', 'Sure. I could sell you a coffee.', [], TRADE)).offers).toEqual([]);
  });
});
