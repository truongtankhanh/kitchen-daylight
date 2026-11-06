import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACT_CENSOR, REDACT_PATHS, redactOptions } from './redaction.js';

/** A pino logger with the API's redaction, writing JSON lines to memory. */
function capture(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = pino(
    { redact: redactOptions() },
    {
      write: (line: string) => {
        lines.push(line);
      },
    },
  );
  return { logger, lines };
}

describe('REDACT_PATHS', () => {
  it('is the list of decision 0005 section 11, then the names appended by A2-T2', () => {
    expect(REDACT_PATHS).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.idToken',
      '*.secret',
      '*.privateKey',
      '*.apiKey',
      '*.otp',
      '*.databaseUrl',
      '*.emailCode',
    ]);
  });

  it('has no duplicate', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});

describe('redaction of the email-code field (A2-T2)', () => {
  it('censors emailCode in a logged object and keeps the other fields', () => {
    const { logger, lines } = capture();

    logger.info(
      {
        payload: { userId: 'fixture-user', type: 'VERIFY_EMAIL', emailCode: '042137' },
        event: 'auth.email_verified',
      },
      'email code',
    );

    const line = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line['payload']).toEqual({
      userId: 'fixture-user',
      type: 'VERIFY_EMAIL',
      emailCode: REDACT_CENSOR,
    });
    expect(line['event']).toBe('auth.email_verified');
    expect(lines.join('')).not.toContain('042137');
  });

  it('keeps the code of a logged error (owner decision 2026-11-06: no `*.code` path)', () => {
    const { logger, lines } = capture();

    logger.error({ err: { type: 'QueryFailedError', code: '23505' } }, 'request failed');

    const line = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line['err']).toEqual({ type: 'QueryFailedError', code: '23505' });
  });
});

describe('redactOptions', () => {
  it('censors with [redacted]', () => {
    expect(REDACT_CENSOR).toBe('[redacted]');
    expect(redactOptions()).toEqual({ paths: [...REDACT_PATHS], censor: '[redacted]' });
  });

  it('returns a fresh array each time, so pino cannot change the shared list', () => {
    expect(redactOptions().paths).not.toBe(redactOptions().paths);
  });
});
