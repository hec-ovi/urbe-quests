/** The shared SSE reader: deltas in order, tool calls joined by index, usage from the last chunk. */

import { describe, expect, it } from 'vitest';
import { chatDeltas, ChatToolCalls, type ChatDelta, type ChatUsage } from '../chat.js';

async function* body(text: string): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += 5) yield bytes.slice(i, i + 5);
}

describe('chatDeltas', () => {
  it('yields choice deltas, joins tool calls and reports usage', async () => {
    const frames = [
      { choices: [{ index: 0, delta: { content: 'Keep ' } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'follow_player', arguments: '{' } }] } }] },
      { choices: [{ index: 0, delta: { content: 'up.', tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
      { choices: [], usage: { prompt_tokens: 494, completion_tokens: 12 } },
    ];
    const usage: ChatUsage[] = [];
    const deltas: ChatDelta[] = [];
    const calls = new ChatToolCalls();
    const text = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
    for await (const delta of chatDeltas(body(text), (u) => usage.push(u))) {
      deltas.push(delta);
      calls.add(delta.tool_calls);
    }

    expect(deltas.map((d) => d.content ?? '').join('')).toBe('Keep up.');
    expect(calls.list()).toEqual([{ id: 'call_0', type: 'function', function: { name: 'follow_player', arguments: '{}' } }]);
    expect(usage).toEqual([{ prompt_tokens: 494, completion_tokens: 12 }]);
  });
});
