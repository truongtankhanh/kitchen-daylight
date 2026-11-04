// Error body of every API error response: `application/problem+json`, RFC 9457 shape
// (api-outline, Conventions, "Errors"; decision 0004 section 7).

/** One invalid input field. Present in `errors` for `VALIDATION_FAILED`. */
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * Problem details with a stable `code`. The `code` union of the catalogue is not written here: the
 * slice that owns each code adds it through the `Code` parameter.
 */
export interface ProblemDetails<Code extends string = string> {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: Code;
  errors?: FieldError[];
  /** Code-specific members (api-outline, "Payloads added to existing codes"). */
  [member: string]: unknown;
}
