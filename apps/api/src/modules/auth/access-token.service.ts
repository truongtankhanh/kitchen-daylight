import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';

import { ApiError } from '../../common/errors/api-error.js';
import { Clock } from '../../common/time/clock.js';
import { USER_ROLES } from '../users/entities/user.entity.js';
import type { UserRole } from '../users/entities/user.entity.js';
import { ACCESS_TOKEN_ALGORITHM, KeySet } from './key-set.js';

/** Access-token lifetime for both clients (decision 0008 section 1). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** `iss` and `aud` of every access token (decision 0008 section 9). */
export const ACCESS_TOKEN_ISSUER = 'kd-api';
export const ACCESS_TOKEN_AUDIENCE = 'kd-api';

/** `typ` header, checked on verification so no other JWT passes as an access token. */
export const ACCESS_TOKEN_TYPE = 'at+jwt';

/** Tolerance on `exp` (and `nbf`), for a future second host's clock (decision 0008 section 9). */
export const ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS = 5;

export interface AccessTokenSubject {
  readonly userId: string;
  readonly role: UserRole;
  /** The refresh-token family id (`sid`). */
  readonly sessionId: string;
}

export interface SignedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface VerifiedAccessToken extends AccessTokenSubject {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

const ROLES: ReadonlySet<string> = new Set(USER_ROLES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function unauthenticated(): ApiError {
  // No detail: the response never says which check failed.
  return new ApiError('UNAUTHENTICATED');
}

/**
 * Signs and verifies access tokens (decision 0008 section 9): ES256 with the `kid` header,
 * `typ: at+jwt`, claims `iss`, `aud`, `sub`, `role`, `sid`, `iat`, `exp`, no `jti`. Time comes from
 * the injected `Clock`. The token is never logged.
 */
@Injectable()
export class AccessTokenService {
  constructor(
    @Inject(KeySet) private readonly keys: KeySet,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async sign(subject: AccessTokenSubject): Promise<SignedAccessToken> {
    const { keyId, key } = this.keys.signingKey();
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAt = issuedAt + ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ role: subject.role, sid: subject.sessionId })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, kid: keyId, typ: ACCESS_TOKEN_TYPE })
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(subject.userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  /**
   * Accepts only an ES256 token of a known `kid` with a valid signature, `typ`, `iss`, `aud` and
   * `exp` (5 s tolerance). An expired but otherwise valid token is `TOKEN_EXPIRED`; anything else
   * (malformed, `alg: none`, unknown `kid`, wrong key, audience or claims) is `UNAUTHENTICATED`
   * with no hint of the cause.
   */
  async verify(token: string): Promise<VerifiedAccessToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid === undefined ? undefined : this.keys.verificationKey(header.kid);
          if (key === undefined) {
            throw unauthenticated();
          }
          return key;
        },
        {
          algorithms: [ACCESS_TOKEN_ALGORITHM],
          issuer: ACCESS_TOKEN_ISSUER,
          audience: ACCESS_TOKEN_AUDIENCE,
          typ: ACCESS_TOKEN_TYPE,
          requiredClaims: ['sub', 'role', 'sid', 'iat', 'exp'],
          clockTolerance: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
          currentDate: this.clock.now(),
        },
      ));
    } catch (error) {
      // jose checks the claims only after the signature, so an expired token here is authentic.
      if ((error as { code?: unknown } | null)?.code === 'ERR_JWT_EXPIRED') {
        throw new ApiError('TOKEN_EXPIRED');
      }
      throw unauthenticated();
    }

    const { sub, role, sid, iat, exp } = payload;
    if (
      !isNonEmptyString(sub) ||
      !isNonEmptyString(sid) ||
      typeof role !== 'string' ||
      !ROLES.has(role) ||
      typeof iat !== 'number' ||
      typeof exp !== 'number'
    ) {
      throw unauthenticated();
    }
    return {
      userId: sub,
      role: role as UserRole,
      sessionId: sid,
      issuedAt: new Date(iat * 1000),
      expiresAt: new Date(exp * 1000),
    };
  }
}
