/**
 * Produces a committed sample: wires QuestlineCreation to an OpenAI-compatible
 * chat endpoint (a local llama.cpp server by default) and writes every stage's
 * output under creation/samples/<name>/. The box never owns this client; it is
 * sample tooling only.
 *
 *   npm run sample -- "create a dark cynical sci fi cyberpunk story" cyberpunk
 *
 * Env: LLM_BASE_URL (default http://localhost:8080/v1), LLM_MODEL (default:
 * the first model the server lists). No output caps are sent.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import type { AgentPort, AgentReply, AgentTool, AgentTurn, LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';

const BASE_URL = process.env['LLM_BASE_URL'] ?? 'http://localhost:8080/v1';

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCallMessage[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ToolCallMessage {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Both ports over one chat-completions endpoint; tool calls map onto the agent transcript by position. */
class OpenAICompatibleClient implements LLMPort, AgentPort {
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, ...(tools !== undefined ? { tools } : {}) }),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    const body = (await response.json()) as { choices: { message: { content?: string; tool_calls?: ToolCallMessage[] } }[] };
    return body.choices[0]!.message;
  }

  private static async firstModel(): Promise<string> {
    const response = await fetch(`${BASE_URL}/models`);
    const body = (await response.json()) as { data: { id: string }[] };
    const id = body.data[0]?.id;
    if (id === undefined) throw new Error(`no model listed at ${BASE_URL}`);
    return id;
  }
}

function toMessages(transcript: AgentTurn[]): Message[] {
  const messages: Message[] = [];
  let assistantIndex = -1;
  for (const turn of transcript) {
    if (turn.role === 'assistant') {
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

type Log = (line: string) => void;

/** Progress lines per stage call, so a long run shows where it is. */
function loggedText(stage: string, port: LLMPort, log: Log): LLMPort {
  return {
    complete: async (request) => {
      const started = Date.now();
      const text = await port.complete(request);
      log(`${stage}: ${text.length} chars in ${Math.round((Date.now() - started) / 1000)}s`);
      return text;
    },
  };
}

function loggedAgent(stage: string, port: AgentPort, log: Log): AgentPort {
  return {
    step: async (request) => {
      const started = Date.now();
      const reply = await port.step(request);
      const what = reply.kind === 'calls' ? reply.calls.map((c) => c.tool).join(', ') : 'done';
      log(`${stage} round ${request.transcript.length / 2 + 1}: ${what} in ${Math.round((Date.now() - started) / 1000)}s`);
      return reply;
    },
  };
}

async function main(): Promise<void> {
  const [prompt, name] = process.argv.slice(2);
  if (prompt === undefined || name === undefined) {
    throw new Error('usage: run-local.ts "<creation prompt>" <sample name>');
  }
  const client = await OpenAICompatibleClient.connect();
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: `sample-${name}`, world, types });
  const started = Date.now();
  const log: Log = (line) => console.error(`[${Math.round((Date.now() - started) / 1000)}s] ${line}`);

  log(`model ${client.model} at ${BASE_URL}`);
  const result = await new QuestlineCreation().run({
    prompt,
    world,
    types,
    sim,
    ports: {
      script: loggedText('script', client, log),
      situations: loggedText('situations', client, log),
      plan: loggedText('plan', client, log),
      build: loggedAgent('build', client, log),
    },
  });

  const dir = new URL(`./${name}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  const write = (file: string, text: string) => writeFileSync(new URL(file, dir), text);
  write('meta.json', JSON.stringify({ prompt, model: client.model, world: 'neon-bay', ranAt: new Date().toISOString() }, null, 2) + '\n');
  write('script.md', result.script.raw);
  write('situations.md', result.situations.raw);
  write('main.plan.md', result.main.plan);
  write('main.questline.json', JSON.stringify({ definition: result.main.definition, cast: result.main.cast }, null, 2) + '\n');
  for (const side of result.side) {
    write(`side-${side.situationId}.plan.md`, side.plan);
    write(`side-${side.situationId}.questline.json`, JSON.stringify({ definition: side.definition, cast: side.cast }, null, 2) + '\n');
  }
  log(`done: ${result.script.script.characters.length} characters, ${result.side.length} side quests, written to ${dir.pathname}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
