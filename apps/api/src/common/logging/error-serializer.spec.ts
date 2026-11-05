import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { serializeError } from './error-serializer.js';
import { buildPinoHttpOptions } from './logging.module.js';

/** Shaped like TypeORM's `QueryFailedError` on a unique violation (fictional values). */
function queryFailedError(): Error {
  class QueryFailedError extends Error {}
  return Object.assign(
    new QueryFailedError('duplicate key value violates unique constraint "users_email_key"'),
    {
      query: 'INSERT INTO "users"("email", "phone", "password_hash") VALUES ($1, $2, $3)',
      parameters: ['buyer@example.com', '+84900000001', '$argon2id$v=19$secret-hash'],
      driverError: { detail: 'Key (email)=(buyer@example.com) already exists.' },
      detail: 'Key (email)=(buyer@example.com) already exists.',
      code: '23505',
      constraint: 'users_email_key',
      table: 'users',
    },
  );
}

describe('serializeError', () => {
  it('keeps type, message, stack, code and constraint of a query failure, and nothing else', () => {
    const logged = serializeError(queryFailedError()) as Record<string, unknown>;

    expect(Object.keys(logged).sort()).toEqual(['code', 'constraint', 'message', 'stack', 'type']);
    expect(logged['type']).toBe('QueryFailedError');
    expect(logged['code']).toBe('23505');
    expect(logged['constraint']).toBe('users_email_key');
    expect(JSON.stringify(logged)).not.toContain('example.com');
    expect(JSON.stringify(logged)).not.toContain('+8490');
    expect(JSON.stringify(logged)).not.toContain('argon2');
  });

  it('keeps the status of an HTTP exception but not its response body', () => {
    const error = Object.assign(new Error('Bad Request'), {
      status: 400,
      response: { message: ['buyer@example.com is already registered'] },
      options: { cause: 'buyer@example.com' },
    });

    const logged = serializeError(error) as Record<string, unknown>;

    expect(logged['status']).toBe(400);
    expect(JSON.stringify(logged)).not.toContain('example.com');
  });

  it('reads the type of an already serialized error (the pino-http wrapper)', () => {
    expect(
      serializeError({ type: 'TypeError', message: 'x', stack: 'TypeError: x', extra: 'secret' }),
    ).toEqual({
      type: 'TypeError',
      message: 'x',
      stack: 'TypeError: x',
    });
  });

  it.each([
    ['a code with spaces', { code: 'not a code' }],
    ['a constraint that is not an identifier', { constraint: 'Key (email)=(buyer@example.com)' }],
    ['a status out of range', { status: 42 }],
  ])('drops %s', (_case, extra) => {
    const logged = serializeError(Object.assign(new Error('m'), extra)) as Record<string, unknown>;
    expect(Object.keys(logged).sort()).toEqual(['message', 'stack', 'type']);
  });

  it.each([null, undefined, 'text', 42])('returns %s unchanged', (value) => {
    expect(serializeError(value)).toBe(value);
  });

  it('is the err serializer of the module, so a logged error carries no SQL parameter', () => {
    const { level, redact, serializers } = buildPinoHttpOptions('info');
    const lines: string[] = [];
    const logger = pino(
      { level, redact, serializers },
      { write: (line: string) => void lines.push(line) },
    );

    logger.error({ err: queryFailedError() }, 'request failed');

    const raw = lines.join('');
    expect(raw).toContain('"code":"23505"');
    expect(raw).not.toContain('example.com');
    expect(raw).not.toContain('parameters');
    expect(raw).not.toContain('driverError');
  });
});
