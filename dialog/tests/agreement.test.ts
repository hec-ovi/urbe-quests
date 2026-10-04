/**
 * Words and actions agree: a reply that agrees in words alone still does what
 * it says, and an acceptance of what the person offered goes where it was
 * offered, read through Converse over a model that calls no tools.
 */

import { describe, expect, it } from 'vitest';
import type { ChatDelta, ChatRequest } from '../../ports/chat.js';
import type { StreamingLLMPort } from '../../ports/llm.js';
import { accepts, askedOf, inferOffers, pendingOf, placeIn, stanceOf } from '../agreement.js';
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
    expect(requests[0]!.messages[1]!.content).toContain('A moment ago you offered to take the player to Seventh Avenue, floor 7, apartment 701. If their line accepts, that is their consent: call lead_player_to with placeId p1724');
    expect(requests[0]!.messages[1]!.content).toContain('never make up a shop, a bar or a corner to head for');
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
