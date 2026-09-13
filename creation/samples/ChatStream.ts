import type { ToolCallMessage } from './ChatMessages.js';

interface Delta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string | null;
    function?: { name?: string | null; arguments?: string | null };
  }>;
}

/** Collect uncapped Chat Completions SSE text and indexed tool-call deltas. */
export async function readChatStream(body: AsyncIterable<Uint8Array> | null): Promise<{
  content: string;
  tool_calls: ToolCallMessage[];
}> {
  if (body === null) throw new Error('model response has no stream');
  const calls = new Map<number, ToolCallMessage>();
  let content = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (data.length === 0) continue;
      if (data === '[DONE]') {
        return { content, tool_calls: [...calls].sort(([a], [b]) => a - b).map(([, call]) => call) };
      }
      const event = JSON.parse(data) as { choices?: { index: number; delta?: Delta }[]; error?: { message: string } };
      if (event.error) throw new Error(event.error.message);
      const delta = event.choices?.find(choice => choice.index === 0)?.delta;
      content += delta?.content ?? '';
      for (const fragment of delta?.tool_calls ?? []) {
        let call = calls.get(fragment.index);
        if (call === undefined) {
          call = { id: '', type: 'function', function: { name: '', arguments: '' } };
          calls.set(fragment.index, call);
        }
        call.id = fragment.id ?? call.id;
        call.function.name += fragment.function?.name ?? '';
        call.function.arguments += fragment.function?.arguments ?? '';
      }
    }
  }
  throw new Error('model stream ended before [DONE]');
}
