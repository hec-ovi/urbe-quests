/**
 * The trade tools: the same list for every person and turn, what this person
 * may do with things and money now in the turn's message, and every tool
 * call held to the money and things on the table.
 */

import { describe, expect, it } from 'vitest';
import type { ChatToolCall } from '../../ports/chat.js';
import { offerKey, offerListing, offerOf, offersAnything, offerTools, type OfferOptions } from '../offers.js';

const call = (name: string, args: Record<string, unknown> | string = {}): ChatToolCall => ({
  id: 'c1', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
});

const CARD = { itemId: 'card:home:p404/floor:14/f14-home-7', name: 'Kessler Block 1407 key card, which opens apartment 1407', copy: true };
const FLASK = { itemId: 'carry:flask', name: 'a hip flask of schnapps' };
const WHISKY = { itemId: 'quest:DRINK_WHISKY_KESSEL', name: 'amber whisky' };
const WATCH = { itemId: 'own:watch-1', name: 'a pocket watch', price: 7 };
const COFFEE = { itemId: 'coffee', name: 'cup of coffee', price: 3 };
const PASTRY = { itemId: 'pastry', name: 'pastry', price: 3 };

const TRADE: OfferOptions = {
  give: { items: [CARD, FLASK] },
  take: { items: [WHISKY] },
  credits: { carried: 30, purse: 40 },
  sell: { items: [COFFEE, PASTRY] },
  buy: { items: [WATCH] },
};

describe('trade tools', () => {
  it('sends one tool list, the same whatever the person may do, with the six trade tools after give_item', () => {
    const names = offerTools(TRADE).map((tool) => tool.function.name);
    expect(names).toEqual([
      'come_along', 'take_them_to', 'walk_to', 'stop', 'go_home', 'go_to_work', 'wait_here', 'sit', 'give_number', 'meet_them', 'give_item',
      'take_item', 'give_credits', 'take_credits', 'ask_credits', 'sell_item', 'buy_item',
    ]);
    expect(offerTools({ follow: true })).toEqual(offerTools(TRADE));
    expect(offerTools({ credits: { carried: 0, purse: 0 } })).toEqual(offerTools(TRADE));
    expect(offerTools({})).toEqual([]);
    const byName = Object.fromEntries(offerTools(TRADE).map((tool) => [tool.function.name, tool.function]));
    expect(byName.give_credits!.parameters).toMatchObject({ required: ['amount'], properties: { amount: { type: 'integer', minimum: 1, maximum: 1000 } } });
    expect(byName.buy_item!.parameters).toMatchObject({ required: ['itemId', 'amount'] });
    expect(byName.give_item!.description).toContain('Anything else leaves your hands for theirs');
  });

  it('may agree to something whenever money or things are on the table', () => {
    expect(offersAnything({ credits: { carried: 0, purse: 0 } })).toBe(true);
    expect(offersAnything({ take: { items: [WHISKY] } })).toBe(true);
    expect(offersAnything({ sell: { items: [COFFEE] } })).toBe(true);
    expect(offersAnything({ buy: { items: [WATCH] } })).toBe(true);
    expect(offersAnything({ take: { items: [] }, sell: { items: [] }, buy: { items: [] } })).toBe(false);
  });

  it('lists what they can hand over, take, pay, ask, sell and buy now', () => {
    const listing = offerListing(TRADE);
    expect(listing).toContain('What you can do for them right now: give_item, take_item, give_credits, ask_credits, sell_item, buy_item.');
    expect(listing).toContain(`What you can hand them, by id:\n- ${CARD.itemId}: ${CARD.name} (a copy; yours stays with you)\n- carry:flask: a hip flask of schnapps`);
    expect(listing).toContain('What they could hand you, by id; take one only when they hand it to you:\n- quest:DRINK_WHISKY_KESSEL: amber whisky');
    expect(listing).toContain('You have 30 credits on you.');
    expect(listing).not.toContain('They hold out');
    expect(listing).toContain('What you sell here, by id, at its price:\n- coffee: cup of coffee, 3 credits\n- pastry: pastry, 3 credits');
    expect(listing).toContain('Their things you may buy, by id, at the most you would pay:\n- own:watch-1: a pocket watch, up to 7 credits');

    const offered = offerListing({ credits: { carried: 0, purse: 40, offered: 10 } });
    expect(offered).toContain('What you can do for them right now: take_credits, ask_credits.');
    expect(offered).toContain('They hold out 10 credits to you.');
    expect(offered).not.toContain('credits on you');
  });

  it('turns each trade call into its offer, within the money and things on the table', () => {
    expect(offerOf(call('give_item', { itemId: 'carry:flask' }), TRADE)).toEqual({ kind: 'give', itemId: 'carry:flask', name: FLASK.name });
    expect(offerOf(call('take_item', { itemId: WHISKY.itemId }), TRADE)).toEqual({ kind: 'take', ...WHISKY });
    expect(offerOf(call('take_item', { itemId: 'quest:GHOST' }), TRADE)).toBeUndefined();
    expect(offerOf(call('take_item', { itemId: 'carry:flask' }), TRADE)).toBeUndefined();

    // Pay from what they carry, never more, in whole credits.
    expect(offerOf(call('give_credits', { amount: 30 }), TRADE)).toEqual({ kind: 'pay', amount: 30 });
    expect(offerOf(call('give_credits', { amount: 31 }), TRADE)).toBeUndefined();
    expect(offerOf(call('give_credits', { amount: 2.5 }), TRADE)).toBeUndefined();
    expect(offerOf(call('give_credits', { amount: '5' }), TRADE)).toBeUndefined();
    expect(offerOf(call('give_credits', { amount: 0 }), TRADE)).toBeUndefined();
    expect(offerOf(call('give_credits', '{"amount":'), TRADE)).toBeUndefined();

    // Take only what is held out, and only what the other has.
    expect(offerOf(call('take_credits', { amount: 10 }), TRADE)).toBeUndefined();
    const held = { credits: { carried: 30, purse: 40, offered: 10 } };
    expect(offerOf(call('take_credits', { amount: 10 }), held)).toEqual({ kind: 'accept', amount: 10 });
    expect(offerOf(call('take_credits', { amount: 11 }), held)).toBeUndefined();
    expect(offerOf(call('take_credits', { amount: 10 }), { credits: { carried: 30, purse: 5, offered: 10 } })).toBeUndefined();

    // Ask for any whole sum up to a thousand, only while money is on the table.
    expect(offerOf(call('ask_credits', { amount: 1000 }), TRADE)).toEqual({ kind: 'ask', amount: 1000 });
    expect(offerOf(call('ask_credits', { amount: 1001 }), TRADE)).toBeUndefined();
    expect(offerOf(call('ask_credits', { amount: 5 }), { follow: true })).toBeUndefined();

    // Sell at the listed price, whatever else was said.
    expect(offerOf(call('sell_item', { itemId: 'coffee', price: 1 }), TRADE)).toEqual({ kind: 'sell', itemId: 'coffee', name: 'cup of coffee', price: 3 });
    expect(offerOf(call('sell_item', { itemId: 'whisky' }), TRADE)).toBeUndefined();

    // Buy for the sum named, no more than the most listed or what they carry; the price when no sum came.
    expect(offerOf(call('buy_item', { itemId: WATCH.itemId, amount: 5 }), TRADE)).toEqual({ kind: 'buy', itemId: WATCH.itemId, name: WATCH.name, amount: 5 });
    expect(offerOf(call('buy_item', { itemId: WATCH.itemId, amount: 50 }), TRADE)).toMatchObject({ amount: 7 });
    expect(offerOf(call('buy_item', { itemId: WATCH.itemId }), TRADE)).toMatchObject({ amount: 7 });
    expect(offerOf(call('buy_item', { itemId: WATCH.itemId, amount: 7 }), { ...TRADE, credits: { carried: 4, purse: 40 } })).toMatchObject({ amount: 4 });
    expect(offerOf(call('buy_item', { itemId: WATCH.itemId, amount: 7 }), { ...TRADE, credits: { carried: 0, purse: 40 } })).toBeUndefined();
    expect(offerOf(call('buy_item', { itemId: 'own:ghost', amount: 7 }), TRADE)).toBeUndefined();
  });

  it('keeps one offer per thing, and each money offer once', () => {
    expect(offerKey({ kind: 'take', itemId: 'own:a', name: 'a' })).toBe('take:own:a');
    expect(offerKey({ kind: 'sell', itemId: 'coffee', name: 'cup of coffee', price: 3 })).toBe('sell:coffee');
    expect(offerKey({ kind: 'buy', itemId: 'own:a', name: 'a', amount: 2 })).toBe('buy:own:a');
    expect(offerKey({ kind: 'pay', amount: 5 })).toBe('pay');
    expect(offerKey({ kind: 'accept', amount: 5 })).toBe('accept');
    expect(offerKey({ kind: 'ask', amount: 5 })).toBe('ask');
  });
});
