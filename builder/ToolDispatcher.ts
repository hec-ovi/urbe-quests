/**
 * Routes agent tool calls onto the draft. A call is checked against its own
 * schema first, so a half-written one is answered rather than thrown; draft
 * errors come back as tool results too. Nothing here aborts the loop.
 */

import type { AgentToolCall } from '../ports/llm.js';
import type { QuestlineDefinition, QuestStep } from '../flow/schema.js';
import { toolInputProblems } from './checkToolInput.js';
import { DraftError, QuestlineDraft } from './QuestlineDraft.js';
import { BUILDER_TOOLS } from './tools.js';

export interface DispatchOutcome {
  result: string;
  finished?: QuestlineDefinition;
}

export class ToolDispatcher {
  constructor(private readonly draft: QuestlineDraft) {}

  dispatch(call: AgentToolCall): DispatchOutcome {
    const schema = BUILDER_TOOLS.find((t) => t.name === call.tool)?.inputSchema;
    if (schema === undefined) return { result: `error: unknown tool ${call.tool}` };
    const problems = toolInputProblems(schema, call.input ?? {});
    if (problems.length > 0) return { result: `error: ${call.tool} not accepted: ${problems.join('; ')}` };
    try {
      return this.route(call);
    } catch (error) {
      if (error instanceof DraftError) return { result: `error: ${error.message}` };
      throw error;
    }
  }

  private route(call: AgentToolCall): DispatchOutcome {
    const input = (call.input ?? {}) as Record<string, unknown>;
    switch (call.tool) {
      case 'create_questline':
        return { result: this.draft.create(input as { id: string; title: string; premise: string }) };
      case 'add_role':
        return { result: this.draft.addRole(input as never) };
      case 'add_item':
        return { result: this.draft.addItem(input as never) };
      case 'add_fact':
        return { result: this.draft.addFact(input as never) };
      case 'add_act':
        return { result: this.draft.addAct(input as never) };
      case 'add_ending':
        return { result: this.draft.addEnding(input as never) };
      case 'add_step': {
        const step = {
          gives: [],
          needs: [],
          conditions: [],
          effects: [],
          branching: 'parallel',
          ...(input as object),
        } as unknown as QuestStep & { entry?: boolean };
        return { result: this.draft.addStep(step) };
      }
      case 'finish_questline': {
        const finished = this.draft.finish();
        return { result: `questline ${finished.id} is valid and complete`, finished };
      }
      // A tool in the catalog with no route here: a mismatch worth naming.
      default:
        return { result: `error: unknown tool ${call.tool}` };
    }
  }
}
