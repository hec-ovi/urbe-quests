/**
 * Sample tooling only: both ports over one OpenAI-compatible chat-completions
 * endpoint (a local llama.cpp server by default). The box never owns this
 * client; a host wires its own. No output caps are sent.
 */

import { Agent, setGlobalDispatcher } from 'undici';
import type { AgentPort, AgentReply, AgentTool, AgentTurn, LLMPort } from '../../ports/llm.js';

export const BASE_URL = process.env['LLM_BASE_URL'] ?? 'http://localhost:8080/v1';

// A local model can think for many minutes on one build round; the default five-minute header timeout would end the run.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCallMessage[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ToolCallMessage {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

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
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ model: this.model, messages, ...(tools !== undefined ? { tools } : {}) }),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    const body = (await response.json()) as { choices: { message: { content?: string; tool_calls?: ToolCallMessage[] } }[] };
    return body.choices[0]!.message;
  }

  private static async firstModel(): Promise<string> {
    const response = await fetch(`${BASE_URL}/models`, { headers: authHeader() });
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

/** Tool calls map onto the agent transcript by position. */
function toMessages(transcript: AgentTurn[]): Message[] {
  const messages: Message[] = [];
  let assistantIndex = -1;
  for (const turn of transcript) {
    if ('text' in turn) {
      messages.push({ role: turn.role, content: turn.text });
    } else if (turn.role === 'assistant') {
      assistantIndex += 1;
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: turn.calls.map((c, j) => ({
          id: callId(assistantIndex, j),
          type: 'function',
          function: { name: c.tool, arguments: JSON.stringify(c.input ?? {}) },
        })),
      });
    } else {
      turn.results.forEach((r, j) => messages.push({ role: 'tool', tool_call_id: callId(assistantIndex, j), content: r.result }));
    }
  }
  return messages;
}

const callId = (turn: number, index: number) => `call_${turn}_${index}`;

function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { malformedArguments: text };
  }
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
