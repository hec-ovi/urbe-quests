export type AuthoringErrorCode =
  | 'E_AUTHORING_INPUT'
  | 'E_AUTHORING_OUTPUT'
  | 'E_SKILL_CONTRACT'
  | 'E_UNKNOWN_SKILL'
  | 'E_UNSUPPORTED_MECHANIC'
  | 'E_MECHANIC_SELECTION'
  | 'E_WORLD_TARGET'
  | 'E_CAUSE_EFFECT'
  | 'E_INVALID_FLOW';

export class AuthoringError extends Error {
  readonly code: AuthoringErrorCode;
  readonly details: string[];

  constructor(code: AuthoringErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'AuthoringError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: AuthoringErrorCode; message: string; details: string[] } {
    return { code: this.code, message: this.message, details: [...this.details] };
  }
}
