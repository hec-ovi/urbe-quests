/**
 * Routes agent tool calls onto the draft. A call is checked against its own
 * schema first, so a half-written one is answered rather than thrown; draft
 * errors come back as tool results too. Nothing here aborts the loop.
 */

import type { AgentTool, AgentToolCall } from '../ports/llm.js';
import { STEP_KINDS, type QuestlineDefinition, type QuestStep, type StepKind } from '../flow/schema.js';
import { promptLoader } from '../prompts.js';
import { toolInputProblems } from './checkToolInput.js';
import { isStepKind } from './mechanics.js';
import { DraftError, QuestlineDraft } from './QuestlineDraft.js';
import { builderTools } from './tools.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

/** JSON with keys in order, so the same call in another key order is the same call. */
const canonical = (value: unknown): string =>
  Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
      : JSON.stringify(value) ?? 'null';

export interface DispatchOutcome {
  result: string;
  finished?: QuestlineDefinition;
}

export class ToolDispatcher {
  /** The tools the agent is offered, rendered for the playable kinds. */
  readonly tools: AgentTool[];
  private readonly refused = new Set<string>();

  constructor(
    private readonly draft: QuestlineDraft,
    private readonly kinds: readonly StepKind[] = STEP_KINDS,
  ) {
    this.tools = builderTools(kinds);
  }

  /**
   * A call refused again word for word, for the same reason, is told so: a model that resends it has not read
   * why, and the same answer again only spends rounds.
   */
  dispatch(call: AgentToolCall): DispatchOutcome {
    const outcome = this.answer(call);
    if (!outcome.result.startsWith('error:')) return outcome;
    const key = `${call.tool}\u0000${canonical(call.input)}\u0000${outcome.result}`;
    if (!this.refused.has(key)) {
      this.refused.add(key);
      return outcome;
    }
    return { result: `${outcome.result}\n${prompt('refused-again.md').trim()}` };
  }

  private answer(call: AgentToolCall): DispatchOutcome {
    const schema = this.tools.find((t) => t.name === call.tool)?.inputSchema;
    if (schema === undefined) return { result: `error: unknown tool ${call.tool}` };
    const refused = this.unplayable(call);
    if (refused !== undefined) return { result: refused };
    const problems = toolInputProblems(schema, call.input ?? {});
    if (problems.length > 0) return { result: `error: ${call.tool} not accepted: ${problems.join('; ')}` };
    try {
      return this.route(call);
    } catch (error) {
      if (error instanceof DraftError) return { result: `error: ${error.message}` };
      throw error;
    }
  }

  /** A step of a real kind the host cannot play is named as such, apart from a malformed kind. */
  private unplayable(call: AgentToolCall): string | undefined {
    if (call.tool !== 'add_step') return undefined;
    const kind = (call.input as { target?: { kind?: unknown } } | undefined)?.target?.kind;
    if (!isStepKind(kind) || this.kinds.includes(kind)) return undefined;
    return `error: step kind ${kind} is not playable here; use one of ${this.kinds.join(', ')}`;
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
