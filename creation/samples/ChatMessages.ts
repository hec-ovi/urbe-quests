import type { ChatMessage } from '../../ports/chat.js';
import type { AgentTurn } from '../../ports/llm.js';

/** Tool calls map onto the agent transcript by position. */
export function toMessages(transcript: AgentTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
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

