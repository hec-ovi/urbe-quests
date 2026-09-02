/**
 * Injected LLM access. The quests layer never owns a provider or caps output
 * length; the consumer wires these to its model of choice.
 */

/** Free-text completion; used by story generation and memory summarization. */
export interface LLMPort {
  complete(request: { system: string; prompt: string }): Promise<string>;
}

/** One tool the agent loop may call. */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON schema of the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface AgentToolCall {
  tool: string;
  input: unknown;
}

/**
 * Tool loop for the questline builder: the port sends the conversation to the
 * model and returns either tool calls (answered via `toolResults` on the next
 * step) or a final text.
 */
export interface AgentPort {
  step(request: {
    system: string;
    prompt: string;
    tools: AgentTool[];
    transcript: AgentTurn[];
  }): Promise<AgentReply>;
}

export type AgentTurn =
  | { role: 'assistant'; calls: AgentToolCall[] }
  | { role: 'tool'; results: { tool: string; result: string }[] }
  /** The agent answered in words instead of tool calls; kept so the exchange stays whole. */
  | { role: 'assistant'; text: string }
  /** A line from the loop back to the agent (a nudge to finish the job with the tools). */
  | { role: 'user'; text: string };

export type AgentReply =
  | { kind: 'calls'; calls: AgentToolCall[] }
  | { kind: 'done'; text: string };
