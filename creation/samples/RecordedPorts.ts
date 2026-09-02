/**
 * Stage ports backed by a recorded run: the model's text and tool calls come
 * from a JSON file instead of a server, so a sample can be rebuilt, checked
 * and changed with no model present. Every other part of the workflow is the
 * real one: parsing, the manifest bound, the tools, validation, casting.
 */

import type { AgentPort, AgentReply, AgentToolCall, LLMPort } from '../../ports/llm.js';
import type { StagePorts } from '../schema.js';

export interface Recording {
  /** The creation prompt this run answered. */
  prompt: string;
  /** What wrote the text, for the sample's meta.json. */
  model: string;
  script: string;
  situations: string;
  /** Plan text, manifest included, per assignment title. */
  plans: Record<string, string>;
  /** Build rounds per assignment title; each round is the tool calls that answer one turn. */
  builds: Record<string, AgentToolCall[][]>;
}

/** Assignments are rendered title first; that line says which questline a call belongs to. */
const titleOf = (prompt: string): string => /^Title: (.+)$/m.exec(prompt)?.[1] ?? 'untitled';

const text = (answer: string): LLMPort => ({ complete: async () => answer });

class RecordedAgent implements AgentPort {
  private readonly used = new Map<string, number>();

  constructor(private readonly builds: Recording['builds']) {}

  async step(request: { prompt: string }): Promise<AgentReply> {
    const title = titleOf(request.prompt);
    const rounds = this.builds[title] ?? [];
    const next = this.used.get(title) ?? 0;
    this.used.set(title, next + 1);
    const calls = rounds[next];
    if (calls === undefined) return { kind: 'done', text: `the recording has no round ${next + 1} for ${title}` };
    return { kind: 'calls', calls };
  }
}

export function recordedPorts(recording: Recording): StagePorts {
  return {
    script: text(recording.script),
    situations: text(recording.situations),
    plan: {
      complete: async (request) => recording.plans[titleOf(request.prompt)] ?? '',
    },
    build: new RecordedAgent(recording.builds),
  };
}
