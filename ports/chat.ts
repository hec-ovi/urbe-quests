/**
 * OpenAI-compatible Chat Completions shapes and the stream reader every
 * streaming port shares: server-sent events in, choice deltas out.
 */

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** The body of a `stream: true` request, without the model the port chooses. */
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ChatTool[];
}

/** One `chat.completion.chunk` choice delta: a text fragment and indexed tool-call fragments. */
export interface ChatDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string | null;
    function?: { name?: string | null; arguments?: string | null };
  }>;
}

/**
 * Yields each choice-0 delta of a streamed Chat Completions body until
 * `[DONE]`. A provider error event, or a body that ends before `[DONE]`, rejects.
 */
export async function* chatDeltas(body: AsyncIterable<Uint8Array> | null): AsyncGenerator<ChatDelta> {
  if (body === null) throw new Error('model response has no stream');
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart()).join('\n');
      if (data.length === 0) continue;
      if (data === '[DONE]') return;
      const event = JSON.parse(data) as { choices?: { index: number; delta?: ChatDelta }[]; error?: { message: string } };
      if (event.error) throw new Error(event.error.message);
      const delta = event.choices?.find((choice) => choice.index === 0)?.delta;
      if (delta) yield delta;
    }
  }
  throw new Error('model stream ended before [DONE]');
}

/** Joins indexed tool-call fragments into whole calls, listed in index order. */
export class ChatToolCalls {
  private readonly calls = new Map<number, ChatToolCall>();

  add(fragments: ChatDelta['tool_calls']): void {
    for (const fragment of fragments ?? []) {
      let call = this.calls.get(fragment.index);
      if (call === undefined) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        this.calls.set(fragment.index, call);
      }
      call.id = fragment.id || call.id;
      call.function.name += fragment.function?.name ?? '';
      call.function.arguments += fragment.function?.arguments ?? '';
    }
  }

  /** Whole calls in index order; a call the server gave no id gets `call_<index>`. */
  list(): ChatToolCall[] {
    return [...this.calls].sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }));
  }
}
