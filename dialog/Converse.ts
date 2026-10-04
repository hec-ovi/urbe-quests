import { QuestError } from '../errors.js';
import { CUE_LIST, stripCues } from '../flow/cues.js';
import { promptLoader } from '../prompts.js';
import { ChatToolCalls, type ChatMessage, type ChatRequest, type ChatToolCall } from '../ports/chat.js';
import type { LLMPort, StreamingLLMPort } from '../ports/llm.js';
import { inferOffers, pendingOf, pendingPrompt } from './agreement.js';
import { offerKey, offerListing, offerOf, offerTools, type CompanionOffer, type OfferOptions } from './offers.js';
import { cleanReply, ReplyCleaner } from './ReplyCleaner.js';
import type { DialogContext, DialogLine, SegmentId } from './schema.js';

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
  /** Companion actions the NPC may agree to through tool calls; none when absent. */
  offers?: OfferOptions;
  /** Aborting ends the model request, and the stream rejects. */
  signal?: AbortSignal;
  /**
   * The conversation so far, oldest first, up to the line: what the person
   * offered or was asked a moment ago is read from its last exchange, so an
   * acceptance goes where it was offered and an agreement in words alone
   * still does what it says.
   */
  turns?: DialogLine[];
}

/** What a streamed reply yields: text as it is spoken, with its cues, then each offer the NPC made, then the whole reply. */
export type ReplyEvent =
  | { type: 'delta'; text: string }
  | ({ type: 'offer' } & CompanionOffer)
  | { type: 'done'; reply: string; offers: CompanionOffer[] };

/** Turns one player line into the NPC's spoken reply, from its context layers alone. */
export class Converse {
  constructor(private readonly llm: LLMPort | StreamingLLMPort) {}

  async reply(input: ConverseInput): Promise<string> {
    const { system, prompt, names } = request(input, false);
    return spoken(cleanReply(await this.llm.complete({ system, prompt }), names));
  }

  /**
   * Streams the reply through the port's `stream`, cleaned as it arrives. Tool
   * calls in the same request become offers, yielded once the spoken reply is
   * complete; when the model only called tools, each call is answered and the
   * spoken reply is asked for once more. A port without `stream` yields the
   * whole `reply` as one delta and offers nothing.
   */
  async *replyStream(input: ConverseStreamInput): AsyncGenerator<ReplyEvent> {
    const llm = this.llm;
    if (!('stream' in llm)) {
      const reply = await this.reply(input);
      yield { type: 'delta', text: reply };
      yield { type: 'done', reply, offers: [] };
      return;
    }
    const tools = offerTools(input.offers);
    const { system, prompt, names } = request(input, tools.length > 0);
    // What the person may do now and what the last exchange left on the table, said last, where it changes.
    const pending = tools.length > 0 ? pendingPrompt(pendingOf(input.turns, input.offers)) : undefined;
    const asked = tools.length > 0
      ? [prompt, offerListing(input.offers), ...(pending ? [prompts(`offers.md#${pending.key}`, pending.values)] : [])].join('\n\n')
      : prompt;
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: asked },
    ];
    const calls = new ChatToolCalls();
    let reply = '';
    for await (const text of said(llm, { messages, ...(tools.length > 0 ? { tools } : {}) }, names, calls, input.signal)) {
      reply += text;
      yield { type: 'delta', text };
    }

    const made = calls.list();
    if (stripCues(reply).length === 0 && made.length > 0) {
      const answered: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: reply, tool_calls: made.map(wellFormed) },
        ...made.map((call) => answer(call, input.offers)),
      ];
      // A cue the first answer made stays in front of the words, a space apart.
      let gap = reply.length > 0 ? ' ' : '';
      // The same tools again, so the cached start of the first request serves this one; calls it makes are not taken.
      for await (const text of said(llm, { messages: answered, tools }, names, new ChatToolCalls(), input.signal)) {
        reply += gap + text;
        yield { type: 'delta', text: gap + text };
        gap = '';
      }
    }
    spoken(reply);

    const called = new Map<string, CompanionOffer>();
    for (const call of made) {
      const offer = offerOf(call, input.offers);
      if (offer) called.set(offerKey(offer), offer);
    }
    // Words and actions agree: what the reply agrees to in words alone happens too (see agreement.ts).
    const offers = new Map<string, CompanionOffer>();
    const inferred = tools.length > 0
      ? inferOffers({ line: input.line, reply: stripCues(reply), turns: input.turns ?? [], options: input.offers ?? {}, made: [...called.values()] })
      : [...called.values()];
    for (const offer of inferred) offers.set(offerKey(offer), offer);
    for (const offer of offers.values()) yield { type: 'offer', ...offer };
    yield { type: 'done', reply, offers: [...offers.values()] };
  }
}

/** The layers that change from one turn to the next, from the talk so far on; everything before them stays the same. */
const CHANGING = new Set<SegmentId>(['conversation', 'overheard', 'place', 'events', 'people', 'turns']);

/**
 * The system text and the turn's message. How to answer, and with `offers`
 * how to agree to what is asked, go between the layers that stay the same
 * from turn to turn and the ones that change, so a prompt cache keeps
 * everything up to the talk so far; the turn's message is the line alone.
 */
function request(input: ConverseInput, offers: boolean): { system: string; prompt: string; names: string[] } {
  const character = input.context.characterName;
  const name = character ? `${character.given} ${character.family}` : input.name;
  const segments = input.context.segments;
  const split = segments.findIndex((segment) => CHANGING.has(segment.id));
  const at = split < 0 ? segments.length : split;
  const rules = [prompts('reply.md#rules', { name, cues: CUE_LIST }).trim(), ...(offers ? [prompts('offers.md#instructions').trim()] : [])];
  const system = [...segments.slice(0, at).map((segment) => segment.text), ...rules, ...segments.slice(at).map((segment) => segment.text)].join('\n\n');
  const prompt = prompts('reply.md#line', { line: input.line }).trim();
  return { system, prompt, names: [name, name.split(' ')[0]!] };
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
    // The model has moved past the NPC's turn: stop reading, which closes the request.
    if (cleaner.done) break;
  }
  const rest = cleaner.end();
  if (rest.length > 0) yield rest;
}

/** The call as it goes back to the server, which rejects arguments that are not JSON. */
function wellFormed(call: ChatToolCall): ChatToolCall {
  try {
    JSON.parse(call.function.arguments);
    return call;
  } catch {
    return { ...call, function: { ...call.function, arguments: '{}' } };
  }
}

function answer(call: ChatToolCall, options: OfferOptions | undefined): ChatMessage {
  const result = offerOf(call, options) ? 'offers.md#proposed' : 'offers.md#refused';
  return { role: 'tool', tool_call_id: call.id, content: prompts(result) };
}

/** The reply, when it has words to say besides its cues. */
function spoken(reply: string): string {
  if (stripCues(reply).length === 0) throw new QuestError('E_LLM', 'the model gave no spoken reply');
  return reply;
}
