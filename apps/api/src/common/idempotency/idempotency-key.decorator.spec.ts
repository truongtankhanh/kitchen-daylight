import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  readIdempotencyKey,
} from './idempotency-key.decorator.js';

// Nest stores the parameter factories of a route under this key (`ROUTE_ARGS_METADATA`), and
// `@nestjs/swagger` stores a method-level `@ApiHeader` as a parameter `in: 'header'` under this
// one, on the method function itself.
const ROUTE_ARGS = '__routeArguments__';
const API_PARAMETERS = 'swagger/apiParameters';

class Probe {
  handler(@IdempotencyKey() key: string): string {
    return key;
  }
}

type Factory = (data: unknown, context: ExecutionContext) => string;

function factoryOf(): Factory {
  const args = Reflect.getMetadata(ROUTE_ARGS, Probe, 'handler') as Record<
    string,
    { factory: Factory }
  >;
  const [entry] = Object.values(args);
  if (entry === undefined) {
    throw new Error('No parameter decorator was registered.');
  }
  return entry.factory;
}

function contextWith(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function rejection(value: string | readonly string[] | undefined): ApiError {
  try {
    readIdempotencyKey(value);
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected readIdempotencyKey to throw.');
}

describe('readIdempotencyKey', () => {
  it.each([
    ['a UUID', '0199a3c0-0000-7000-8000-000000000001'],
    ['the shortest key', 'abcdEF12'],
    ['the longest key', 'k'.repeat(128)],
    ['dashes and underscores', 'retry_01-order_02'],
  ])('accepts %s', (_case, value) => {
    expect(readIdempotencyKey(value)).toBe(value);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
  ])('refuses %s with REQUIRED', (_case, value) => {
    const error = rejection(value);

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(400);
    expect(error.errors).toEqual([
      { field: 'Idempotency-Key', code: 'REQUIRED', message: 'is required' },
    ]);
  });

  it.each([
    ['a too short key', 'abc1234'],
    ['a too long key', 'k'.repeat(129)],
    ['a space', 'abcd 1234'],
    ['a punctuation mark', 'abcd!1234'],
    ['a dot', 'abcd.1234'],
    ['a non-ASCII letter', 'abcdé1234'],
    ['two joined headers', 'first-key-01, second-key-02'],
    ['a header array', ['first-key-01', 'second-key-02']],
  ])('refuses %s with INVALID_FORMAT, without echoing it', (_case, value) => {
    const error = rejection(value);

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors).toEqual([
      {
        field: 'Idempotency-Key',
        code: 'INVALID_FORMAT',
        message: 'must be 8 to 128 characters of A-Z, a-z, 0-9, - and _',
      },
    ]);
    expect(JSON.stringify({ message: error.message, errors: error.errors })).not.toContain(
      Array.isArray(value) ? value[0] : value,
    );
  });
});

describe('@IdempotencyKey()', () => {
  it('reads the lower-cased header of the request', () => {
    const key = '0199a3c0-0000-7000-8000-000000000001';

    expect(factoryOf()(undefined, contextWith({ 'idempotency-key': key }))).toBe(key);
  });

  it('refuses a request without the header', () => {
    expect(() => factoryOf()(undefined, contextWith({}))).toThrow(ApiError);
  });

  it('declares the header as required in OpenAPI', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(Probe.prototype, 'handler')?.value;
    const parameters = Reflect.getMetadata(API_PARAMETERS, handler as object) as unknown[];

    expect(parameters).toEqual([
      expect.objectContaining({
        name: IDEMPOTENCY_KEY_HEADER,
        in: 'header',
        required: true,
        schema: expect.objectContaining({ pattern: '^[A-Za-z0-9_-]{8,128}$' }) as unknown,
      }),
    ]);
  });
});
