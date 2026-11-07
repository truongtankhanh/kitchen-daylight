import { jwtVerify, SignJWT } from 'jose';

import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
  ACCESS_TOKEN_ISSUER,
} from '../access-token.service.js';
import { ACCESS_TOKEN_ALGORITHM } from '../key-set.js';
import type { KeySet } from '../key-set.js';

/**
 * The two short-lived tokens a `MANAGER` or `ADMIN` receives with `MFA_REQUIRED` after a correct
 * password. Signed like the access token (ES256, `kid`, `iss`, `aud`) with claims `sub`, `iat`,
 * `exp` only: no `role`, no `sid`. The access-token verifier refuses both by their `typ`.
 * - challenge (api-divergences D-076): an enrolled user; `POST /admin/auth/mfa/verify`.
 * - enrolment (decision 0008 section 8): no `enabled_at` yet; `/me/mfa/setup` and `/confirm`.
 */
export const MFA_CHALLENGE_TOKEN_TYPE = 'mfa-challenge+jwt';
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
export const MFA_ENROLMENT_TOKEN_TYPE = 'mfa-enrol+jwt';
export const MFA_ENROLMENT_TTL_SECONDS = 10 * 60;

export type MfaTokenType = typeof MFA_CHALLENGE_TOKEN_TYPE | typeof MFA_ENROLMENT_TOKEN_TYPE;

const TTL_SECONDS: Readonly<Record<MfaTokenType, number>> = {
  [MFA_CHALLENGE_TOKEN_TYPE]: MFA_CHALLENGE_TTL_SECONDS,
  [MFA_ENROLMENT_TOKEN_TYPE]: MFA_ENROLMENT_TTL_SECONDS,
};

export interface SignedMfaToken {
  readonly token: string;
  /** Seconds until the token expires. */
  readonly expiresIn: number;
}

/** Signs an MFA token of `type` for `userId`, valid from `now`. The token is never logged. */
export async function signMfaToken(
  keys: KeySet,
  now: Date,
  type: MfaTokenType,
  userId: string,
): Promise<SignedMfaToken> {
  const { keyId, key } = keys.signingKey();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresIn = TTL_SECONDS[type];
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, kid: keyId, typ: type })
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + expiresIn)
    .sign(key);
  return { token, expiresIn };
}

/**
 * The user id of an authentic, unexpired MFA token of exactly `type`, else `null` (malformed,
 * unknown `kid`, bad signature, another `typ`, an access token, expired). The caller answers
 * without saying which check failed.
 */
export async function verifyMfaToken(
  keys: KeySet,
  now: Date,
  token: string,
  type: MfaTokenType,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      (header) => {
        const key = header.kid === undefined ? undefined : keys.verificationKey(header.kid);
        if (key === undefined) {
          throw new Error('Unknown key id.');
        }
        return key;
      },
      {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        typ: type,
        requiredClaims: ['sub', 'iat', 'exp'],
        clockTolerance: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
      },
    );
    return typeof payload.sub === 'string' && payload.sub !== '' ? payload.sub : null;
  } catch {
    return null;
  }
}
