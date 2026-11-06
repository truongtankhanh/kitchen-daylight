import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/time/testing.js';
import {
  dailyWindowStart,
  EMAIL_CODE_DAILY_CAP,
  EMAIL_CODE_DAILY_WINDOW_MS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES,
  EMAIL_CODE_TTL_MS,
  emailCodeExpiresAt,
  emailCodeHmac,
  emailCodeMatches,
  generateEmailCode,
  isEmailCodeLive,
  normalizeEmailCode,
} from './email-code.service.js';

// A2-T2, testing-strategy "Auth and sessions" (6-digit code): generation, HMAC and the expiry
// decision, with a fixed clock. Throw-away key per run; no code or key literal is a real value.

const KEY = randomBytes(32);
const USER_ID = '01930000-0000-7000-8000-0000000000a1';
const OTHER_USER_ID = '01930000-0000-7000-8000-0000000000a2';
const NOW = '2026-11-06T03:00:00.000Z';
const MINUTE = 60_000;

describe('figures (decision 0008 section 6)', () => {
  it('lives 10 minutes, dies after 5 wrong attempts, at most 5 per user and type in 24 hours', () => {
    expect(EMAIL_CODE_TTL_MINUTES).toBe(10);
    expect(EMAIL_CODE_TTL_MS).toBe(10 * MINUTE);
    expect(EMAIL_CODE_MAX_ATTEMPTS).toBe(5);
    expect(EMAIL_CODE_DAILY_CAP).toBe(5);
    expect(EMAIL_CODE_DAILY_WINDOW_MS).toBe(24 * 60 * MINUTE);
  });
});

describe('generateEmailCode', () => {
  it('draws from crypto.randomInt over [0, 1000000)', () => {
    const draw = vi.fn(() => 123_456);

    expect(generateEmailCode(draw)).toBe('123456');
    expect(draw).toHaveBeenCalledWith(0, 1_000_000);
  });

  it.each([
    [0, '000000'],
    [7, '000007'],
    [42_137, '042137'],
    [999_999, '999999'],
  ])('keeps leading zeros: %i → %s', (drawn, expected) => {
    expect(generateEmailCode(() => drawn)).toBe(expected);
  });

  it('returns six ASCII digits with the real CSPRNG', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateEmailCode()).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe('normalizeEmailCode', () => {
  it.each([
    ['042137', '042137'],
    [' 042 137 ', '042137'],
    ['04\t21\n37', '042137'],
  ])('removes whitespace: %j', (typed, expected) => {
    expect(normalizeEmailCode(typed)).toBe(expected);
  });

  it.each(['', '42137', '0421378', '04213a', '０４２１３７', '٠٤٢١٣٧', '042-137'])(
    'refuses %j (not exactly six ASCII digits)',
    (typed) => {
      expect(normalizeEmailCode(typed)).toBeNull();
    },
  );
});

describe('emailCodeHmac', () => {
  it('is HMAC-SHA-256 over the versioned string of decision 0008 section 6', () => {
    const expected = createHmac('sha256', KEY)
      .update(`kd.email-code.v1\n${USER_ID}\nVERIFY_EMAIL\n042137`, 'utf8')
      .digest();

    const hash = emailCodeHmac(KEY, USER_ID, 'VERIFY_EMAIL', '042137');

    expect(hash.equals(expected)).toBe(true);
    expect(hash).toHaveLength(32);
  });

  it('binds the code to one user, one type and one key', () => {
    const base = emailCodeHmac(KEY, USER_ID, 'VERIFY_EMAIL', '042137');

    expect(base.equals(emailCodeHmac(KEY, OTHER_USER_ID, 'VERIFY_EMAIL', '042137'))).toBe(false);
    expect(base.equals(emailCodeHmac(KEY, USER_ID, 'RESET_PASSWORD', '042137'))).toBe(false);
    expect(base.equals(emailCodeHmac(KEY, USER_ID, 'VERIFY_EMAIL', '042138'))).toBe(false);
    expect(base.equals(emailCodeHmac(randomBytes(32), USER_ID, 'VERIFY_EMAIL', '042137'))).toBe(
      false,
    );
  });

  it('never contains the code in clear', () => {
    const hash = emailCodeHmac(KEY, USER_ID, 'VERIFY_EMAIL', '042137');

    expect(hash.toString('utf8')).not.toContain('042137');
    expect(hash.toString('hex')).not.toContain('042137');
  });
});

describe('emailCodeMatches', () => {
  const stored = emailCodeHmac(KEY, USER_ID, 'RESET_PASSWORD', '000042');

  it('accepts the right code for the same user and type', () => {
    expect(emailCodeMatches(KEY, stored, USER_ID, 'RESET_PASSWORD', '000042')).toBe(true);
  });

  it('refuses a wrong code, another user and another type', () => {
    expect(emailCodeMatches(KEY, stored, USER_ID, 'RESET_PASSWORD', '000043')).toBe(false);
    expect(emailCodeMatches(KEY, stored, OTHER_USER_ID, 'RESET_PASSWORD', '000042')).toBe(false);
    expect(emailCodeMatches(KEY, stored, USER_ID, 'VERIFY_EMAIL', '000042')).toBe(false);
  });

  it('refuses a stored value of another length instead of throwing', () => {
    expect(emailCodeMatches(KEY, Buffer.alloc(16), USER_ID, 'RESET_PASSWORD', '000042')).toBe(
      false,
    );
  });
});

describe('expiry decision (fixed clock)', () => {
  function issuedAt(clock: FixedClock): {
    usedAt: Date | null;
    expiresAt: Date;
    attempts: number;
    maxAttempts: number;
  } {
    return {
      usedAt: null,
      expiresAt: emailCodeExpiresAt(clock.now()),
      attempts: 0,
      maxAttempts: EMAIL_CODE_MAX_ATTEMPTS,
    };
  }

  it('expires 10 minutes after issue', () => {
    const clock = new FixedClock(NOW);

    expect(emailCodeExpiresAt(clock.now()).toISOString()).toBe('2026-11-06T03:10:00.000Z');
  });

  it('is live until just before expires_at and dead from it', () => {
    const clock = new FixedClock(NOW);
    const row = issuedAt(clock);

    expect(isEmailCodeLive(row, clock.now())).toBe(true);
    clock.advance(EMAIL_CODE_TTL_MS - 1);
    expect(isEmailCodeLive(row, clock.now())).toBe(true);
    clock.advance(1);
    expect(isEmailCodeLive(row, clock.now())).toBe(false);
  });

  it('is dead at max_attempts wrong guesses, live one below', () => {
    const clock = new FixedClock(NOW);
    const row = issuedAt(clock);

    expect(isEmailCodeLive({ ...row, attempts: EMAIL_CODE_MAX_ATTEMPTS - 1 }, clock.now())).toBe(
      true,
    );
    expect(isEmailCodeLive({ ...row, attempts: EMAIL_CODE_MAX_ATTEMPTS }, clock.now())).toBe(false);
  });

  it('is dead once used or superseded (used_at set)', () => {
    const clock = new FixedClock(NOW);
    const row = issuedAt(clock);

    expect(isEmailCodeLive({ ...row, usedAt: clock.now() }, clock.now())).toBe(false);
  });
});

describe('dailyWindowStart', () => {
  it('is 24 hours before now', () => {
    const clock = new FixedClock(NOW);

    expect(dailyWindowStart(clock.now()).toISOString()).toBe('2026-11-05T03:00:00.000Z');
  });
});
