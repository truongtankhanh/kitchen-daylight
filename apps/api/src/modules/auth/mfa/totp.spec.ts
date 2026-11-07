import { TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../../common/time/testing.js';
import {
  generateTotpSecret,
  normalizeTotpCode,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  totpIssuer,
  totpSecretBase32,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp.js';

/** RFC 6238 appendix B: the SHA-1 seed, ASCII "12345678901234567890". */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

/** A code of `secret` for the step that contains `instant` (as an authenticator app shows it). */
function codeAt(secret: Buffer, instant: Date): string {
  return TOTP.generate({
    secret: new TOTP({ secret: totpSecretBase32(secret) }).secret,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    timestamp: instant.getTime(),
  });
}

const STEP_MS = TOTP_PERIOD_SECONDS * 1000;

describe('verifyTotp (RFC 6238 test vectors, last six digits)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('accepts the code of T = %i s', (seconds, code) => {
    const clock = new FixedClock(new Date(seconds * 1000));

    expect(verifyTotp(RFC_SECRET, code, clock.now(), null)).toBe(totpStep(clock.now()));
  });
});

describe('verifyTotp (window and replay, fixed clock)', () => {
  const clock = new FixedClock('2026-11-07T03:00:10.000Z');
  const secret = generateTotpSecret();
  const step = totpStep(clock.now());
  const at = (offsetSteps: number): Date => new Date(clock.now().getTime() + offsetSteps * STEP_MS);

  it('accepts the current step and one step either side, returning the step of the code', () => {
    expect(verifyTotp(secret, codeAt(secret, at(0)), clock.now(), null)).toBe(step);
    expect(verifyTotp(secret, codeAt(secret, at(-1)), clock.now(), null)).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(secret, at(1)), clock.now(), null)).toBe(step + 1);
  });

  it('refuses codes two steps away (window edge)', () => {
    expect(verifyTotp(secret, codeAt(secret, at(-2)), clock.now(), null)).toBeNull();
    expect(verifyTotp(secret, codeAt(secret, at(2)), clock.now(), null)).toBeNull();
  });

  it('accepts a code until the end of the next step, and refuses it from the step after', () => {
    const code = codeAt(secret, clock.now());
    const endOfNextStep = new Date((step + 2) * STEP_MS - 1);

    expect(verifyTotp(secret, code, endOfNextStep, null)).toBe(step);
    expect(verifyTotp(secret, code, new Date((step + 2) * STEP_MS), null)).toBeNull();
  });

  it('refuses a replayed step: the stored step and anything earlier', () => {
    const code = codeAt(secret, at(0));

    expect(verifyTotp(secret, code, clock.now(), step)).toBeNull();
    expect(verifyTotp(secret, code, clock.now(), step + 1)).toBeNull();
    expect(verifyTotp(secret, code, clock.now(), step - 1)).toBe(step);
  });

  it('refuses a code of the previous step once a later step was used', () => {
    expect(verifyTotp(secret, codeAt(secret, at(-1)), clock.now(), step - 1)).toBeNull();
  });

  it('refuses a code of another secret and malformed codes', () => {
    const other = generateTotpSecret();

    expect(verifyTotp(secret, codeAt(other, at(0)), clock.now(), null)).toBeNull();
    for (const code of ['', '12345', '1234567', 'abcdef', '12 345']) {
      expect(verifyTotp(secret, code, clock.now(), null)).toBeNull();
    }
  });
});

describe('normalizeTotpCode', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    [' 012345 ', '012345'],
    ['12\t34 56', '123456'],
  ])('reads %j as %s', (input, code) => {
    expect(normalizeTotpCode(input)).toBe(code);
  });

  it.each(['', '12345', '1234567', '12345a', '١٢٣٤٥٦', '123-456'])('refuses %j', (input) => {
    expect(normalizeTotpCode(input)).toBeNull();
  });
});

describe('secret, issuer and URI', () => {
  it('generates 160-bit secrets, different each time', () => {
    const first = generateTotpSecret();

    expect(first).toHaveLength(TOTP_SECRET_BYTES);
    expect(first.equals(generateTotpSecret())).toBe(false);
  });

  it('writes the secret in unpadded Base32 (32 characters for 20 bytes)', () => {
    expect(totpSecretBase32(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it.each([
    ['prod', 'Kitchen Daylight'],
    ['demo', 'Kitchen Daylight (demo)'],
    ['dev', 'Kitchen Daylight (dev)'],
    ['test', 'Kitchen Daylight (test)'],
  ] as const)('names the issuer for %s', (appEnv, issuer) => {
    expect(totpIssuer(appEnv)).toBe(issuer);
  });

  it('builds the otpauth URI with issuer, email label and the decision 0008 parameters', () => {
    const uri = new URL(
      totpUri(RFC_SECRET, 'Kitchen Daylight (test)', 'owner@kitchendaylight.example'),
    );

    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe(
      '/Kitchen Daylight (test):owner@kitchendaylight.example',
    );
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      issuer: 'Kitchen Daylight (test)',
      // The Base32 value itself is pinned by the `totpSecretBase32` test above.
      secret: totpSecretBase32(RFC_SECRET),
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});
