/**
 * Companion actions an NPC may take while it replies, offered to the model as
 * OpenAI tools. The model calls one when it agrees to what the player asked;
 * the host decides whether it happens.
 */

import { promptLoader } from '../prompts.js';
import type { ChatTool, ChatToolCall } from '../ports/chat.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

const FOLLOW = 'follow_player';
const LEAD = 'lead_player_to';

export interface OfferPlace {
  placeId: string;
  /** What the player knows the place as. */
  name: string;
}

/** What the host lets this NPC agree to right now. */
export interface OfferOptions {
  /** The NPC may agree to follow the player. */
  follow?: boolean;
  /** Places the NPC may agree to lead the player to. */
  places?: OfferPlace[];
}

export type CompanionOffer = { kind: 'follow' } | { kind: 'lead'; placeId: string; name: string };

/** The tools these options allow; empty when the NPC may agree to nothing. */
export function offerTools(options: OfferOptions = {}): ChatTool[] {
  const tools: ChatTool[] = [];
  if (options.follow) {
    tools.push(tool(FOLLOW, prompt('offers.md#follow_player'), { type: 'object', properties: {}, additionalProperties: false }));
  }
  const places = options.places ?? [];
  if (places.length > 0) {
    const listing = places.map((place) => `- ${place.placeId}: ${place.name}`).join('\n');
    tools.push(tool(LEAD, prompt('offers.md#lead_player_to', { places: listing }), {
      type: 'object',
      properties: {
        placeId: { type: 'string', enum: places.map((place) => place.placeId), description: prompt('offers.md#place-id') },
      },
      required: ['placeId'],
      additionalProperties: false,
    }));
  }
  return tools;
}

/** The offer a tool call makes, or undefined when the options allow no such tool or place. */
export function offerOf(call: ChatToolCall, options: OfferOptions = {}): CompanionOffer | undefined {
  if (call.function.name === FOLLOW) return options.follow ? { kind: 'follow' } : undefined;
  if (call.function.name !== LEAD) return undefined;
  const placeId = placeIdOf(call.function.arguments);
  const place = options.places?.find((candidate) => candidate.placeId === placeId);
  return place && { kind: 'lead', placeId: place.placeId, name: place.name };
}

function tool(name: string, description: string, parameters: Record<string, unknown>): ChatTool {
  return { type: 'function', function: { name, description, parameters } };
}

function placeIdOf(json: string): unknown {
  try {
    return (JSON.parse(json) as { placeId?: unknown } | null)?.placeId;
  } catch {
    return undefined;
  }
}
