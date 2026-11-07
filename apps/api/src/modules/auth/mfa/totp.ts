import { randomBytes } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';

import type { AppEnv } from '../../../config/config.schema.js';

/**
 * TOTP parameters of decision 0008 section 8: HMAC-SHA-1, 6 digits, 30-second steps (what
 * authenticator apps assume), a window of one step either side, a 160-bit secret.
 */
export const TOTP_ALGORITHM = 'SHA1';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

/** Working name of the brand (ADR-0009 `WA1`); new enrolments only, existing entries keep theirs. */
export const TOTP_ISSUER = 'Kitchen Daylight';

const TOTP_CODE_PATTERN = new RegExp(`^[0-9]{${TOTP_DIGITS}}$`);

/** A new random secret (CSPRNG). Never logged; stored only encrypted (`secret-cipher.ts`). */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** `Kitchen Daylight`, with the tier in brackets outside `prod` so test entries stand apart. */
export function totpIssuer(appEnv: AppEnv): string {
  return appEnv === 'prod' ? TOTP_ISSUER : `${TOTP_ISSUER} (${appEnv})`;
}

function totpOf(secret: Buffer, issuer = '', label = 'OTPAuth'): TOTP {
  // A copy, so a pooled Buffer never exposes its neighbours to the library.
  const bytes = Uint8Array.from(secret);
  return new TOTP({
    issuer,
    label,
    secret: new Secret({ buffer: bytes.buffer }),
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
  });
}

/** The secret as authenticator apps type it: RFC 4648 Base32, no padding. */
export function totpSecretBase32(secret: Buffer): string {
  return totpOf(secret).secret.base32;
}

/** `otpauth://totp/<issuer>:<label>?issuer=…&secret=…` for the QR code; label is the email. */
export function totpUri(secret: Buffer, issuer: string, label: string): string {
  return totpOf(secret, issuer, label).toString();
}

/** The 30-second time step of `now` (`last_used_step` counts these). */
export function totpStep(now: Date): number {
  return TOTP.counter({ period: TOTP_PERIOD_SECONDS, timestamp: now.getTime() });
}

/** The typed code with whitespace removed, or `null` unless exactly six ASCII digits remain. */
export function normalizeTotpCode(input: string): string | null {
  const code = input.replace(/\s+/gu, '');
  return TOTP_CODE_PATTERN.test(code) ? code : null;
}

/**
 * The step at which `code` is valid within the window around `now`, or `null`. A step at or below
 * `lastUsedStep` is refused (replay, decision 0008 section 8); the caller still claims the step
 * with a conditional `UPDATE`, so two requests cannot both spend it. Comparison is constant time
 * (the library uses `crypto.timingSafeEqual`).
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): number | null {
  const delta = TOTP.validate({
    token: code,
    secret: totpOf(secret).secret,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    timestamp: now.getTime(),
    window: TOTP_WINDOW,
    afterCounter: lastUsedStep,
  });
  return delta === null ? null : totpStep(now) + delta;
}
