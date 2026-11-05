import { describe, expect, it } from 'vitest';

import { REDACT_CENSOR, REDACT_PATHS, redactOptions } from './redaction.js';

describe('REDACT_PATHS', () => {
  it('is exactly the list of decision 0005 section 11', () => {
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
    ]);
  });

  it('has no duplicate', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
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
