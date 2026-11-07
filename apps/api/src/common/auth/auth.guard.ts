import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccessTokenService } from '../../modules/auth/access-token.service.js';
import type { VerifiedAccessToken } from '../../modules/auth/access-token.service.js';
import { ApiError } from '../errors/api-error.js';
import { isPublicRoute } from './public.decorator.js';
import type { GuardedRequest } from './request-user.js';

/** `Bearer` (any case, RFC 9110 section 11.1), spaces, then one RFC 6750 `b64token`. */
const BEARER_PATTERN = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/**
 * The `WWW-Authenticate` challenge of a `401` from this guard (RFC 9110 section 15.5.2: a `401`
 * carries one; RFC 6750 section 3). No error code without credentials; `invalid_request` for a
 * header that is not `Bearer <token>`; `invalid_token` for a refused token, expired or not, so the
 * header says no more than the problem `code` already does.
 */
export const BEARER_CHALLENGE = {
  missing: 'Bearer',
  malformed: 'Bearer error="invalid_request"',
  refused: 'Bearer error="invalid_token"',
} as const;

/** The part of the HTTP response the guard writes: the challenge header. */
interface ChallengeResponse {
  setHeader(name: string, value: string): unknown;
}

/** The token of a well-formed `Authorization: Bearer` header, otherwise `undefined`. */
export function bearerTokenOf(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  return BEARER_PATTERN.exec(header)?.[1];
}

/**
 * Global guard, deny by default (ADR-0003 "Authorization"; foundation.md section 5): a handler
 * without `@Public()` needs a valid access token. The token is verified by `AccessTokenService`
 * alone, with no database read (ADR-0003; A1-T6), so a role change reaches the guard only when the
 * token expires; sensitive endpoints re-read the role themselves (A3-T6).
 *
 * - No header, or not `Bearer <token>`: `401 UNAUTHENTICATED`.
 * - Expired but authentic token: `401 TOKEN_EXPIRED` (the admin web refreshes once on it).
 * - Any other bad token: `401 UNAUTHENTICATED`, with no hint of the cause.
 * - Valid: the request user `{ id, role, sessionId }` is set from the token's `sub`, `role` and
 *   `sid`.
 *
 * Every `401` from this guard on HTTP carries `WWW-Authenticate` (`BEARER_CHALLENGE`).
 *
 * Registered after the throttler and before `RolesGuard` (`AppModule`); guards run before pipes,
 * so a protected route answers `401` before its body is validated. A non-HTTP context (the
 * realtime gateway) is refused here until its own slice authenticates it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }
    if (context.getType() !== 'http') {
      throw new ApiError('UNAUTHENTICATED');
    }

    const http = context.switchToHttp();
    const request = http.getRequest<GuardedRequest>();
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

    let verified: VerifiedAccessToken;
    try {
      verified = await this.tokens.verify(token);
    } catch (error) {
      response.setHeader('WWW-Authenticate', BEARER_CHALLENGE.refused);
      throw error;
    }
    request.user = Object.freeze({
      id: verified.userId,
      role: verified.role,
      sessionId: verified.sessionId,
    });
    return true;
  }
}
