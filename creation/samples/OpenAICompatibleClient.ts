/** Sample text and agent ports over streaming Chat Completions. */

import { Agent, fetch, type Response } from 'undici';
import { toMessages } from './ChatMessages.js';
import { readChatStream } from './ChatStream.js';
import type { ChatMessage, ChatToolCall } from '../../ports/chat.js';
import { cleanMarkup } from '../../ports/markup.js';
import type { AgentPort, AgentReply, AgentTool, AgentTurn, LLMPort } from '../../ports/llm.js';

// Compose passes an unset LLM_* variable as an empty string; an empty one counts as unset.
export const BASE_URL = process.env['LLM_BASE_URL'] || 'http://localhost:8080/v1';

// A local model can think for many minutes on one build round; the default five-minute header timeout would end the run.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export class OpenAICompatibleClient implements LLMPort, AgentPort {
  constructor(readonly model: string) {}

  static async connect(): Promise<OpenAICompatibleClient> {
    const model = process.env['LLM_MODEL'] || (await OpenAICompatibleClient.firstModel());
    return new OpenAICompatibleClient(model);
  }

  async complete(request: { system: string; prompt: string }): Promise<string> {
    const message = await this.chat([
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ]);
    return cleanMarkup(message.content ?? '');
  }

  async step(request: { system: string; prompt: string; tools: AgentTool[]; transcript: AgentTurn[] }): Promise<AgentReply> {
    const messages: ChatMessage[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
      ...toMessages(request.transcript),
    ];
    const tools = request.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const message = await this.chat(messages, tools);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return { kind: 'done', text: cleanMarkup(message.content ?? '') };
    return { kind: 'calls', calls: calls.map((c) => ({ tool: c.function.name, input: parseArguments(c.function.arguments) })) };
  }

  private async chat(messages: ChatMessage[], tools?: unknown[]): Promise<{ content?: string; tool_calls?: ChatToolCall[] }> {
    const response = await send('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      // llama.cpp answers one tool call per turn unless parallel calls are asked for; the builder takes several.
      body: JSON.stringify({ model: this.model, messages, stream: true, ...(tools !== undefined ? { tools, parallel_tool_calls: true } : {}) }),
    });
    return readChatStream(response.body);
  }

  private static async firstModel(): Promise<string> {
    const response = await send('/models', { headers: authHeader() });
    const body = (await response.json()) as { data: { id: string }[] };
    const id = body.data[0]?.id;
    if (id === undefined) throw new Error(`no model listed at ${BASE_URL}`);
    return id;
  }
}

/** One request to the server; a failure names the address and why, never only undici's "fetch failed". */
async function send(path: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, dispatcher });
  } catch (error) {
    const { message, cause } = error as { message?: string; cause?: { message?: string } };
    throw new Error(`cannot reach ${url}: ${cause?.message ?? message}`, { cause: error });
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}: ${await response.text()}`);
  return response;
}

/** A hosted OpenAI-compatible server wants its key; a local one ignores the header. */
function authHeader(): Record<string, string> {
  const key = process.env['LLM_API_KEY'];
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { malformedArguments: text };
  }
}
