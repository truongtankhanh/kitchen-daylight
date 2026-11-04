// Type-level test (decision 0004 section 7): the hand-written error types and the schemas generated
// from the API's DTOs must be assignable both ways. Checked by `typecheck`; nothing runs.
import type { components } from '../src/generated/openapi.js';
import type { FieldError, ProblemDetails } from '../src/problem.js';

type Assert<T extends true> = T;
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type ProblemDetailsMatchesSchema = Assert<
  MutuallyAssignable<components['schemas']['ProblemDetails'], ProblemDetails>
>;
export type FieldErrorMatchesSchema = Assert<
  MutuallyAssignable<components['schemas']['FieldError'], FieldError>
>;
