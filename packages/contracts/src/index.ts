// Root entry of @kd/contracts (decision 0004 section 5): hand-written shared types only.
// It must never import `src/client.ts` or `src/generated/**`, so `@kd/api` never loads the client.
export type { RealtimeEventMap } from './events.js';
export type { FieldError, ProblemDetails } from './problem.js';
export { isProblemDetails } from './problem.js';
