// Type-level test (decision 0004 section 7): the hand-written error types and the schemas generated
// from the API's DTOs must be assignable both ways. Checked by `typecheck`; nothing runs.
import type { ErrorCode } from '../src/errors.js';
import type { components } from '../src/generated/openapi.js';
import type { FieldError, ProblemDetails } from '../src/problem.js';

type Assert<T extends true> = T;
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// The API's `ProblemDetailsDto` implements `ProblemDetails<ErrorCode>` (decision 0007 section 9).
export type ProblemDetailsMatchesSchema = Assert<
  MutuallyAssignable<components['schemas']['ProblemDetails'], ProblemDetails<ErrorCode>>
>;
export type ErrorCodeMatchesSchema = Assert<
  MutuallyAssignable<components['schemas']['ErrorCode'], ErrorCode>
>;
export type FieldErrorMatchesSchema = Assert<
  MutuallyAssignable<components['schemas']['FieldError'], FieldError>
>;
