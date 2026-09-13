import type { AgentTurn } from '../../ports/llm.js';

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCallMessage[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCallMessage {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Tool calls map onto the agent transcript by position. */
export function toMessages(transcript: AgentTurn[]): Message[] {
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

