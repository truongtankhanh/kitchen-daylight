import { randomInt } from 'node:crypto';

import type { PasswordHasher } from '../../users/password-hasher.js';

/**
 * Recovery codes (ADR-0009 `WA20`; decision 0008 section 8): ten codes of 10 Crockford Base32
 * characters (50 bits) from the CSPRNG, shown once as `XXXXX-XXXXX`, stored only as argon2id PHC
 * strings with the password parameters. A code is never logged, audited or returned twice.
 */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 10;
/** Room for spaces and hyphens around the 10 characters; the service normalises the rest. */
export const RECOVERY_CODE_INPUT_MAX_LENGTH = 32;

/** Crockford Base32: digits and upper-case letters without I, L, O and U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NORMALIZED_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** One code, formatted `XXXXX-XXXXX`. `draw` is injectable for specs only. */
export function generateRecoveryCode(draw: (max: number) => number = randomInt): string {
  let code = '';
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += ALPHABET.charAt(draw(ALPHABET.length));
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** A set of distinct codes, formatted. */
export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
  draw: (max: number) => number = randomInt,
): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateRecoveryCode(draw));
  }
  return [...codes];
}

/**
 * The typed code in canonical form: upper case, spaces and hyphens removed, `O` → `0`, `I` and
 * `L` → `1`; `null` unless 10 Crockford characters remain.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]+/gu, '')
    .replace(/O/gu, '0')
    .replace(/[IL]/gu, '1');
  return NORMALIZED_PATTERN.test(code) ? code : null;
}

/** The PHC strings to store for a new set (each code hashed in its canonical form). */
export async function hashRecoveryCodes(
  codes: readonly string[],
  hasher: Pick<PasswordHasher, 'hash'>,
): Promise<string[]> {
  const hashes: string[] = [];
  for (const code of codes) {
    const normalized = normalizeRecoveryCode(code);
    if (normalized === null) {
      throw new Error('A generated recovery code is not in the Crockford layout.');
    }
    // Sequential: argon2id takes 19 MiB per derivation (decision 0008 section 4).
    hashes.push(await hasher.hash(normalized));
  }
  return hashes;
}

/**
 * The stored hash that `normalized` matches, or `undefined`. Checks every hash in turn (at most
 * ten); the path is rare and throttled (decision 0008 sections 7 and 8).
 */
export async function findRecoveryCodeHash(
  hashes: readonly string[],
  normalized: string,
  hasher: Pick<PasswordHasher, 'verify'>,
): Promise<string | undefined> {
  for (const hash of hashes) {
    if (await hasher.verify(hash, normalized)) {
      return hash;
    }
  }
  return undefined;
}
