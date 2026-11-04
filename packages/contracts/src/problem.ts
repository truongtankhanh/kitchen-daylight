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

function isFieldError(value: unknown): value is FieldError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['field'] === 'string' &&
    typeof entry['code'] === 'string' &&
    typeof entry['message'] === 'string'
  );
}

/**
 * Runtime guard for an error body, for statuses the document does not declare (for example a
 * proxy 502); decision 0004 section 4.
 */
export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body['type'] === 'string' &&
    typeof body['title'] === 'string' &&
    typeof body['status'] === 'number' &&
    typeof body['code'] === 'string' &&
    (body['detail'] === undefined || typeof body['detail'] === 'string') &&
    (body['errors'] === undefined ||
      (Array.isArray(body['errors']) && body['errors'].every(isFieldError)))
  );
}
