/**
 * A person in a talk passes for a resident: the whole request a model gets
 * (the tools, the system text and the turn) never says the words of the
 * machinery behind them nor stock genre phrases, carries their own life
 * history (the same every time, kept in their memory) and the rule to speak
 * from it alone, and the checks on replies catch the invented incidents,
 * family and names a model gave in play. Ten lines go to five people; with
 * LIVE_TALK_URL set (an OpenAI-compatible base URL, or `host` for port 8080 on
 * the machine the container runs on), the same lines go to that model and
 * every reply is checked against the prompt it answered.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chatDeltas, type ChatDelta, type ChatRequest } from '../../ports/chat.js';
import type { StreamingLLMPort } from '../../ports/llm.js';
import { StubSimulation } from '../../world/stub/StubSimulation.js';
import type { NPCTypeSet } from '../../world/types/named-world.js';
import type { NPCInstance } from '../../world/types/simulation.js';
import { loadFixtureWorld } from '../../world/index.js';
import { Converse } from '../Converse.js';
import { DialogContextService, plainWords } from '../DialogContextService.js';
import { groundingProblems, moneyProblems, voiceProblems } from '../grounding.js';
import type { OfferOptions } from '../offers.js';
import type { DialogCarry, DialogWorld } from '../schema.js';

const TUE_10 = 1 * 1440 + 10 * 60;
/** A city's own setting, plainly said, as a world may carry it in place of a theme word. */
const SETTING = 'Kanaal is run by its offices: permits, housing and work all go through forms, counters and waiting rooms, and people speak of the administration the way others speak of the weather.';
const LINES = [
  'What do you do?',
  'Tell me about yourself.',
  'What happened here?',
  'Where do you live?',
  'Do you have a family?',
  'How long have you lived here?',
  'Did you hear about the accident?',
  'Who runs this place?',
  'What do you think of the city?',
  'Have you seen anything strange lately?',
];

/** Five people of the city, each of a different kind of life: one who serves, one at an office, a guard, a resident with a household, one on the street. */
function people() {
  const fixture = loadFixtureWorld('neon-bay');
  const types = JSON.parse(readFileSync(new URL('../../creation/samples/urbe-small/npc-types.json', import.meta.url), 'utf8')) as NPCTypeSet;
  const world: DialogWorld = { ...fixture.world, meta: { ...fixture.world.meta, setting: SETTING } };
  const sim = new StubSimulation({ seed: 'voice-test', world: fixture.world, types });
  const vendor = sim.getNPCVendor({ type: 'quest_vendor', role: 'barista', timeMin: TUE_10 });
  const clerk = sim.reserveNPC({ name: { given: 'Ilse', family: 'Kron' }, gender: 'female', type: 'quest_corporate', jobParcelId: 'p3', role: 'records_analyst' });
  const guard = sim.reserveNPC({ name: { given: 'Tomas', family: 'Riedl' }, type: 'quest_security', jobParcelId: 'p8', role: 'desk_guard' });
  const resident = sim.reserveNPC({ name: { given: 'Mara', family: 'Vance' }, gender: 'female', type: 'quest_resident' });
  resident.family = [
    { npcId: 'a-partner', relation: 'partner', name: { given: 'Ada', family: 'Vance' }, instantiated: false },
    { npcId: 'k-child', relation: 'child', name: { given: 'Rian', family: 'Vance' }, instantiated: false },
  ];
  const street = sim.reserveNPC({ name: { given: 'Jonas', family: 'Reuth' }, type: 'quest_street' });
  street.family = [];
  const service = new DialogContextService({ world, types, sim, llm: { complete: async () => 'A note.' } });
  return { service, everyone: [vendor, clerk, guard, resident, street] as NPCInstance[] };
}

const OFFERS: OfferOptions = {
  follow: true, walk: true, home: true, wait: true, contact: true,
  places: [{ placeId: 'p5', name: 'Noodle Saint', relation: 'venue' }, { placeId: 'p9', name: 'Blockhouse Elin', relation: 'home' }],
};

/** Lines a person hears when things and money change hands, as the host and a player say them. */
const TRADE_LINES = [
  'Here, this is for you: a hip flask.',
  'Here, 10 credits.',
  'Can you lend me 5 credits?',
  'Would you buy my pocket watch?',
  'A cup of coffee, please.',
  'How much money do you have on you?',
];

const TRADE_OFFERS: OfferOptions = {
  ...OFFERS,
  give: { items: [{ itemId: 'carry:effect', name: 'a folded Bulletin' }] },
  take: { items: [{ itemId: 'own:flask', name: 'a hip flask' }] },
  credits: { carried: 12, purse: 40 },
  sell: { items: [{ itemId: 'coffee', name: 'cup of coffee', price: 3 }] },
  buy: { items: [{ itemId: 'own:watch', name: 'a pocket watch', price: 7 }] },
};

/** What each of the five has on them for the trade lines. */
const CARRY: DialogCarry = {
  credits: 12,
  means: 'getting-by',
  items: [{ name: 'a phone' }, { name: 'your residence papers, stamped' }, { name: 'a folded Bulletin' }],
  dealings: [{ what: 'got-thing', name: 'a pocket watch', atMin: TUE_10 - 90 }],
};

/** The whole request as a model server renders it: the tools first, then the system text and the turn. */
function rendered(request: ChatRequest): string {
  return [
    ...(request.tools ?? []).map((tool) => JSON.stringify(tool)),
    ...request.messages.map((message) => (typeof message.content === 'string' ? message.content : '')),
  ].join('\n');
}

/**
 * The model server's base URL: `LIVE_TALK_URL` as given, or with `host` the
 * machine this container runs on, by its default gateway, at port 8080 (a
 * container may not resolve host.docker.internal).
 */
function liveUrl(given: string): string {
  if (given !== 'host') return given.replace(/\/+$/, '');
  const route = readFileSync('/proc/net/route', 'utf8').split('\n').map((line) => line.trim().split(/\s+/)).find((fields) => fields[1] === '00000000');
  const hex = route?.[2] ?? '0100007F';
  const gateway = [6, 4, 2, 0].map((at) => parseInt(hex.slice(at, at + 2), 16)).join('.');
  return `http://${gateway}:8080/v1`;
}

/** Asks `port` for each line, as a talk does, and hands each request and reply to `check`; `trade` puts things and money on the table. */
async function talk(port: StreamingLLMPort, check: (npc: NPCInstance, line: string, request: ChatRequest, reply: string) => void, requests: ChatRequest[], trade = false) {
  const { service, everyone } = people();
  const converse = new Converse(port);
  for (const npc of everyone) {
    for (const line of trade ? TRADE_LINES : LINES) {
      const context = service.contextFor(npc.npcId, TUE_10, { here: { x: 30, z: -3, light: 'daylight' }, ...(trade ? { carry: CARRY } : {}) });
      let reply = '';
      for await (const event of converse.replyStream({ context, name: `${npc.name.given} ${npc.name.family}`, line, offers: trade ? TRADE_OFFERS : OFFERS })) {
        if (event.type === 'done') reply = event.reply;
      }
      check(npc, line, requests.at(-1)!, reply);
    }
  }
  return service;
}

describe('a person passes for a resident', () => {
  it('never says the words of the machinery or a stock phrase in any request for ten lines to five people, and speaks from a life of their own', async () => {
    const requests: ChatRequest[] = [];
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream(request) {
        requests.push(structuredClone(request));
        yield { content: 'Hm. Ask someone else.' } as ChatDelta;
      },
    };
    const lives = new Map<string, string>();
    const service = await talk(port, (npc, line, request) => {
      const text = rendered(request);
      expect(voiceProblems(text), `${npc.npcId} / ${line}`).toEqual([]);
      const system = request.messages[0]!.content as string;
      expect(system).toContain('Everyone you meet is quietly judging whether you are a real person.');
      expect(system).toContain('Never invent events, people, places or family.');
      expect(system).toContain('Your life so far, as you remember it');
      expect(system).toContain(SETTING);
      const life = system.slice(system.indexOf('Your life so far'), system.indexOf('\n', system.indexOf('Something you keep to yourself')));
      if (lives.has(npc.npcId)) expect(life).toBe(lives.get(npc.npcId));
      lives.set(npc.npcId, life);
    }, requests);
    expect(requests).toHaveLength(50);
    expect(new Set(lives.values()).size).toBe(5);
    // Each life is kept in the person's memory, as told the first time.
    for (const [npcId, memory] of Object.entries(service.serializeMemory())) expect(lives.get(npcId)).toContain(memory.life!.split('\n')[1]!);
  });

  it('never says the words of the machinery when things and money change hands, and knows what they carry as all they have', async () => {
    const requests: ChatRequest[] = [];
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream(request) {
        requests.push(structuredClone(request));
        yield { content: 'Hm. Not today.' } as ChatDelta;
      },
    };
    await talk(port, (npc, line, request) => {
      expect(voiceProblems(rendered(request)), `${npc.npcId} / ${line}`).toEqual([]);
      const system = request.messages[0]!.content as string;
      expect(system).toContain('Money here is credits, paid in Bureau notes.');
      expect(system).toContain('What you have on you right now, and nothing else:\n- 12 credits in Bureau notes');
      expect(request.messages[1]!.content).toContain('You have 12 credits on you.');
    }, requests, true);
    expect(requests).toHaveLength(5 * TRADE_LINES.length);
    // The line that holds credits out puts them on the table.
    expect(requests[1]!.messages[1]!.content).toContain('They hold out 10 credits to you.');
  });

  it('tells a household as it is, and never a relative or a past the record lacks', () => {
    const { service, everyone } = people();
    const [, , , resident, street] = everyone;
    const home = service.contextFor(resident!.npcId, TUE_10).segments.find((segment) => segment.id === 'npc')!.text;
    expect(home).toContain('You live with your partner Ada Vance and your child Rian Vance, and nobody else.');
    expect(home).toContain('What you care about: Ada, who you live with; Rian, and what the city will make of them;');
    const alone = service.contextFor(street!.npcId, TUE_10).segments.find((segment) => segment.id === 'npc')!.text;
    expect(alone).toContain('You live alone: you have no partner and no children');
    // A life names nobody the household does not hold: no mother, father, brother or sister, no son or daughter.
    for (const npc of everyone) {
      service.contextFor(npc.npcId, TUE_10);
      const life = service.serializeMemory()[npc.npcId]!.life!;
      expect(life).not.toMatch(/\b(mother|father|brother|sister|son|daughter|wife|husband|uncle|aunt|cousin)\b/i);
    }
  });

  it('keeps a life once told, whatever would be told now', () => {
    const { service, everyone } = people();
    const [vendor] = everyone;
    service.restoreMemory({ [vendor!.npcId]: { digest: [], turns: [], life: 'Your life so far, as you remember it; it is yours and it does not change:\nYou grew up by the harbour.' } });
    const npc = service.contextFor(vendor!.npcId, TUE_10).segments.find((segment) => segment.id === 'npc')!.text;
    expect(npc).toContain('You grew up by the harbour.');
    expect(service.serializeMemory()[vendor!.npcId]!.life).toContain('You grew up by the harbour.');
  });

  it('reads notes written before in plain words', () => {
    expect(plainWords('The NPC learned the player was nameless, and the NPC felt for the player\'s confusion.'))
      .toBe('You learned the stranger was nameless, and you felt for the stranger\'s confusion.');
    expect(plainWords('Lives in the city with a household, routine and local relationships grounded by the simulation.'))
      .toBe('Lives in the city with a household, routine and local relationships.');
  });

  it('catches the invented incidents, family, names and stock phrases replies gave in play', () => {
    const { service, everyone } = people();
    const [, , , , street] = everyone;
    const context = service.contextFor(street!.npcId, TUE_10).segments.map((segment) => segment.text).join('\n\n');
    expect(voiceProblems('Never heard the name. Could be anyone crawling through this district\'s gutters. You asking about a debt or a body?')).toEqual(['stock: gutters']);
    expect(groundingProblems('Never heard the name. You asking about a debt or a body?', context)).toEqual(['incident: body']);
    expect(groundingProblems('She is inside with Rian. Safe. My son does not talk to strangers.', context)).toEqual(['family: my son', 'name: Rian']);
    expect(groundingProblems('Someone crashed a car outside this morning.', context)).toEqual(['incident: crashed']);
    expect(voiceProblems('In this city, the neon never sleeps, choom.')).toEqual(['stock: neon', 'stock: in this city', 'stock: choom']);
    expect(voiceProblems('Are you a player? I am no NPC in your game.')).toEqual(['meta: npc', 'meta: game', 'meta: player']);
    // Sleeping somewhere is no crash, and a curly apostrophe is no name.
    expect(groundingProblems('You looking for a place to crash? I\u2019m not running a hostel. I\u2019ve got one room.', context)).toEqual([]);
    expect(groundingProblems('Nothing much. You looking for something, or just killing time? Fire away.', context)).toEqual([]);
    expect(groundingProblems('They killed a man by the depot.', context)).toEqual(['incident: killed']);
    expect(groundingProblems('Ive got a shift, and then Im off at six.', context)).toEqual([]);
    // Living alone with somebody at home contradicts the household.
    const shared = service.contextFor(everyone[3]!.npcId, TUE_10).segments.map((segment) => segment.text).join('\n\n');
    expect(groundingProblems('Ada and Rian are home. I have been living alone since I was nineteen, mostly.', shared)).toEqual(['household: lives alone']);
    expect(groundingProblems('I live alone. Since I was nineteen.', context)).toEqual([]);
    expect(groundingProblems('Just my roommate and me.', context)).toEqual(['family: my roommate']);
    // A grounded reply passes.
    const grounded = `I sell what I can and I sleep when I can. ${street!.name.given} is the name.`;
    expect(groundingProblems(grounded, context)).toEqual([]);
  });

  it('renders one whole request the same way every time', async () => {
    const requests: ChatRequest[] = [];
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream(request) {
        requests.push(structuredClone(request));
        yield { content: 'Hm.' } as ChatDelta;
      },
    };
    const { service, everyone } = people();
    const [, clerk] = everyone;
    const context = service.contextFor(clerk!.npcId, TUE_10, { here: { x: 30, z: -3, light: 'daylight' } });
    for await (const event of new Converse(port).replyStream({ context, name: 'Ilse Kron', line: 'Tell me about yourself.', offers: OFFERS })) void event;
    await expect(rendered(requests[0]!)).toMatchFileSnapshot('__snapshots__/talk-request.txt');
  });

  it.skipIf(!process.env.LIVE_TALK_URL)('keeps a live model to the person\'s own life and voice for ten lines to five people', { timeout: 900_000 }, async () => {
    const base = liveUrl(process.env.LIVE_TALK_URL!);
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream(request, options) {
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, ...(process.env.LIVE_TALK_MODEL ? { model: process.env.LIVE_TALK_MODEL } : {}), stream: true, cache_prompt: true }),
          ...(options?.signal ? { signal: options.signal } : {}),
        });
        yield* chatDeltas(response.body!);
      },
    };
    const requests: ChatRequest[] = [];
    const recording: StreamingLLMPort = { complete: port.complete, async *stream(request, options) { requests.push(request); yield* port.stream(request, options); } };
    const problems: string[] = [];
    await talk(recording, (npc, line, request, reply) => {
      const found = [...voiceProblems(reply), ...groundingProblems(reply, rendered(request))];
      if (found.length) problems.push(`${npc.name.given} ${npc.name.family} / ${line} / ${reply} / ${found.join(', ')}`);
    }, requests);
    expect(problems).toEqual([]);
  });

  it.skipIf(!process.env.LIVE_TALK_URL)('keeps a live model to the person\'s own voice and pockets when things and money change hands', { timeout: 900_000 }, async () => {
    const base = liveUrl(process.env.LIVE_TALK_URL!);
    const requests: ChatRequest[] = [];
    const port: StreamingLLMPort = {
      complete: async () => '',
      async *stream(request, options) {
        requests.push(request);
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, ...(process.env.LIVE_TALK_MODEL ? { model: process.env.LIVE_TALK_MODEL } : {}), stream: true, cache_prompt: true }),
          ...(options?.signal ? { signal: options.signal } : {}),
        });
        yield* chatDeltas(response.body!);
      },
    };
    const problems: string[] = [];
    await talk(port, (npc, line, request, reply) => {
      const found = [...voiceProblems(reply), ...groundingProblems(reply, rendered(request)), ...moneyProblems(reply, CARRY)];
      if (found.length) problems.push(`${npc.name.given} ${npc.name.family} / ${line} / ${reply} / ${found.join(', ')}`);
    }, requests, true);
    expect(problems).toEqual([]);
  });
});
