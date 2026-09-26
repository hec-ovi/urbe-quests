import { QuestError } from '../errors.js';
import { promptLoader } from '../prompts.js';
import { ChatToolCalls, type ChatMessage, type ChatRequest, type ChatToolCall } from '../ports/chat.js';
import type { LLMPort, StreamingLLMPort } from '../ports/llm.js';
import { offerOf, offerTools, type CompanionOffer, type OfferOptions } from './offers.js';
import { cleanReply, ReplyCleaner } from './ReplyCleaner.js';
import type { DialogContext } from './schema.js';

const prompts = promptLoader(new URL('./prompts/', import.meta.url));

export interface ConverseInput {
  /** The NPC's context layers for this moment, from DialogContextService. */
  context: DialogContext;
  /** How the player knows this person. */
  name: string;
  /** What the player just said. */
  line: string;
}

export interface ConverseStreamInput extends ConverseInput {
  /** Companion actions the NPC may propose through tool calls; none when absent. */
  offers?: OfferOptions;
  /** Aborting ends the model request, and the stream rejects. */
  signal?: AbortSignal;
}

/** What a streamed reply yields: text as it is spoken, each offer the NPC makes, then the whole reply. */
export type ReplyEvent =
  | { type: 'delta'; text: string }
  | ({ type: 'offer' } & CompanionOffer)
  | { type: 'done'; reply: string; offers: CompanionOffer[] };

/** Turns one player line into the NPC's spoken reply, from its context layers alone. */
export class Converse {
  constructor(private readonly llm: LLMPort | StreamingLLMPort) {}

  async reply(input: ConverseInput): Promise<string> {
    const { system, prompt, names } = request(input);
    return spoken(cleanReply(await this.llm.complete({ system, prompt }), names));
  }

  /**
   * Streams the reply through the port's `stream`, cleaned as it arrives. Tool
   * calls in the same request become offers; when the model only called tools,
   * each call is answered and the spoken reply is asked for once more. A port
   * without `stream` yields the whole `reply` as one delta and offers nothing.
   */
  async *replyStream(input: ConverseStreamInput): AsyncGenerator<ReplyEvent> {
    const llm = this.llm;
    if (!('stream' in llm)) {
      const reply = await this.reply(input);
      yield { type: 'delta', text: reply };
      yield { type: 'done', reply, offers: [] };
      return;
    }
    const { system, prompt, names } = request(input);
    const tools = offerTools(input.offers);
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: tools.length > 0 ? `${prompt}\n\n${prompts('offers.md#instructions')}` : prompt },
    ];
    const calls = new ChatToolCalls();
    let reply = '';
    for await (const text of said(llm, { messages, ...(tools.length > 0 ? { tools } : {}) }, names, calls, input.signal)) {
      reply += text;
      yield { type: 'delta', text };
    }

    const made = calls.list();
    const offers = new Map<string, CompanionOffer>();
    for (const call of made) {
      const offer = offerOf(call, input.offers);
      if (offer) offers.set(offer.kind === 'lead' ? `lead:${offer.placeId}` : offer.kind, offer);
    }
    for (const offer of offers.values()) yield { type: 'offer', ...offer };

    if (reply.length === 0 && made.length > 0) {
      const answered: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: '', tool_calls: made },
        ...made.map((call) => answer(call, input.offers)),
      ];
      for await (const text of said(llm, { messages: answered }, names, new ChatToolCalls(), input.signal)) {
        reply += text;
        yield { type: 'delta', text };
      }
    }
    yield { type: 'done', reply: spoken(reply), offers: [...offers.values()] };
  }
}

function request(input: ConverseInput): { system: string; prompt: string; names: string[] } {
  const system = input.context.segments.map((segment) => segment.text).join('\n\n');
  const character = input.context.characterName;
  const name = character ? `${character.given} ${character.family}` : input.name;
  return { system, prompt: prompts('reply.md', { name, line: input.line }).trim(), names: [name, name.split(' ')[0]!] };
}

/** The cleaned text of one streamed request, piece by piece; its tool calls land in `calls`. */
async function* said(
  llm: StreamingLLMPort,
  chat: ChatRequest,
  names: string[],
  calls: ChatToolCalls,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  const cleaner = new ReplyCleaner(names);
  for await (const delta of llm.stream(chat, signal ? { signal } : {})) {
    calls.add(delta.tool_calls);
    const text = cleaner.push(delta.content ?? '');
    if (text.length > 0) yield text;
  }
  const rest = cleaner.end();
  if (rest.length > 0) yield rest;
}

function answer(call: ChatToolCall, options: OfferOptions | undefined): ChatMessage {
  const result = offerOf(call, options) ? 'offers.md#proposed' : 'offers.md#refused';
  return { role: 'tool', tool_call_id: call.id, content: prompts(result) };
}

function spoken(reply: string): string {
  if (reply.length === 0) throw new QuestError('E_LLM', 'the model gave no spoken reply');
  return reply;
}
