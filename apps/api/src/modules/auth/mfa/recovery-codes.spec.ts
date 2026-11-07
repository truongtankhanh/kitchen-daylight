import { describe, expect, it, vi } from 'vitest';

import {
  findRecoveryCodeHash,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './recovery-codes.js';

/** Crockford Base32 in the displayed layout. */
const DISPLAYED = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/** A stand-in for `PasswordHasher`: never the argon2 cost in a unit spec. */
const fakeHasher = {
  hash: vi.fn((code: string) => Promise.resolve(`fake-phc:${code}`)),
  verify: vi.fn((hash: string, code: string) => Promise.resolve(hash === `fake-phc:${code}`)),
};

describe('generateRecoveryCodes', () => {
  it('makes ten distinct codes of 10 Crockford characters, shown as XXXXX-XXXXX', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(DISPLAYED);
    }
  });

  it('draws every character from the 32-symbol alphabet', () => {
    const draws: number[] = [];
    const code = generateRecoveryCode((max) => {
      draws.push(max);
      return draws.length - 1;
    });

    expect(draws).toEqual(Array.from({ length: 10 }, () => 32));
    expect(code).toBe('01234-56789');
    expect(generateRecoveryCode(() => 31)).toBe('ZZZZZ-ZZZZZ');
  });

  it('draws again when a code repeats', () => {
    let calls = 0;
    // The first two codes are identical, the third differs.
    const codes = generateRecoveryCodes(2, () => (calls++ < 20 ? 0 : 1));

    expect(codes).toEqual(['00000-00000', '11111-11111']);
  });
});

describe('normalizeRecoveryCode', () => {
  it.each([
    ['ABCDE-12345', 'ABCDE12345'],
    ['abcde-12345', 'ABCDE12345'],
    [' abcde 12345 ', 'ABCDE12345'],
    ['AB-CDE-123-45', 'ABCDE12345'],
    ['O0OOO-IL1il', '0000011111'],
  ])('reads %j as %s', (input, normalized) => {
    expect(normalizeRecoveryCode(input)).toBe(normalized);
  });

  it.each(['', 'ABCDE-1234', 'ABCDE-123456', 'ABCDE-1234U', 'ABCDE_12345', 'ÀBCDE-12345'])(
    'refuses %j',
    (input) => {
      expect(normalizeRecoveryCode(input)).toBeNull();
    },
  );

  it('round-trips every generated code', () => {
    for (const code of generateRecoveryCodes()) {
      expect(normalizeRecoveryCode(code)).toBe(code.replace('-', ''));
    }
  });
});

describe('hashRecoveryCodes and findRecoveryCodeHash', () => {
  it('hashes each code in canonical form, one PHC string per code, never the code itself', async () => {
    const hashes = await hashRecoveryCodes(['ABCDE-12345', 'FGHJK-67890'], fakeHasher);

    expect(hashes).toEqual(['fake-phc:ABCDE12345', 'fake-phc:FGHJK67890']);
    expect(hashes).not.toContain('ABCDE-12345');
  });

  it('finds the hash that a typed code matches, whatever its case and separators', async () => {
    const hashes = await hashRecoveryCodes(['ABCDE-12345', 'FGHJK-67890'], fakeHasher);
    const typed = normalizeRecoveryCode('fghjk 67890') ?? '';

    await expect(findRecoveryCodeHash(hashes, typed, fakeHasher)).resolves.toBe(
      'fake-phc:FGHJK67890',
    );
  });

  it('finds nothing for an unknown code, nor for a code no longer in the set (single use)', async () => {
    const hashes = await hashRecoveryCodes(['ABCDE-12345', 'FGHJK-67890'], fakeHasher);
    const used = hashes.filter((hash) => hash !== 'fake-phc:ABCDE12345');

    await expect(findRecoveryCodeHash(hashes, 'ZZZZZZZZZZ', fakeHasher)).resolves.toBeUndefined();
    await expect(findRecoveryCodeHash(used, 'ABCDE12345', fakeHasher)).resolves.toBeUndefined();
  });

  it('refuses to hash a code that is not in the Crockford layout', async () => {
    await expect(hashRecoveryCodes(['not-a-code'], fakeHasher)).rejects.toThrow(
      'A generated recovery code is not in the Crockford layout.',
    );
  });
});
