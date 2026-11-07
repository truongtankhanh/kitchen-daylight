import { createHash, timingSafeEqual } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';

import type { AuthProvider } from '../entities/auth-identity.entity.js';
import { SocialTokenRejectedError } from './social-identity-verifier.js';
import type {
  SocialIdentityVerifier,
  SocialTokenRejection,
  VerifiedSocialIdentity,
} from './social-identity-verifier.js';

/**
 * Provider constants (decision 0008 section 11: constants in code, not variables). Re-read for
 * A2-T6 on 2026-11-07:
 *
 * - Google, https://developers.google.com/identity/gsi/web/guides/verify-google-id-token: "The value
 *   of `iss` in the ID token is equal to `accounts.google.com` or `https://accounts.google.com`";
 *   "The value of `aud` in the ID token is equal to one of your app's client IDs"; "The expiry time
 *   (`exp`) of the ID token has not passed"; keys in JWK form at
 *   https://www.googleapis.com/oauth2/v3/certs. https://accounts.google.com/.well-known/openid-configuration
 *   lists `id_token_signing_alg_values_supported` `["RS256"]`.
 * - Google nonce, https://developers.google.com/identity/openid-connect/openid-connect: the `nonce`
 *   claim is "The value of the `nonce` supplied by your app in the authentication request", not
 *   hashed; https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
 *   (`setNonce()`): "Ensure that your server-side code validates that the request and response
 *   nonces are identical". So Google's claim must equal our nonce exactly.
 * - Apple, https://developer.apple.com/documentation/signinwithapple/verifying-a-user: "Verify the
 *   `nonce` for the authentication", "Verify that the `iss` field contains
 *   `https://appleid.apple.com`", "Verify that the `aud` field is the developer's `client_id`",
 *   "Verify that the time is earlier than the `exp` value". https://appleid.apple.com/.well-known/openid-configuration:
 *   `jwks_uri` https://appleid.apple.com/auth/keys, `id_token_signing_alg_values_supported`
 *   `["RS256"]` (the docs page says "E256", which the discovery list does not contain; RS256 kept,
 *   decision 0008 section 11).
 * - Apple nonce: Apple's pages do not say how the claim is formed (`ASAuthorizationOpenIDRequest.nonce`:
 *   "A string value to pass to the identity provider"). Apple copies the request value into the
 *   token; the common client convention hashes it first (Firebase, https://firebase.google.com/docs/auth/ios/apple:
 *   "You will send the SHA256 hash of the nonce with your sign-in request, which Apple will pass
 *   unchanged in the response"). So Apple's claim may equal our nonce or the lowercase hex SHA-256
 *   of it; both are accepted. Which one the Expo app sends is for the mobile slice to confirm
 *   (decision 0008 section 11, "not verified").
 */
export const SOCIAL_PROVIDER_SETTINGS: Readonly<
  Record<
    AuthProvider,
    {
      readonly issuers: readonly string[];
      readonly jwksUri: string;
      readonly algorithms: readonly string[];
      /** Whether the `nonce` claim may be the hex SHA-256 of the nonce we issued. */
      readonly acceptsHashedNonce: boolean;
    }
  >
> = {
  GOOGLE: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    algorithms: ['RS256'],
    acceptsHashedNonce: false,
  },
  APPLE: {
    issuers: ['https://appleid.apple.com'],
    jwksUri: 'https://appleid.apple.com/auth/keys',
    algorithms: ['RS256'],
    acceptsHashedNonce: true,
  },
};

/** Provider clocks may run ahead or behind (decision 0008 section 11). */
export const SOCIAL_CLOCK_TOLERANCE_SECONDS = 30;

/** `createRemoteJWKSet` options (decision 0008 section 11; jose defaults stated explicitly). */
const REMOTE_JWKS_OPTIONS = {
  cacheMaxAge: 10 * 60_000,
  cooldownDuration: 30_000,
  timeoutDuration: 5_000,
} as const;

export interface SocialClientIds {
  readonly googleClientIds: readonly string[];
  readonly appleClientIds: readonly string[];
}

/** Builds the key resolver of a provider; called once per provider, at its first verification. */
export type KeySetFactory = (provider: AuthProvider) => JWTVerifyGetKey;

/** The default: the provider's remote JWKS (network on first use, never at import or start-up). */
export const remoteKeySetFactory: KeySetFactory = (provider) =>
  createRemoteJWKSet(new URL(SOCIAL_PROVIDER_SETTINGS[provider].jwksUri), REMOTE_JWKS_OPTIONS);

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether the token's `nonce` claim matches the nonce we issued, by the provider's rule. */
export function nonceClaimMatches(
  provider: AuthProvider,
  claim: unknown,
  expectedNonce: string,
): boolean {
  if (typeof claim !== 'string' || claim === '') {
    return false;
  }
  if (sameText(claim, expectedNonce)) {
    return true;
  }
  return (
    SOCIAL_PROVIDER_SETTINGS[provider].acceptsHashedNonce &&
    sameText(claim.toLowerCase(), createHash('sha256').update(expectedNonce).digest('hex'))
  );
}

/** `email_verified` may come as a boolean or a string (decision 0008 section 11). */
export function isEmailVerifiedClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

/** The identity of a payload whose signature and registered claims jose already checked. */
export function identityOf(
  provider: AuthProvider,
  payload: JWTPayload,
  expectedNonce: string,
): VerifiedSocialIdentity {
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new SocialTokenRejectedError('claims');
  }
  if (!nonceClaimMatches(provider, payload['nonce'], expectedNonce)) {
    throw new SocialTokenRejectedError('nonce');
  }
  const rawEmail = payload['email'];
  const email = typeof rawEmail === 'string' && rawEmail.trim() !== '' ? rawEmail.trim() : null;
  const rawName = payload['name'];
  const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : null;
  return {
    provider,
    subject: payload.sub,
    email,
    emailVerified: email !== null && isEmailVerifiedClaim(payload['email_verified']),
    name,
  };
}

/** Maps a jose error to a log reason; unknown errors are not token problems and are rethrown. */
export function rejectionOf(error: unknown): SocialTokenRejection | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      const claim = (error as { claim?: unknown }).claim;
      return claim === 'iss' ? 'issuer' : claim === 'aud' ? 'audience' : 'claims';
    }
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'signature';
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
    case 'ERR_JOSE_NOT_SUPPORTED':
      return 'malformed';
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JWKS_INVALID':
      return 'keys_unavailable';
    default:
      return undefined;
  }
}

/**
 * The real `SocialIdentityVerifier` (A2-T6): `jose` `jwtVerify` against the provider's JWKS, with
 * the issuer, algorithm and `aud` allow-lists, `exp` (30 s tolerance) and our nonce. The key set of
 * each provider is created at its first verification, never at import time or start-up (no I/O at
 * import time, decision 0004 section 1). Logs nothing: the caller logs the reason, never the token,
 * a claim or the email.
 */
export class JoseSocialIdentityVerifier implements SocialIdentityVerifier {
  private readonly keySets = new Map<AuthProvider, JWTVerifyGetKey>();

  constructor(
    private readonly clientIds: SocialClientIds,
    private readonly keySetFactory: KeySetFactory = remoteKeySetFactory,
  ) {}

  isEnabled(provider: AuthProvider): boolean {
    return this.audiencesOf(provider).length > 0;
  }

  async verify(
    provider: AuthProvider,
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedSocialIdentity> {
    const audiences = this.audiencesOf(provider);
    if (audiences.length === 0) {
      // The service checks `isEnabled` first; refusing here keeps a disabled provider closed.
      throw new SocialTokenRejectedError('audience');
    }
    const settings = SOCIAL_PROVIDER_SETTINGS[provider];
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keySetOf(provider), {
        issuer: [...settings.issuers],
        audience: [...audiences],
        algorithms: [...settings.algorithms],
        clockTolerance: SOCIAL_CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      const reason = rejectionOf(error);
      if (reason === undefined) {
        throw error;
      }
      throw new SocialTokenRejectedError(reason);
    }
    return identityOf(provider, payload, expectedNonce);
  }

  private audiencesOf(provider: AuthProvider): readonly string[] {
    return provider === 'GOOGLE' ? this.clientIds.googleClientIds : this.clientIds.appleClientIds;
  }

  private keySetOf(provider: AuthProvider): JWTVerifyGetKey {
    let keySet = this.keySets.get(provider);
    if (keySet === undefined) {
      keySet = this.keySetFactory(provider);
      this.keySets.set(provider, keySet);
    }
    return keySet;
  }
}
