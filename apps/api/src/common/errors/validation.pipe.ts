import { ValidationPipe } from '@nestjs/common';
import type { FieldErrorCode } from '@kd/contracts';
import type { ValidationError } from 'class-validator';

import { ApiError } from './api-error.js';
import type { ApiFieldError } from './api-error.js';

// class-validator constraint name → catalogue field code (api-outline, "Field-level codes").
// A constraint not listed here gets `INVALID` (api-divergences D-001).
const CONSTRAINT_CODES: Readonly<Record<string, FieldErrorCode>> = {
  isDefined: 'REQUIRED',
  isNotEmpty: 'REQUIRED',
  maxLength: 'TOO_LONG',
  min: 'OUT_OF_RANGE',
  max: 'OUT_OF_RANGE',
  isEmail: 'INVALID_EMAIL',
};

// When a field breaks several rules, a missing value is reported first.
const FIRST_CONSTRAINTS = ['isDefined', 'isNotEmpty'];

// Set by `forbidNonWhitelisted` for a property the DTO does not declare.
const UNKNOWN_PROPERTY = 'whitelistValidation';

// Fixed English messages: the message is chosen from the code, never from class-validator's text,
// so the rejected value can never appear in it.
const MESSAGES: Readonly<Partial<Record<FieldErrorCode, string>>> = {
  REQUIRED: 'is required',
  TOO_LONG: 'is too long',
  OUT_OF_RANGE: 'is out of range',
  INVALID_EMAIL: 'must be a valid email address',
  INVALID: 'is invalid',
};

function fieldError(field: string, constraints: readonly string[]): ApiFieldError {
  if (constraints.includes(UNKNOWN_PROPERTY)) {
    return { field, code: 'INVALID', message: 'is not allowed' };
  }
  const first = FIRST_CONSTRAINTS.find((name) => constraints.includes(name)) ?? constraints[0];
  const code: FieldErrorCode =
    (first === undefined ? undefined : CONSTRAINT_CODES[first]) ?? 'INVALID';
  return { field, code, message: MESSAGES[code] ?? 'is invalid' };
}

/**
 * Flattens class-validator errors to one entry per field, with a dotted path: nested objects give
 * `address.city`, array items give `items.0.quantity`.
 */
export function toFieldErrors(errors: readonly ValidationError[], parent = ''): ApiFieldError[] {
  const result: ApiFieldError[] = [];
  for (const error of errors) {
    const field = parent === '' ? error.property : `${parent}.${error.property}`;
    const constraints = Object.keys(error.constraints ?? {});
    if (constraints.length > 0) {
      result.push(fieldError(field, constraints));
    }
    if (error.children !== undefined && error.children.length > 0) {
      result.push(...toFieldErrors(error.children, field));
    }
  }
  return result;
}

/**
 * The global validation pipe (decision 0007 section 2: `@Type` is explicit, no implicit conversion).
 * Unknown properties are rejected, every error is collected, and the result is
 * `400 VALIDATION_FAILED` with `errors[] { field, code, message }`.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    // Keeps the rejected value and the DTO instance out of the error objects altogether.
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApiError('VALIDATION_FAILED', { errors: toFieldErrors(errors) }),
  });
}
