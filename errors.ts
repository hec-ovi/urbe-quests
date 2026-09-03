/** Closed error set for the quests layer (see CONTRACT.md). */

export type QuestErrorCode =
  | 'E_INVALID_FLOW'
  | 'E_UNKNOWN_ID'
  | 'E_WRONG_STATE'
  | 'E_UNAVAILABLE'
  | 'E_CAST'
  | 'E_LLM'
  | 'E_HANDOFF';

export class QuestError extends Error {
  constructor(
    readonly code: QuestErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'QuestError';
  }
}
