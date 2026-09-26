/**
 * Contract-surface tests for Converse, the reply cleaner and inline cues, over
 * fake model ports: cleaned text replies, streamed deltas, offers from tool
 * calls in the same request, the spoken follow-up after a tool-only answer,
 * and failures.
 */

import { describe, expect, it } from 'vitest';
import type { ChatDelta, ChatRequest } from '../../ports/chat.js';
import { CUES, stripCues, TAG } from '../../flow/cues.js';
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
    ['"Hi," he said. "Come."', '"Hi," he said. "Come."'],
    ['"Stay back." I won\'t say it twice.', '"Stay back." I won\'t say it twice.'],
    ['"Stay back," I said.', '"Stay back," I said.'],
    ['"Unclosed, and gone.', 'Unclosed, and gone.'],
    ['<|im_start|>assistant\nFine.', 'Fine.'],
    ['Fine.<|im_end|><|im_start|>user\nHi', 'Fine.'],
    [`A <|${'x'.repeat(40)}|> stays.`, `A <|${'x'.repeat(40)}|> stays.`],
    ['[sigh] Fine. [Laughs] Go on.', '[sigh] Fine. [laugh] Go on.'],
    ['Mara: [whispering] Not here.', '[whisper] Not here.'],
    ['[leans in] Listen [smiles]. Now.\n[nods]\nGo.', 'Listen. Now.\nGo.'],
    ['Pier [7], then [the long way round the flooded docks].', 'Pier [7], then [the long way round the flooded docks].'],
    ['[sigh] "Get out." [cry]', '[sigh] Get out. [cry]'],
    ['"Hi." [sigh] Come in.', '"Hi." [sigh] Come in.'],
    ['Wait [sig', 'Wait [sig'],
    ['Fine. [sighs deeply] Go. [laughs softly]', 'Fine. [sigh] Go. [laugh]'],
    ['[chuckling] Sure. [a bitter laugh] [sob] No.', '[laugh] Sure. [laugh] [cry] No.'],
    ['[voice low, almost a whisper] Not here.', '[whisper] Not here.'],
    ['[[sigh]] Fine. [[leans in]] Go.', '[sigh] Fine. Go.'],
    ['[laugh [nods]ing] Fine. [a [b [nods]c]d] Go.', '[laugh] Fine. Go.'],
    ['[laugh\n[leans in]ing][Sighs]"\n].x.]', '[laugh][sigh]\n].x.]'],
  ];

  it('keeps only the words the NPC says', () => {
    for (const [raw, clean] of cases) expect(cleanReply(raw, NAMES)).toBe(clean);
  });

  it('is done once the model has moved past the NPC turn', () => {
    for (const [raw, done] of [['Fine.\nPlayer: And', true], ['Fine.<|im_end|>', true], ['Fine.\nMara: More', false]] as const) {
      const cleaner = new ReplyCleaner(NAMES);
      cleaner.push(raw);
      expect(cleaner.done).toBe(done);
    }
  });

  it('never splits a cue across the pieces it streams', () => {
    const raw = 'No. [sigh] Maybe [whisper] later. [laugh]';
    const cleaner = new ReplyCleaner(NAMES);
    const pieces = [...raw].map((char) => cleaner.push(char)).concat(cleaner.end());
    expect(pieces.join('')).toBe(raw);
    expect(pieces.filter((piece) => /\[[a-z]*$|^[a-z]*\]/.test(piece))).toEqual([]);
  });

  it('leaves only listed cues and streams to the whole-text result on bracket fragments', () => {
    const fragments = ['[', ']', '[[', ']]', 'sigh', 'Laughs', 'ing', 'leans in', 'a', ' ', '\n', '"', 'x', '.', ','];
    let seed = 7;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let run = 0; run < 400; run++) {
      const raw = Array.from({ length: 4 + next(14) }, () => fragments[next(fragments.length)]).join('');
      const clean = cleanReply(raw);
      expect(clean.match(new RegExp(TAG, 'g'))?.filter((tag) => !CUES.some((cue) => tag === `[${cue}]`)) ?? [], raw).toEqual([]);
      for (let at = 0; at <= raw.length; at++) {
        const cleaner = new ReplyCleaner();
        expect(cleaner.push(raw.slice(0, at)) + cleaner.push(raw.slice(at)) + cleaner.end(), raw).toBe(clean);
      }
    }
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

describe('stripCues', () => {
  it('shows a line without its cues and leaves every other bracket alone', () => {
    expect(CUES).toEqual(['laugh', 'sigh', 'whisper', 'angry', 'gasp', 'cry']);
    expect(stripCues('[sigh] Fine. [laugh] Go on. [cry]')).toBe('Fine. Go on.');
    expect(stripCues('Fine [whisper].\n[Angry] Out! [gasp] "[cry] Why," she said.')).toBe('Fine.\nOut! "Why," she said.');
    expect(stripCues('Pier [7] [leans in].')).toBe('Pier [7] [leans in].');
  });

  it('never glues two words and opens a quote cleanly', () => {
    expect(stripCues('Look. [sigh]Fine. Word[sigh]word, [laugh] [cry]end.')).toBe('Look. Fine. Word word, end.');
    expect(stripCues("'[sigh] Fine,' she said. ‘[whisper] Go.’")).toBe("'Fine,' she said. ‘Go.’");
    expect(stripCues('"Go."[sigh] Now. The boys\'[sigh] house.\n  [gasp] There.')).toBe('"Go." Now. The boys\' house.\n  There.');
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
    expect(seen[0]?.prompt).toContain('[laugh] [sigh] [whisper] [angry] [gasp] [cry]');
  });

  it('rejects a reply with nothing left to say', async () => {
    await expect(new Converse({ complete: async () => '<think>…</think>  ' }).reply(input))
      .rejects.toMatchObject({ code: 'E_LLM' });
    await expect(new Converse({ complete: async () => ' [sigh] ' }).reply(input)).rejects.toMatchObject({ code: 'E_LLM' });
    const { port } = streamingPort([{ content: '<think>…</think>' }]);
    await expect(events(new Converse(port).replyStream(input))).rejects.toMatchObject({ code: 'E_LLM' });
  });

  it('streams a reply with its cues whole, however the model splits them', async () => {
    const { port } = streamingPort([{ content: 'Not tonight, friend. [si' }, { content: 'ghs] Go' }, { content: ' on.' }]);
    const seen = await events(new Converse(port).replyStream(input));
    expect(seen).toEqual([
      { type: 'delta', text: 'Not tonight, friend.' },
      { type: 'delta', text: ' [sigh] Go' },
      { type: 'delta', text: ' on.' },
      { type: 'done', reply: 'Not tonight, friend. [sigh] Go on.', offers: [] },
    ]);
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
    expect(sent!.messages[1]!.content).toContain('Their asking is their consent, so your call starts it at once');
    expect(sent!.messages[1]!.content).toContain('decline in character, in words only, and call nothing');
    expect(sent!.tools?.map((tool) => tool.function.name)).toEqual(['lead_player_to']);
    const lead = sent!.tools![0]!.function;
    expect(lead.description).toContain('- p5: Noodle Saint\n- p8: Precinct 9');
    expect(lead.parameters).toMatchObject({ required: ['placeId'], properties: { placeId: { enum: ['p5', 'p8'] } } });
  });

  it('answers a tool-only reply, echoing well-formed arguments, and streams the spoken words from a second request without tools', async () => {
    const { port, requests } = streamingPort(
      [{ tool_calls: [
        { index: 0, function: { name: 'follow_player', arguments: '{}' } },
        { index: 1, id: 'c2', function: { name: 'lead_player_to', arguments: '{"place' } },
      ] }],
      [{ content: 'Fine. Lead on.' }],
    );

    const seen = await events(new Converse(port).replyStream({ ...input, offers: { follow: true, places: [{ placeId: 'p5', name: 'Noodle Saint' }] } }));

    expect(seen).toEqual([
      { type: 'delta', text: 'Fine. Lead on.' },
      { type: 'offer', kind: 'follow' },
      { type: 'done', reply: 'Fine. Lead on.', offers: [{ kind: 'follow' }] },
    ]);
    expect(requests[0]!.tools?.map((tool) => tool.function.name)).toEqual(['follow_player', 'lead_player_to']);
    expect(requests[1]!.tools).toBeUndefined();
    expect(requests[1]!.messages.slice(2)).toEqual([
      { role: 'assistant', content: '', tool_calls: [
        { id: 'call_0', type: 'function', function: { name: 'follow_player', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'lead_player_to', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'call_0', content: expect.stringContaining('You go with the player from here.') },
      { role: 'tool', tool_call_id: 'c2', content: expect.stringContaining('not something you can do') },
    ]);
  });

  it('keeps a cue the tool call came with in front of the spoken follow-up', async () => {
    const { port, requests } = streamingPort(
      [{ content: '[sigh]' }, { tool_calls: [{ index: 0, id: 'c1', function: { name: 'follow_player', arguments: '{}' } }] }],
      [{ content: 'Fine.' }],
    );
    const seen = await events(new Converse(port).replyStream({ ...input, offers: { follow: true } }));
    expect(seen.filter((event) => event.type === 'delta')).toEqual([{ type: 'delta', text: '[sigh]' }, { type: 'delta', text: ' Fine.' }]);
    expect(seen.at(-1)).toEqual({ type: 'done', reply: '[sigh] Fine.', offers: [{ kind: 'follow' }] });
    expect(requests[1]!.messages[2]).toMatchObject({ role: 'assistant', content: '[sigh]' });
  });

  it('offers nothing for a turn whose spoken reply never came', async () => {
    const { port } = streamingPort([{ tool_calls: [{ index: 0, function: { name: 'follow_player', arguments: '{}' } }] }], []);
    const seen: ReplyEvent[] = [];
    const stream = new Converse(port).replyStream({ ...input, offers: { follow: true } });
    await expect((async () => { for await (const event of stream) seen.push(event); })()).rejects.toMatchObject({ code: 'E_LLM' });
    expect(seen).toEqual([]);
  });

  it('stops reading the model once it writes past the NPC turn', async () => {
    let pulled = 0;
    let closed = false;
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream() {
        try {
          for (const content of ['Fine.', '\nPlayer: And then?', '\nMara: More.', '\nPlayer: Go on.']) {
            pulled++;
            yield { content };
          }
        } finally {
          closed = true;
        }
      },
    };
    expect(spoken(await events(new Converse(port).replyStream(input)))).toBe('Fine.');
    expect(pulled).toBe(2);
    expect(closed).toBe(true);
  });

  it('streams without tools when nothing may be offered, and a port without stream replies whole', async () => {
    const { port, requests } = streamingPort([{ content: 'No.' }]);
    expect(spoken(await events(new Converse(port).replyStream(input)))).toBe('No.');
    expect(requests[0]!.tools).toBeUndefined();
    expect(requests[0]!.messages[1]!.content).not.toContain('Their asking is their consent');

    expect(await events(new Converse({ complete: async () => 'Hm.' }).replyStream({ ...input, offers: { follow: true } }))).toEqual([
      { type: 'delta', text: 'Hm.' },
      { type: 'done', reply: 'Hm.', offers: [] },
    ]);
  });
});
