import { argon2Sync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  encodePhc,
  parsePhc,
  PASSWORD_HASH_PARAMETERS,
  PasswordHasher,
} from './password-hasher.js';

/** Cheaper parameters for the specs that hash many times; the current ones are tested as well. */
const LIGHT = { memory: 1024, passes: 1, parallelism: 1, tagLength: 32, saltLength: 16 };

const FIXTURE = 'kd-fixture-passphrase';

/**
 * PHC string of `kd-fixture-password` with a fixed salt of sixteen 0x02 bytes and the current
 * parameters, computed once with `crypto.argon2Sync`. Pins the PHC encoding (unpadded standard
 * base64, `v=19`, parameter order) against regressions.
 */
const KNOWN_PHC =
  '$argon2id$v=19$m=19456,t=2,p=1$AgICAgICAgICAgICAgICAg$dXHnHyJiTe0uJywtzLGloB4ia+K0bHRr9lZ9YekPZ34';

describe('crypto.argon2 on this runtime', () => {
  it('reproduces the argon2id test vector of RFC 9106, section 5.3', () => {
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('PasswordHasher', () => {
  it('writes a PHC argon2id string with the current parameters', async () => {
    const hasher = new PasswordHasher();
    const phc = await hasher.hash(FIXTURE);

    expect(phc).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(phc).not.toContain(FIXTURE);
    expect(hasher.needsRehash(phc)).toBe(false);
    await expect(hasher.verify(phc, FIXTURE)).resolves.toBe(true);
  });

  it('verifies the known PHC string', async () => {
    const hasher = new PasswordHasher();
    await expect(hasher.verify(KNOWN_PHC, 'kd-fixture-password')).resolves.toBe(true);
    await expect(hasher.verify(KNOWN_PHC, 'kd-fixture-passwore')).resolves.toBe(false);
  });

  it('gives two hashes of one password different salts and hashes', async () => {
    const hasher = new PasswordHasher(LIGHT);
    const first = await hasher.hash(FIXTURE);
    const second = await hasher.hash(FIXTURE);

    expect(first).not.toBe(second);
    expect(parsePhc(first)?.salt.equals(parsePhc(second)!.salt)).toBe(false);
    await expect(hasher.verify(first, FIXTURE)).resolves.toBe(true);
    await expect(hasher.verify(second, FIXTURE)).resolves.toBe(true);
  });

  it('refuses a wrong password, including a change of case or a trailing space', async () => {
    const hasher = new PasswordHasher(LIGHT);
    const phc = await hasher.hash(FIXTURE);

    await expect(hasher.verify(phc, 'kd-fixture-passphrasf')).resolves.toBe(false);
    await expect(hasher.verify(phc, FIXTURE.toUpperCase())).resolves.toBe(false);
    await expect(hasher.verify(phc, `${FIXTURE} `)).resolves.toBe(false);
  });

  it('hashes the NFC form, so composed and decomposed input match', async () => {
    const hasher = new PasswordHasher(LIGHT);
    const phc = await hasher.hash(`caf${String.fromCodePoint(0x00e9)}-fixture`);
    await expect(hasher.verify(phc, `cafe${String.fromCodePoint(0x0301)}-fixture`)).resolves.toBe(
      true,
    );
  });

  it('reports needsRehash after the parameters change, and verifies with the stored ones', async () => {
    const old = await new PasswordHasher(LIGHT).hash(FIXTURE);
    const current = new PasswordHasher();

    expect(current.needsRehash(old)).toBe(true);
    expect(new PasswordHasher(LIGHT).needsRehash(old)).toBe(false);
    expect(new PasswordHasher({ ...LIGHT, passes: 2 }).needsRehash(old)).toBe(true);
    expect(new PasswordHasher({ ...LIGHT, tagLength: 16 }).needsRehash(old)).toBe(true);
    await expect(current.verify(old, FIXTURE)).resolves.toBe(true);
  });

  it('treats an unreadable string as needing a rehash and refuses to verify it', async () => {
    const hasher = new PasswordHasher(LIGHT);
    for (const phc of ['', 'not-a-hash', '$argon2i$v=19$m=1024,t=1,p=1$AAAA$AAAA']) {
      expect(hasher.needsRehash(phc)).toBe(true);
      await expect(hasher.verify(phc, FIXTURE)).rejects.toThrow(
        'The stored password hash is not a supported argon2id PHC string.',
      );
    }
    const otherVersion = (await hasher.hash(FIXTURE)).replace('$v=19$', '$v=16$');
    await expect(hasher.verify(otherVersion, FIXTURE)).rejects.toThrow();
  });

  it('round-trips encodePhc and parsePhc', () => {
    const salt = Buffer.alloc(16, 7);
    const hash = Buffer.alloc(32, 9);
    const parsed = parsePhc(encodePhc(PASSWORD_HASH_PARAMETERS, salt, hash));

    expect(parsed).toEqual({ version: 19, memory: 19456, passes: 2, parallelism: 1, salt, hash });
  });

  describe('verifyOrDummy', () => {
    it('verifies a real hash like verify', async () => {
      const hasher = new PasswordHasher(LIGHT);
      const phc = await hasher.hash(FIXTURE);

      await expect(hasher.verifyOrDummy(phc, FIXTURE)).resolves.toBe(true);
      await expect(hasher.verifyOrDummy(phc, 'kd-fixture-other')).resolves.toBe(false);
    });

    it('runs the same verify path against a dummy hash for an unknown account', async () => {
      const hasher = new PasswordHasher();
      const verify = vi.spyOn(hasher, 'verify');
      const hash = vi.spyOn(hasher, 'hash');

      // Lazy: nothing is hashed before the first use.
      expect(hash).not.toHaveBeenCalled();

      await expect(hasher.verifyOrDummy(null, FIXTURE)).resolves.toBe(false);
      await expect(hasher.verifyOrDummy(null, FIXTURE)).resolves.toBe(false);

      // One dummy hash, made once with the current parameters, then one verify per call.
      expect(hash).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(2);
      const dummy = verify.mock.calls[0]?.[0] ?? '';
      expect(verify.mock.calls[1]?.[0]).toBe(dummy);
      expect(hasher.needsRehash(dummy)).toBe(false);
    });
  });
});
