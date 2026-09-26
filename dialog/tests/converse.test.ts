/**
 * Contract-surface tests for Converse and the reply cleaner, over fake model
 * ports: cleaned text replies, streamed deltas, offers from tool calls in the
 * same request, the spoken follow-up after a tool-only answer, and failures.
 */

import { describe, expect, it } from 'vitest';
import type { ChatDelta, ChatRequest } from '../../ports/chat.js';
import type { LLMPort, StreamingLLMPort } from '../../ports/llm.js';
import { Converse, type ReplyEvent } from '../Converse.js';
import { cleanReply, ReplyCleaner } from '../ReplyCleaner.js';
import type { DialogContext } from '../schema.js';

const NAMES = ['Mara Voss', 'Mara'];

const context: DialogContext = {
  npcId: 'npc-1',
  segments: [
    { id: 'world', text: 'WORLD LAYER', shared: true },
    { id: 'type', text: 'TYPE LAYER', shared: true },
    { id: 'npc', text: 'NPC LAYER', shared: false },
    { id: 'turns', text: 'TURNS LAYER', shared: false },
  ],
};
const input = { context, name: 'Mara Voss', line: 'Where is the lift?' };

/** A streaming port that plays one scripted delta list per request and keeps what it was sent. */
function streamingPort(...scripts: ChatDelta[][]) {
  const requests: ChatRequest[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const port: StreamingLLMPort = {
    complete: async () => {
      throw new Error('the streaming path never completes');
    },
    async *stream(request, options) {
      requests.push(structuredClone(request));
      signals.push(options?.signal);
      yield* scripts[requests.length - 1] ?? [];
    },
  };
  return { port, requests, signals };
}

async function events(stream: AsyncIterable<ReplyEvent>): Promise<ReplyEvent[]> {
  const seen: ReplyEvent[] = [];
  for await (const event of stream) seen.push(event);
  return seen;
}

const spoken = (seen: ReplyEvent[]) => seen.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('');

describe('cleanReply', () => {
  const cases: [string, string][] = [
    ['<think>plan the answer</think>\n"Not tonight, friend."', 'Not tonight, friend.'],
    ['  Mara Voss: Keep walking.<|im_end|>\n', 'Keep walking.'],
    ['**Mara:** Fine.\nPlayer: And then?\nMara: More.', 'Fine.'],
    ['assistant: The docks flood at night.', 'The docks flood at night.'],
    ['Listen: the docks flood at night.', 'Listen: the docks flood at night.'],
    ['She said "run", so I ran.', 'She said "run", so I ran.'],
    ['Two < three, and <b> stays.', 'Two < three, and <b> stays.'],
    ['Sure.<think>never closed', 'Sure.'],
    ['“Get out.”', 'Get out.'],
  ];

  it('keeps only the words the NPC says', () => {
    for (const [raw, clean] of cases) expect(cleanReply(raw, NAMES)).toBe(clean);
  });

  it('streams to exactly the whole-text result however the text is split', () => {
    for (const [raw, clean] of cases) {
      for (let at = 0; at <= raw.length; at++) {
        const cleaner = new ReplyCleaner(NAMES);
        expect(cleaner.push(raw.slice(0, at)) + cleaner.push(raw.slice(at)) + cleaner.end()).toBe(clean);
      }
      const cleaner = new ReplyCleaner(NAMES);
      expect([...raw].map((char) => cleaner.push(char)).join('') + cleaner.end()).toBe(clean);
    }
  });
});

describe('Converse', () => {
  it('sends the layers in order as the system prompt and the player line as the turn, and cleans the reply', async () => {
    const seen: { system: string; prompt: string }[] = [];
    const llm: LLMPort = {
      async complete(request) {
        seen.push(request);
        return '  Mara Voss: "Not tonight, friend."\n';
      },
    };

    expect(await new Converse(llm).reply(input)).toBe('Not tonight, friend.');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.system).toBe('WORLD LAYER\n\nTYPE LAYER\n\nNPC LAYER\n\nTURNS LAYER');
    expect(seen[0]?.prompt).toContain('"Where is the lift?"');
    expect(seen[0]?.prompt).toContain('Answer as Mara Voss');
  });

  it('rejects a reply with nothing left to say', async () => {
    await expect(new Converse({ complete: async () => '<think>…</think>  ' }).reply(input))
      .rejects.toMatchObject({ code: 'E_LLM' });
    const { port } = streamingPort([{ content: '<think>…</think>' }]);
    await expect(events(new Converse(port).replyStream(input))).rejects.toMatchObject({ code: 'E_LLM' });
  });

  it('streams cleaned text, then the offers its tool calls make, then the whole reply', async () => {
    const { port, requests, signals } = streamingPort([
      { content: 'Mara: "Noodle Saint' },
      { content: ' is two streets down. ' },
      { content: 'Come on."' },
      { tool_calls: [{ index: 0, id: 'c1', function: { name: 'lead_player_to', arguments: '{"place' } }] },
      { tool_calls: [{ index: 0, function: { arguments: 'Id":"p5"}' } }] },
      { tool_calls: [{ index: 1, id: 'c2', function: { name: 'lead_player_to', arguments: '{"placeId":"p99"}' } }] },
      { tool_calls: [{ index: 2, id: 'c3', function: { name: 'follow_player', arguments: '{}' } }] },
    ]);
    const signal = new AbortController().signal;
    const offers = { places: [{ placeId: 'p5', name: 'Noodle Saint' }, { placeId: 'p8', name: 'Precinct 9' }] };

    const seen = await events(new Converse(port).replyStream({ ...input, offers, signal }));

    const reply = 'Noodle Saint is two streets down. Come on.';
    expect(spoken(seen)).toBe(reply);
    expect(seen.slice(-2)).toEqual([
      { type: 'offer', kind: 'lead', placeId: 'p5', name: 'Noodle Saint' },
      { type: 'done', reply, offers: [{ kind: 'lead', placeId: 'p5', name: 'Noodle Saint' }] },
    ]);
    expect(requests).toHaveLength(1);
    expect(signals).toEqual([signal]);
    const [sent] = requests;
    expect(sent!.messages[0]).toEqual({ role: 'system', content: 'WORLD LAYER\n\nTYPE LAYER\n\nNPC LAYER\n\nTURNS LAYER' });
    expect(sent!.messages[1]!.content).toContain('A call only proposes: the player decides.');
    expect(sent!.tools?.map((tool) => tool.function.name)).toEqual(['lead_player_to']);
    const lead = sent!.tools![0]!.function;
    expect(lead.description).toContain('- p5: Noodle Saint\n- p8: Precinct 9');
    expect(lead.parameters).toMatchObject({ required: ['placeId'], properties: { placeId: { enum: ['p5', 'p8'] } } });
  });

  it('answers a tool-only reply and streams the spoken words from a second request without tools', async () => {
    const { port, requests } = streamingPort(
      [{ tool_calls: [{ index: 0, function: { name: 'follow_player', arguments: '{}' } }] }],
      [{ content: 'Fine. Lead on.' }],
    );

    const seen = await events(new Converse(port).replyStream({ ...input, offers: { follow: true } }));

    expect(seen).toEqual([
      { type: 'offer', kind: 'follow' },
      { type: 'delta', text: 'Fine. Lead on.' },
      { type: 'done', reply: 'Fine. Lead on.', offers: [{ kind: 'follow' }] },
    ]);
    expect(requests[0]!.tools?.map((tool) => tool.function.name)).toEqual(['follow_player']);
    expect(requests[1]!.tools).toBeUndefined();
    expect(requests[1]!.messages.slice(2)).toEqual([
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'follow_player', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_0', content: expect.stringContaining('the player, who decides') },
    ]);
  });

  it('streams without tools when nothing may be offered, and a port without stream replies whole', async () => {
    const { port, requests } = streamingPort([{ content: 'No.' }]);
    expect(spoken(await events(new Converse(port).replyStream(input)))).toBe('No.');
    expect(requests[0]!.tools).toBeUndefined();
    expect(requests[0]!.messages[1]!.content).not.toContain('A call only proposes');

    expect(await events(new Converse({ complete: async () => 'Hm.' }).replyStream({ ...input, offers: { follow: true } }))).toEqual([
      { type: 'delta', text: 'Hm.' },
      { type: 'done', reply: 'Hm.', offers: [] },
    ]);
  });
});
