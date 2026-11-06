import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KeySet } from './key-set.js';
import type { JwtKeyConfig } from './key-set.js';

/** A P-256 pair generated at run time, in the env:sync format (base64 of the PEM). */
function ephemeralPair(keyId: string): { keyId: string; privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
  return {
    keyId,
    privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKey: base64(publicKey.export({ type: 'spki', format: 'pem' })),
  };
}

function config(
  current: ReturnType<typeof ephemeralPair>,
  previous: ReturnType<typeof ephemeralPair>[] = [],
): JwtKeyConfig {
  return {
    keyId: current.keyId,
    privateKey: current.privateKey,
    publicKey: current.publicKey,
    previousPublicKeys: previous.map(({ keyId, publicKey }) => ({ keyId, publicKey })),
  };
}

describe('KeySet', () => {
  it('imports nothing before onModuleInit', () => {
    const keys = new KeySet(
      config({ keyId: 'kd-test-a', privateKey: 'not-a-key', publicKey: 'not-a-key' }),
    );

    expect(() => keys.signingKey()).toThrow(
      'KeySet is used before onModuleInit imported the keys.',
    );
    expect(keys.verificationKey('kd-test-a')).toBeUndefined();
  });

  it('refuses an invalid key at onModuleInit', async () => {
    const keys = new KeySet(
      config({ keyId: 'kd-test-a', privateKey: 'not-a-key', publicKey: 'not-a-key' }),
    );
    await expect(keys.onModuleInit()).rejects.toThrow();
  });

  it('signs with the current key and verifies with the current and previous keys by kid', async () => {
    const current = ephemeralPair('kd-test-current');
    const previous = ephemeralPair('kd-test-previous');
    const keys = new KeySet(config(current, [previous]));

    await keys.onModuleInit();

    expect(keys.signingKey().keyId).toBe('kd-test-current');
    expect(keys.verificationKey('kd-test-current')).toBeDefined();
    expect(keys.verificationKey('kd-test-previous')).toBeDefined();
    expect(keys.verificationKey('kd-test-unknown')).toBeUndefined();
  });

  it('lets the current public key win over a previous entry with the same kid', async () => {
    const current = ephemeralPair('kd-test-same');
    const stale = ephemeralPair('kd-test-same');
    const keys = new KeySet(config(current, [stale]));

    await keys.onModuleInit();

    const fromCurrent = new KeySet(config(current));
    await fromCurrent.onModuleInit();
    expect(keys.verificationKey('kd-test-same')).toEqual(
      fromCurrent.verificationKey('kd-test-same'),
    );
  });
});
