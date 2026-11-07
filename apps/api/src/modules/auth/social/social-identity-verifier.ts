import type { AuthProvider } from '../entities/auth-identity.entity.js';

/** What a verified Google or Apple ID token says about its holder (A2-T6). */
export interface VerifiedSocialIdentity {
  readonly provider: AuthProvider;
  /** The provider's `sub` claim: the only key accounts link on (ADR-0003). */
  readonly subject: string;
  /** The `email` claim, as sent (an Apple private-relay address is kept as is); `null` when absent. */
  readonly email: string | null;
  /** `email_verified` is `true` or `"true"`; anything else, or no email, is `false`. */
  readonly emailVerified: boolean;
  /** The `name` claim when the token has one (Google with the `profile` scope); Apple never sends it. */
  readonly name: string | null;
}

/** Why a token was refused; for the log line only, never sent to the client. */
export type SocialTokenRejection =
  | 'malformed'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'claims'
  | 'nonce'
  | 'keys_unavailable';

/** The ID token failed verification. Carries a reason, never the token or a claim value. */
export class SocialTokenRejectedError extends Error {
  constructor(readonly reason: SocialTokenRejection) {
    super(`The ID token was refused (${reason}).`);
    this.name = 'SocialTokenRejectedError';
  }
}

/**
 * Verifies a Google or Apple ID token (ADR-0003 "Social sign-in"; decision 0008 section 11). The
 * application binds `JoseSocialIdentityVerifier` unconditionally; the integration tests replace it
 * through the test module's provider override only (`test/support/`), never through a factory or a
 * variable, so there is no adapter kind and no production-guard step.
 */
export interface SocialIdentityVerifier {
  /** False when the provider has no client id configured: its routes answer `NOT_FOUND`. */
  isEnabled(provider: AuthProvider): boolean;

  /**
   * Checks the signature against the provider's keys, `iss`, `aud` (our client ids), `exp` and
   * that the `nonce` claim matches `expectedNonce`. Throws `SocialTokenRejectedError`.
   */
  verify(
    provider: AuthProvider,
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedSocialIdentity>;
}

/** Injection token of the `SocialIdentityVerifier`. */
export const SOCIAL_IDENTITY_VERIFIER = Symbol('SOCIAL_IDENTITY_VERIFIER');
