import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { mfaKeyIdOf, SecretCipher } from './secret-cipher.js';

const USER_ID = '01930000-0000-7000-8000-000000000f01';
const OTHER_USER_ID = '01930000-0000-7000-8000-000000000f02';

/** The `mfa_credentials_secret_layout` CHECK of migration 0008. */
const STORED_LAYOUT = /^v1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;

// Fixture keys made at run time; never a real key.
const KEY = randomBytes(32);
const PREVIOUS_KEY = randomBytes(32);
const SECRET = randomBytes(20);

/** Replaces part `index` (0 = version … 4 = tag) with a copy that differs in one byte. */
function tamper(stored: string, index: number): string {
  const parts = stored.split('.');
  const bytes = Buffer.from(parts[index] ?? '', 'base64url');
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  parts[index] = bytes.toString('base64url');
  return parts.join('.');
}

describe('mfaKeyIdOf', () => {
  it('is the first 16 hex digits of SHA-256("kd.mfa.kid\\n" + key)', () => {
    const expected = createHash('sha256')
      .update(Buffer.concat([Buffer.from('kd.mfa.kid\n'), KEY]))
      .digest('hex')
      .slice(0, 16);

    expect(mfaKeyIdOf(KEY)).toBe(expected);
    expect(mfaKeyIdOf(KEY)).not.toBe(mfaKeyIdOf(PREVIOUS_KEY));
  });
});

describe('SecretCipher', () => {
  const cipher = new SecretCipher(KEY);

  it('round-trips a secret in the stored layout, under the current key', () => {
    const stored = cipher.encrypt(SECRET, USER_ID);

    expect(stored).toMatch(STORED_LAYOUT);
    expect(stored.split('.')[1]).toBe(mfaKeyIdOf(KEY));
    const { plaintext, current } = cipher.decrypt(stored, USER_ID);
    expect(plaintext.equals(SECRET)).toBe(true);
    expect(current).toBe(true);
  });

  it('uses a new IV for every value, so the same secret never encrypts the same way', () => {
    const first = cipher.encrypt(SECRET, USER_ID);
    const second = cipher.encrypt(SECRET, USER_ID);

    expect(first).not.toBe(second);
    expect(first.split('.')[2]).not.toBe(second.split('.')[2]);
  });

  it('never stores the secret in clear, in hex or in Base32-like form', () => {
    const stored = cipher.encrypt(SECRET, USER_ID);

    expect(stored).not.toContain(SECRET.toString('base64url'));
    expect(stored).not.toContain(SECRET.toString('hex'));
  });

  it.each([
    ['the IV', 2],
    ['the ciphertext', 3],
    ['the tag', 4],
  ])('detects a change to %s', (_part, index) => {
    const stored = tamper(cipher.encrypt(SECRET, USER_ID), index);

    expect(() => cipher.decrypt(stored, USER_ID)).toThrow(
      'The stored MFA secret failed authentication.',
    );
  });

  it("refuses a value copied to another user's row (associated data)", () => {
    const stored = cipher.encrypt(SECRET, USER_ID);

    expect(() => cipher.decrypt(stored, OTHER_USER_ID)).toThrow(
      'The stored MFA secret failed authentication.',
    );
  });

  it.each([
    ['another version', (stored: string) => stored.replace(/^v1\./, 'v2.')],
    ['a missing part', (stored: string) => stored.split('.').slice(0, 4).join('.')],
    ['an empty value', () => ''],
  ])('refuses %s without echoing the value', (_case, change) => {
    const stored = change(cipher.encrypt(SECRET, USER_ID));
    let thrown: unknown;
    try {
      cipher.decrypt(stored, USER_ID);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe('The stored MFA secret is not in the v1 layout.');
  });

  it('refuses a value of an unknown key', () => {
    const stored = new SecretCipher(randomBytes(32)).encrypt(SECRET, USER_ID);

    expect(() => cipher.decrypt(stored, USER_ID)).toThrow(
      'The stored MFA secret was encrypted with an unknown key.',
    );
  });

  it('decrypts with a previous key and says so, for re-encryption (rotation)', () => {
    const stored = new SecretCipher(PREVIOUS_KEY).encrypt(SECRET, USER_ID);
    const rotated = new SecretCipher(KEY, [PREVIOUS_KEY]);

    const { plaintext, current } = rotated.decrypt(stored, USER_ID);

    expect(plaintext.equals(SECRET)).toBe(true);
    expect(current).toBe(false);
    expect(rotated.encrypt(plaintext, USER_ID).split('.')[1]).toBe(mfaKeyIdOf(KEY));
  });

  it('builds from the validated base64 configuration and refuses a short key', () => {
    const fromConfig = SecretCipher.fromConfig({
      key: KEY.toString('base64'),
      previousKeys: [PREVIOUS_KEY.toString('base64')],
    });

    expect(fromConfig.decrypt(cipher.encrypt(SECRET, USER_ID), USER_ID).current).toBe(true);
    expect(() =>
      SecretCipher.fromConfig({ key: randomBytes(16).toString('base64'), previousKeys: [] }),
    ).toThrow('An MFA encryption key must be 32 bytes.');
  });
});
