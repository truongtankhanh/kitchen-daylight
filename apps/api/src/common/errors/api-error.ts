import { ERROR_STATUS } from '@kd/contracts';
import type { ErrorCode, ErrorStatus, FieldError, FieldErrorCode } from '@kd/contracts';

/** A field error whose code is one of the catalogue (`FieldErrorCode`). */
export interface ApiFieldError extends FieldError {
  readonly code: FieldErrorCode;
}

export interface ApiErrorOptions {
  /** Short English sentence, no personal data, no secret, no value from the request. */
  readonly detail?: string;
  /** Present for `VALIDATION_FAILED`. */
  readonly errors?: readonly ApiFieldError[];
  /** Code-specific members (api-outline, "Payloads added to existing codes"). */
  readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * The one error that services and controllers throw for a catalogue code. The problem+json filter
 * turns it into the body, with the status of `ERROR_STATUS` (decision 0007 section 9).
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly detail: string | undefined;
  readonly errors: readonly ApiFieldError[] | undefined;
  readonly extras: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(options.detail ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.detail = options.detail;
    this.errors = options.errors ?? (code === 'VALIDATION_FAILED' ? [] : undefined);
    this.extras = options.extras ?? {};
  }
}
