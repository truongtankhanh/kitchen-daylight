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
  it('is the list of decision 0005 section 11, then the names appended by A2-T2, A2-T6 and A3-T2', () => {
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
      '*.nonce',
      '*.recoveryCode',
      '*.recoveryCodes',
      '*.mfaToken',
      '*.challenge',
      '*.otpauthUri',
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

describe('redaction of the social nonce (A2-T6)', () => {
  it('censors nonce in a logged object and keeps the other fields', () => {
    const { logger, lines } = capture();
    const nonce = '1794027205463.kd-fixture-random-part-x.kd-fixture-mac';

    logger.warn({ payload: { provider: 'GOOGLE', nonce }, event: 'auth.social_refused' }, 'nonce');

    const line = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line['payload']).toEqual({ provider: 'GOOGLE', nonce: REDACT_CENSOR });
    expect(lines.join('')).not.toContain(nonce);
  });
});

describe('redaction of the second-factor fields (A3-T2)', () => {
  it('censors recovery codes, MFA tokens and the otpauth URI, and keeps the other fields', () => {
    const { logger, lines } = capture();
    // Fictional values.
    const payload = {
      userId: '01930000-0000-7000-8000-000000000f41',
      recoveryCode: 'ABCDE-12345',
      recoveryCodes: ['FGHJK-67890'],
      mfaToken: 'kd-fixture-mfa-token',
      challenge: 'kd-fixture-challenge',
      otpauthUri: 'otpauth://totp/kd-fixture?secret=KDFIXTURE',
    };

    logger.warn({ payload, event: 'auth.mfa_failed' }, 'second factor');

    const line = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line['payload']).toEqual({
      userId: payload.userId,
      recoveryCode: REDACT_CENSOR,
      recoveryCodes: REDACT_CENSOR,
      mfaToken: REDACT_CENSOR,
      challenge: REDACT_CENSOR,
      otpauthUri: REDACT_CENSOR,
    });
    for (const secret of [
      'ABCDE',
      'FGHJK',
      'kd-fixture-mfa-token',
      'kd-fixture-challenge',
      'KDFIXTURE',
    ]) {
      expect(lines.join('')).not.toContain(secret);
    }
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
