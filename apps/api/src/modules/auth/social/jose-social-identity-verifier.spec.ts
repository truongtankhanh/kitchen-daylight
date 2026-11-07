import { createHash } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey, JWTPayload, JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthProvider } from '../entities/auth-identity.entity.js';
import {
  isEmailVerifiedClaim,
  JoseSocialIdentityVerifier,
  nonceClaimMatches,
  SOCIAL_PROVIDER_SETTINGS,
} from './jose-social-identity-verifier.js';
import type { KeySetFactory } from './jose-social-identity-verifier.js';
import { SocialTokenRejectedError } from './social-identity-verifier.js';

// A2-T6: the claim checks of the real verifier, with a key pair generated per run and a local key
// set (`createLocalJWKSet`): no network, no key literal. Fictional subjects and emails only.

const GOOGLE_CLIENT_ID = '1234-kd-test.apps.googleusercontent.com';
const APPLE_CLIENT_ID = 'com.example.kitchendaylight';
const NONCE = 'kd-test-nonce-value';
const KEY_ID = 'kd-test-key';

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let keySet: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keySet = createLocalJWKSet({ keys: [{ ...jwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] });
});

function verifier(
  ids: { google?: string[]; apple?: string[] } = {},
  factory?: KeySetFactory,
): JoseSocialIdentityVerifier {
  return new JoseSocialIdentityVerifier(
    {
      googleClientIds: ids.google ?? [GOOGLE_CLIENT_ID],
      appleClientIds: ids.apple ?? [APPLE_CLIENT_ID],
    },
    factory ?? (() => keySet),
  );
}

interface TokenOptions {
  readonly claims?: JWTPayload;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresAt?: number;
  readonly key?: CryptoKey;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function token(provider: AuthProvider, options: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    nonce: NONCE,
    email: 'fixture-social@kd.example',
    email_verified: true,
    ...options.claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setSubject('kd-subject-001')
    .setIssuer(options.issuer ?? (SOCIAL_PROVIDER_SETTINGS[provider].issuers[0] as string))
    .setAudience(options.audience ?? (provider === 'GOOGLE' ? GOOGLE_CLIENT_ID : APPLE_CLIENT_ID))
    .setIssuedAt(nowSeconds() - 60)
    .setExpirationTime(options.expiresAt ?? nowSeconds() + 600)
    .sign(options.key ?? signingKey);
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SocialTokenRejectedError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('expected the token to be refused');
}

describe('JoseSocialIdentityVerifier', () => {
  it.each(['GOOGLE', 'APPLE'] as const)('accepts a valid %s token', async (provider) => {
    const identity = await verifier().verify(provider, await token(provider), NONCE);

    expect(identity).toEqual({
      provider,
      subject: 'kd-subject-001',
      email: 'fixture-social@kd.example',
      emailVerified: true,
      name: null,
    });
  });

  it('accepts both Google issuers', async () => {
    const token1 = await token('GOOGLE', { issuer: 'accounts.google.com' });

    await expect(verifier().verify('GOOGLE', token1, NONCE)).resolves.toMatchObject({
      subject: 'kd-subject-001',
    });
  });

  it('refuses a token for another client id (aud)', async () => {
    const wrongAud = await token('GOOGLE', { audience: '9999-other.apps.googleusercontent.com' });

    expect(await rejection(verifier().verify('GOOGLE', wrongAud, NONCE))).toBe('audience');
  });

  it('accepts any client id of the allow-list', async () => {
    const second = '5678-kd-test.apps.googleusercontent.com';
    const forSecond = await token('GOOGLE', { audience: second });

    await expect(
      verifier({ google: [GOOGLE_CLIENT_ID, second] }).verify('GOOGLE', forSecond, NONCE),
    ).resolves.toMatchObject({ provider: 'GOOGLE' });
  });

  it('refuses a token of the other provider (iss)', async () => {
    const appleToken = await token('APPLE', { audience: GOOGLE_CLIENT_ID });

    expect(await rejection(verifier().verify('GOOGLE', appleToken, NONCE))).toBe('issuer');
  });

  it('refuses an expired token beyond the 30 s tolerance', async () => {
    const expired = await token('APPLE', { expiresAt: nowSeconds() - 120 });

    expect(await rejection(verifier().verify('APPLE', expired, NONCE))).toBe('expired');
  });

  it('refuses a token signed by another key', async () => {
    const forged = await token('GOOGLE', { key: otherKey });

    expect(await rejection(verifier().verify('GOOGLE', forged, NONCE))).toBe('signature');
  });

  it('refuses a token that is not a JWT', async () => {
    expect(await rejection(verifier().verify('GOOGLE', 'not-a-token', NONCE))).toBe('malformed');
  });

  it('refuses a token without a nonce or with another nonce', async () => {
    const without = await token('GOOGLE', { claims: { nonce: undefined } });
    const other = await token('GOOGLE', { claims: { nonce: 'another-nonce' } });

    expect(await rejection(verifier().verify('GOOGLE', without, NONCE))).toBe('nonce');
    expect(await rejection(verifier().verify('GOOGLE', other, NONCE))).toBe('nonce');
  });

  it('accepts the hex SHA-256 of the nonce for Apple only', async () => {
    const hashed = createHash('sha256').update(NONCE).digest('hex');

    await expect(
      verifier().verify('APPLE', await token('APPLE', { claims: { nonce: hashed } }), NONCE),
    ).resolves.toMatchObject({ provider: 'APPLE' });
    expect(
      await rejection(
        verifier().verify('GOOGLE', await token('GOOGLE', { claims: { nonce: hashed } }), NONCE),
      ),
    ).toBe('nonce');
  });

  it('reads email_verified as a boolean or the string "true" only', async () => {
    const asString = await token('APPLE', { claims: { email_verified: 'true' } });
    const asFalse = await token('APPLE', { claims: { email_verified: 'false' } });
    const absent = await token('APPLE', { claims: { email_verified: undefined } });

    await expect(verifier().verify('APPLE', asString, NONCE)).resolves.toMatchObject({
      emailVerified: true,
    });
    await expect(verifier().verify('APPLE', asFalse, NONCE)).resolves.toMatchObject({
      emailVerified: false,
    });
    await expect(verifier().verify('APPLE', absent, NONCE)).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it('keeps a private-relay email as sent and reads the Google name', async () => {
    const relay = await token('APPLE', {
      claims: { email: 'abc123xyz@privaterelay.appleid.com' },
    });
    const named = await token('GOOGLE', { claims: { name: 'Người dùng mẫu' } });

    await expect(verifier().verify('APPLE', relay, NONCE)).resolves.toMatchObject({
      email: 'abc123xyz@privaterelay.appleid.com',
    });
    await expect(verifier().verify('GOOGLE', named, NONCE)).resolves.toMatchObject({
      name: 'Người dùng mẫu',
    });
  });

  it('is disabled for a provider without a client id, and verifies nothing for it', async () => {
    const factory = vi.fn<KeySetFactory>(() => keySet);
    const appleOnly = verifier({ google: [] }, factory);

    expect(appleOnly.isEnabled('GOOGLE')).toBe(false);
    expect(appleOnly.isEnabled('APPLE')).toBe(true);
    expect(await rejection(appleOnly.verify('GOOGLE', await token('GOOGLE'), NONCE))).toBe(
      'audience',
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it('creates each key set lazily, once per provider', async () => {
    const factory = vi.fn<KeySetFactory>(() => keySet);
    const lazy = verifier({}, factory);
    expect(factory).not.toHaveBeenCalled();

    await lazy.verify('GOOGLE', await token('GOOGLE'), NONCE);
    await lazy.verify('GOOGLE', await token('GOOGLE'), NONCE);
    await lazy.verify('APPLE', await token('APPLE'), NONCE);

    expect(factory.mock.calls).toEqual([['GOOGLE'], ['APPLE']]);
  });
});

describe('claim helpers', () => {
  it('compares the nonce exactly', () => {
    expect(nonceClaimMatches('GOOGLE', NONCE, NONCE)).toBe(true);
    expect(nonceClaimMatches('GOOGLE', `${NONCE} `, NONCE)).toBe(false);
    expect(nonceClaimMatches('GOOGLE', 42, NONCE)).toBe(false);
    expect(nonceClaimMatches('APPLE', '', NONCE)).toBe(false);
  });

  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
    ['TRUE', false],
    [1, false],
    [undefined, false],
  ])('email_verified %j is %s', (value, expected) => {
    expect(isEmailVerifiedClaim(value)).toBe(expected);
  });
});
