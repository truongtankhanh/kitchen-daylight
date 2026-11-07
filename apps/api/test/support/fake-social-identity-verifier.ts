import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey, JWTPayload, JWTVerifyGetKey } from 'jose';

import type { AuthProvider } from '../../src/modules/auth/entities/auth-identity.entity.js';
import {
  JoseSocialIdentityVerifier,
  SOCIAL_PROVIDER_SETTINGS,
} from '../../src/modules/auth/social/jose-social-identity-verifier.js';
import type {
  SocialIdentityVerifier,
  VerifiedSocialIdentity,
} from '../../src/modules/auth/social/social-identity-verifier.js';

/** Fictional client ids of the test app; never real ones. */
export const FAKE_GOOGLE_CLIENT_ID = '0000-kd-test.apps.googleusercontent.com';
export const FAKE_APPLE_CLIENT_ID = 'com.example.kitchendaylight.test';

const KEY_ID = 'kd-test-social';

export interface FakeTokenOptions {
  readonly subject: string;
  readonly nonce: string;
  readonly email?: string | null;
  readonly emailVerified?: boolean | 'true' | 'false';
  readonly name?: string;
  /** Defaults to our client id of the provider. */
  readonly audience?: string;
  /** Seconds since the epoch; defaults to ten minutes from now. */
  readonly expiresAt?: number;
}

/**
 * Test double of `SocialIdentityVerifier` (A2-T6), bound only through the test module's provider
 * override (`createTestApp({ providers: [...] })`), never by `AppModule`, a factory or a variable;
 * `src/` never imports it (`social-identity-verifier.spec.ts`).
 *
 * It is the real `JoseSocialIdentityVerifier` with a local key set (`createLocalJWKSet`) instead of
 * the providers' remote JWKS: the signature, `iss`, `aud`, `exp` and nonce checks are the production
 * ones, without the network. `token()` signs ID tokens with a key pair generated per instance.
 */
export class FakeSocialIdentityVerifier implements SocialIdentityVerifier {
  private constructor(
    private readonly inner: JoseSocialIdentityVerifier,
    private readonly signingKey: CryptoKey,
  ) {}

  static async create(
    clientIds: { readonly google?: readonly string[]; readonly apple?: readonly string[] } = {},
  ): Promise<FakeSocialIdentityVerifier> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    const keySet: JWTVerifyGetKey = createLocalJWKSet({
      keys: [{ ...jwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });
    const inner = new JoseSocialIdentityVerifier(
      {
        googleClientIds: clientIds.google ?? [FAKE_GOOGLE_CLIENT_ID],
        appleClientIds: clientIds.apple ?? [FAKE_APPLE_CLIENT_ID],
      },
      () => keySet,
    );
    return new FakeSocialIdentityVerifier(inner, privateKey);
  }

  isEnabled(provider: AuthProvider): boolean {
    return this.inner.isEnabled(provider);
  }

  verify(
    provider: AuthProvider,
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedSocialIdentity> {
    return this.inner.verify(provider, idToken, expectedNonce);
  }

  /** A signed ID token as the provider would issue it. */
  token(provider: AuthProvider, options: FakeTokenOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: JWTPayload = { nonce: options.nonce };
    if (options.email !== null) {
      claims['email'] = options.email ?? 'fixture-social@kd.example';
      claims['email_verified'] = options.emailVerified ?? true;
    }
    if (options.name !== undefined) {
      claims['name'] = options.name;
    }
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setIssuer(SOCIAL_PROVIDER_SETTINGS[provider].issuers[0] as string)
      .setAudience(
        options.audience ?? (provider === 'GOOGLE' ? FAKE_GOOGLE_CLIENT_ID : FAKE_APPLE_CLIENT_ID),
      )
      .setSubject(options.subject)
      .setIssuedAt(now - 60)
      .setExpirationTime(options.expiresAt ?? now + 600)
      .sign(this.signingKey);
  }
}
