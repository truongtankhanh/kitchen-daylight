import type { FieldError, ProblemDetails } from '@kd/contracts';
import { ApiSchema } from '@nestjs/swagger';

// OpenAPI schemas of the hand-written error types of @kd/contracts (decision 0004 section 7).
// `implements` makes `tsc` fail when the classes and the contract types diverge; the type-level
// test of @kd/contracts checks the generated schemas against the same types.

@ApiSchema({ name: 'FieldError' })
export class FieldErrorDto implements FieldError {
  field!: string;
  code!: string;
  message!: string;
}

@ApiSchema({ name: 'ProblemDetails' })
export class ProblemDetailsDto implements ProblemDetails {
  type!: string;
  title!: string;
  status!: number;
  detail?: string;
  code!: string;
  errors?: FieldErrorDto[];
  [member: string]: unknown;
}
