import { promptLoader } from '../prompts.js';
import type { LLMPort } from '../ports/llm.js';
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

/** Turns one player line into the NPC's spoken reply, from its context layers alone. */
export class Converse {
  constructor(private readonly llm: LLMPort) {}

  async reply(input: ConverseInput): Promise<string> {
    const system = input.context.segments.map((segment) => segment.text).join('\n\n');
    const prompt = prompts('reply.md', { name: input.name, line: input.line });
    return (await this.llm.complete({ system, prompt })).trim();
  }
}
