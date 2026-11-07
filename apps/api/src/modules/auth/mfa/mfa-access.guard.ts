import { createParamDecorator, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { decodeProtectedHeader } from 'jose';

import { BEARER_CHALLENGE, bearerTokenOf } from '../../../common/auth/auth.guard.js';
import type { GuardedRequest } from '../../../common/auth/request-user.js';
import { MANAGER_ROLES } from '../../../common/auth/roles.decorator.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { Clock } from '../../../common/time/clock.js';
import { AccessTokenService } from '../access-token.service.js';
import type { VerifiedAccessToken } from '../access-token.service.js';
import { KeySet } from '../key-set.js';
import { MFA_ENROLMENT_TOKEN_TYPE, verifyMfaToken } from './mfa-tokens.js';

/**
 * Who calls `/me/mfa/setup` or `/me/mfa/confirm`: a signed-in `MANAGER` or `ADMIN` (`session`), or
 * a `MANAGER` or `ADMIN` between password and enrolment (`enrolment`, decision 0008 section 8).
 */
export interface MfaSubject {
  readonly userId: string;
  readonly via: 'session' | 'enrolment';
}

interface MfaGuardedRequest extends GuardedRequest {
  mfaSubject?: MfaSubject;
}

/** The part of the HTTP response the guard writes: the challenge header. */
interface ChallengeResponse {
  setHeader(name: string, value: string): unknown;
}

const MFA_ROLE_SET: ReadonlySet<string> = new Set(MANAGER_ROLES);

function typeOf(token: string): unknown {
  try {
    return decodeProtectedHeader(token).typ;
  } catch {
    return undefined;
  }
}

/**
 * Authentication of the two routes that also accept the enrolment token. They are `@Public()` for
 * the global `AuthGuard`, which accepts access tokens only; this guard takes its place and answers
 * like it: `401 UNAUTHENTICATED` with the `WWW-Authenticate` challenge for no or a bad token,
 * `TOKEN_EXPIRED` for an expired access token.
 * - `typ: mfa-enrol+jwt`: verified by `verifyMfaToken` (signature, `iss`, `aud`, `exp`).
 * - anything else: verified as an access token by `AccessTokenService`; a role other than `MANAGER`
 *   or `ADMIN` is `403 FORBIDDEN` (`STAFF` cannot enrol, api-outline open item 2).
 * The account itself (status, fresh role) is checked by `MfaService.requireMfaUser`.
 */
@Injectable()
export class MfaAccessGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(KeySet) private readonly keys: KeySet,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<MfaGuardedRequest>();
    const response = http.getResponse<ChallengeResponse>();
    const header = request.headers.authorization;
    const token = bearerTokenOf(header);
    if (token === undefined) {
      response.setHeader(
        'WWW-Authenticate',
        header === undefined ? BEARER_CHALLENGE.missing : BEARER_CHALLENGE.malformed,
      );
      throw new ApiError('UNAUTHENTICATED');
    }

    if (typeOf(token) === MFA_ENROLMENT_TOKEN_TYPE) {
      const userId = await verifyMfaToken(
        this.keys,
        this.clock.now(),
        token,
        MFA_ENROLMENT_TOKEN_TYPE,
      );
      if (userId === null) {
        response.setHeader('WWW-Authenticate', BEARER_CHALLENGE.refused);
        throw new ApiError('UNAUTHENTICATED');
      }
      request.mfaSubject = Object.freeze({ userId, via: 'enrolment' });
      return true;
    }

    let verified: VerifiedAccessToken;
    try {
      verified = await this.accessTokens.verify(token);
    } catch (error) {
      response.setHeader('WWW-Authenticate', BEARER_CHALLENGE.refused);
      throw error;
    }
    if (!MFA_ROLE_SET.has(verified.role)) {
      throw new ApiError('FORBIDDEN');
    }
    request.mfaSubject = Object.freeze({ userId: verified.userId, via: 'session' });
    return true;
  }
}

/** `@CurrentMfaSubject() subject: MfaSubject`, set by `MfaAccessGuard`; fails closed without it. */
export const CurrentMfaSubject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MfaSubject => {
    const subject = context.switchToHttp().getRequest<MfaGuardedRequest>().mfaSubject;
    if (subject === undefined) {
      throw new ApiError('UNAUTHENTICATED');
    }
    return subject;
  },
);
