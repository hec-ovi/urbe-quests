/**
 * Stage ports that keep what a live run's model said, as a Recording that
 * replays through RecordedPorts to the same questlines. A text stage keeps
 * its last answer: after a repair round that is the one that parsed, so
 * replay parses it on the first call. A build keeps only the rounds that
 * called tools: the draft is the ordered tool calls, so a reply in words
 * and the nudge it earned change nothing a replay needs.
 */

import type { AgentToolCall, LLMPort } from '../../ports/llm.js';
import type { StagePorts } from '../schema.js';
import { titleOf, type Recording } from './RecordedPorts.js';

export type RecordingMeta = Pick<Recording, 'prompt' | 'model' | 'mechanics' | 'missionItemTemplates'>;

export function recordingPorts(live: StagePorts, meta: RecordingMeta): { ports: StagePorts; recording(): Recording } {
  const answers = { script: '', situations: '' };
  const plans: Record<string, string> = {};
  const builds: Record<string, AgentToolCall[][]> = {};
  const keep = (port: LLMPort, store: (answer: string, prompt: string) => void): LLMPort => ({
    complete: async (request) => {
      const answer = await port.complete(request);
      store(answer, request.prompt);
      return answer;
    },
  });

  return {
    ports: {
      script: keep(live.script, (answer) => (answers.script = answer)),
      situations: keep(live.situations, (answer) => (answers.situations = answer)),
      plan: keep(live.plan, (answer, prompt) => (plans[titleOf(prompt)] = answer)),
      build: {
        step: async (request) => {
          const reply = await live.build.step(request);
          // A copy: the draft keeps the objects it is handed and may settle them later.
          if (reply.kind === 'calls') (builds[titleOf(request.prompt)] ??= []).push(structuredClone(reply.calls));
          return reply;
        },
      },
    },
    recording: () =>
      structuredClone({
        prompt: meta.prompt,
        model: meta.model,
        ...answers,
        plans,
        builds,
        ...(meta.mechanics !== undefined ? { mechanics: meta.mechanics } : {}),
        ...(meta.missionItemTemplates !== undefined ? { missionItemTemplates: meta.missionItemTemplates } : {}),
      }),
  };
}
