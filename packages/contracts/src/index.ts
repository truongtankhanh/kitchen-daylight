// Root entry of @kd/contracts (decision 0004 section 5): hand-written shared types only.
// It must never import `src/client.ts` or `src/generated/**`, so `@kd/api` never loads the client.
export type {
  ErrorCode,
  ErrorStatus,
  FieldErrorCode,
  StaleVersionActor,
  StaleVersionPayload,
} from './errors.js';
export { ERROR_CODES, ERROR_STATUS, FIELD_ERROR_CODES } from './errors.js';
export type { RealtimeEventMap } from './events.js';
export type { CursorPage, CursorQuery, EstimatedTotal, PageQuery, Paged } from './pagination.js';
export type { FieldError, ProblemDetails } from './problem.js';
export { isProblemDetails } from './problem.js';
