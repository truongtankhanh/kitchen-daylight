import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';

import type { UserRole, UserStatus } from '../../modules/users/entities/user.entity.js';
import { BEARER_CHALLENGE } from '../auth/auth.guard.js';
import type { GuardedRequest } from '../auth/request-user.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { ApiError } from '../errors/api-error.js';

export const SENSITIVE_KEY = 'kd:auth:sensitive';

/** The stored role and status of the request user, read on every sensitive request. */
export const FRESH_ROLE_SQL = `SELECT role::text AS role, status::text AS status
  FROM public.users
 WHERE id = $1`;

interface FreshRoleRow {
  readonly role: UserRole;
  readonly status: UserStatus;
}

/** The part of the HTTP response the guard writes: the challenge header of a `401`. */
interface ChallengeResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * The fresh-role check of `@Sensitive()` (ADR-0003 "Identity and tokens": a role change or account
 * disable takes effect after the access-token TTL at most; sensitive admin endpoints re-read the
 * role; A3-T6). Runs after the global guards, so the token was verified and the token's role passed
 * `@Roles`. Then `role` and `status` are read from `users` for this request:
 *
 * - no row, or a status other than `ACTIVE` (suspended, deleted, invited): `401 UNAUTHENTICATED`
 *   with the `invalid_token` challenge, so the admin web returns to the sign-in page;
 * - a stored role outside the route's `@Roles` (a demotion since the token was issued):
 *   `403 FORBIDDEN`;
 * - otherwise the request goes on. A promotion since the token was issued grants nothing more: the
 *   token's role already passed `@Roles`.
 */
@Injectable()
export class FreshRoleGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DataSource) private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(SENSITIVE_KEY, targets) !== true) {
      return true;
    }
    const http = context.switchToHttp();
    const user = http.getRequest<GuardedRequest>().user;
    if (user === undefined) {
      // Only reachable without `AuthGuard` (a `@Public()` route): fail closed.
      throw new ApiError('UNAUTHENTICATED');
    }

    const rows = await this.dataSource.query<FreshRoleRow[]>(FRESH_ROLE_SQL, [user.id]);
    const stored = rows[0];
    if (stored === undefined || stored.status !== 'ACTIVE') {
      http.getResponse<ChallengeResponse>().setHeader('WWW-Authenticate', BEARER_CHALLENGE.refused);
      throw new ApiError('UNAUTHENTICATED');
    }
    const roles = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (roles !== undefined && !roles.includes(stored.role)) {
      throw new ApiError('FORBIDDEN');
    }
    return true;
  }
}
