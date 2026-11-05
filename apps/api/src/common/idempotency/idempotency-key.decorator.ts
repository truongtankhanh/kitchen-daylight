import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

import { ApiError } from '../errors/api-error.js';
import { IDEMPOTENCY_KEY_FORMAT } from './idempotency.service.js';

/** The header name of api-outline Conventions, "Idempotency". */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/**
 * Validates a raw `Idempotency-Key` header value (decision 0007 section 10) and returns it.
 * Missing or empty: `400 VALIDATION_FAILED` with `REQUIRED`. Malformed (shorter than 8 or longer
 * than 128 characters, a character outside `A-Z a-z 0-9 - _`, or a repeated header): the same with
 * `INVALID_FORMAT` (decision 0007 row 14). The value is never echoed in the error.
 */
export function readIdempotencyKey(value: string | readonly string[] | undefined): string {
  if (value === undefined || value === '') {
    throw new ApiError('VALIDATION_FAILED', {
      errors: [{ field: IDEMPOTENCY_KEY_HEADER, code: 'REQUIRED', message: 'is required' }],
    });
  }
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_FORMAT.test(value)) {
    throw new ApiError('VALIDATION_FAILED', {
      errors: [
        {
          field: IDEMPOTENCY_KEY_HEADER,
          code: 'INVALID_FORMAT',
          message: 'must be 8 to 128 characters of A-Z, a-z, 0-9, - and _',
        },
      ],
    });
  }
  return value;
}

interface RequestWithHeaders {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/**
 * Parameter decorator: `@IdempotencyKey() key: string` reads and validates the `Idempotency-Key`
 * header, and declares it as a required header of the route in OpenAPI, so the contract shows it.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    // Node lower-cases incoming header names.
    return readIdempotencyKey(request.headers['idempotency-key']);
  },
  [
    (target, propertyKey) => {
      if (propertyKey === undefined) {
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
      if (descriptor === undefined) {
        return;
      }
      ApiHeader({
        name: IDEMPOTENCY_KEY_HEADER,
        required: true,
        description:
          'Client-chosen key, 8 to 128 characters of A-Z, a-z, 0-9, - and _ (a UUID fits). A retry with the same key and body returns the first result; the same key with another body returns 409 IDEMPOTENCY_CONFLICT.',
        schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_-]{8,128}$' },
      })(target, propertyKey, descriptor);
    },
  ],
);
