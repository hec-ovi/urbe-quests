/** Sample text and agent ports over streaming Chat Completions. */

import { Agent, fetch } from 'undici';
import { toMessages, type Message, type ToolCallMessage } from './ChatMessages.js';
import { readChatStream } from './ChatStream.js';
import type { AgentPort, AgentReply, AgentTool, AgentTurn, LLMPort } from '../../ports/llm.js';

export const BASE_URL = process.env['LLM_BASE_URL'] ?? 'http://localhost:8080/v1';

// A local model can think for many minutes on one build round; the default five-minute header timeout would end the run.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export class OpenAICompatibleClient implements LLMPort, AgentPort {
  constructor(readonly model: string) {}

  static async connect(): Promise<OpenAICompatibleClient> {
    const model = process.env['LLM_MODEL'] ?? (await OpenAICompatibleClient.firstModel());
    return new OpenAICompatibleClient(model);
  }

  async complete(request: { system: string; prompt: string }): Promise<string> {
    const message = await this.chat([
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ]);
    return stripThinking(message.content ?? '');
  }

  async step(request: { system: string; prompt: string; tools: AgentTool[]; transcript: AgentTurn[] }): Promise<AgentReply> {
    const messages: Message[] = [
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
    if (calls.length === 0) return { kind: 'done', text: stripThinking(message.content ?? '') };
    return { kind: 'calls', calls: calls.map((c) => ({ tool: c.function.name, input: parseArguments(c.function.arguments) })) };
  }

  private async chat(messages: Message[], tools?: unknown[]): Promise<{ content?: string; tool_calls?: ToolCallMessage[] }> {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      dispatcher,
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ model: this.model, messages, stream: true, ...(tools !== undefined ? { tools } : {}) }),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    return readChatStream(response.body);
  }

  private static async firstModel(): Promise<string> {
    const response = await fetch(`${BASE_URL}/models`, { headers: authHeader(), dispatcher });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    const body = (await response.json()) as { data: { id: string }[] };
    const id = body.data[0]?.id;
    if (id === undefined) throw new Error(`no model listed at ${BASE_URL}`);
    return id;
  }
}

/** A hosted OpenAI-compatible server wants its key; a local one ignores the header. */
function authHeader(): Record<string, string> {
  const key = process.env['LLM_API_KEY'];
  return key !== undefined ? { Authorization: `Bearer ${key}` } : {};
}

function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { malformedArguments: text };
  }
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
