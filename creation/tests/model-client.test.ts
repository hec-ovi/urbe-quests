import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch, Response } from 'undici';
import { OpenAICompatibleClient } from '../samples/OpenAICompatibleClient.js';

vi.mock('undici', async (original) => ({ ...await original<typeof import('undici')>(), fetch: vi.fn() }));
afterEach(() => vi.mocked(fetch).mockReset());

function stream(events: unknown[], done = true): Response {
  const text = ': heartbeat\r\n\r\n' + events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
    + (done ? 'data: [DONE]\r\n\r\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
const event = (delta: object) => ({ choices: [{ index: 0, delta }] });

describe('sample model client through its text and agent ports', () => {
  it('collects streamed text without output limits or losing split UTF-8', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(stream([event({ content: 'María ' }), event({ content: 'keeps the receipt.' })]));
    const result = await new OpenAICompatibleClient('fixture').complete({ system: 'context', prompt: 'story' });
    expect(result).toBe('María keeps the receipt.');
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body));
    expect(request).toEqual({ model: 'fixture', stream: true, messages: [
      { role: 'system', content: 'context' }, { role: 'user', content: 'story' },
    ] });
  });

  it('assembles indexed tool deltas and returns their replies in the next transcript', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(stream([
      event({ tool_calls: [{ index: 1, id: 'b', function: { name: 'finish_questline', arguments: '{}' } }] }),
      event({ tool_calls: [{ index: 0, id: 'a', function: { name: 'add_role', arguments: '{"roleId":' } }] }),
      event({ tool_calls: [{ index: 0, function: { arguments: '"barista"}' } }] }),
    ])).mockResolvedValueOnce(stream([event({ content: 'Complete.' })]));
    const client = new OpenAICompatibleClient('fixture');
    const request = { system: 'context', prompt: 'build', tools: [], transcript: [] };
    const result = await client.step(request);
    expect(result).toEqual({ kind: 'calls', calls: [
      { tool: 'add_role', input: { roleId: 'barista' } }, { tool: 'finish_questline', input: {} },
    ] });
    if (result.kind !== 'calls') throw new Error('expected tool calls');
    await expect(client.step({ ...request, transcript: [
      { role: 'assistant', calls: result.calls },
      { role: 'tool', results: result.calls.map(call => ({ tool: call.tool, result: 'accepted' })) },
    ] })).resolves.toEqual({ kind: 'done', text: 'Complete.' });
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body));
    expect(sent.messages.slice(-2)).toEqual([
      { role: 'tool', tool_call_id: 'call_0_0', content: 'accepted' },
      { role: 'tool', tool_call_id: 'call_0_1', content: 'accepted' },
    ]);
  });

  it('rejects HTTP failures, provider stream errors and interrupted replies', async () => {
    const client = new OpenAICompatibleClient('fixture');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(stream([{ error: { message: 'provider failed' } }]))
      .mockResolvedValueOnce(stream([event({ content: 'partial' })], false));
    await expect(client.complete({ system: '', prompt: '' })).rejects.toThrow('503');
    await expect(client.complete({ system: '', prompt: '' })).rejects.toThrow('provider failed');
    await expect(client.complete({ system: '', prompt: '' })).rejects.toThrow('ended before [DONE]');
  });
});
