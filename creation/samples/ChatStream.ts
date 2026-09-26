import { chatDeltas, ChatToolCalls, type ChatToolCall } from '../../ports/chat.js';

/** Collect uncapped Chat Completions SSE text and indexed tool-call deltas. */
export async function readChatStream(body: AsyncIterable<Uint8Array> | null): Promise<{
  content: string;
  tool_calls: ChatToolCall[];
}> {
  const calls = new ChatToolCalls();
  let content = '';
  for await (const delta of chatDeltas(body)) {
    content += delta.content ?? '';
    calls.add(delta.tool_calls);
  }
  return { content, tool_calls: calls.list() };
}
