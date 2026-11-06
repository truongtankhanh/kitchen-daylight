import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { UserRole } from '../../modules/users/entities/user.entity.js';
import { ApiError } from '../errors/api-error.js';
import { isPublicRoute } from './public.decorator.js';
import { isAdminRoute, routePathOf } from './request-user.js';
import type { GuardedRequest } from './request-user.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Global guard, after `AuthGuard` (`AppModule`). Checks the role of the request user against
 * `@Roles(...)`, the handler's list winning over the controller's:
 *
 * - `@Public()`: nothing to check (no request user).
 * - `@Roles(...)` present: the user's role must be listed, otherwise `403 FORBIDDEN`.
 * - No `@Roles(...)`: any signed-in user (the outline's `customer`), **except** under
 *   `/api/v1/admin/`, where the handler is refused with `403 FORBIDDEN`. A forgotten decorator
 *   thus closes an admin route instead of opening it to customers.
 *
 * The role is the token's (no database read); branch scoping is A3-T5.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const user = request.user;
    if (user === undefined) {
      // Only reachable if `AuthGuard` did not run: fail closed.
      throw new ApiError('UNAUTHENTICATED');
    }

    const roles = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) {
      if (isAdminRoute(routePathOf(request))) {
        throw new ApiError('FORBIDDEN');
      }
      return true;
    }
    if (!roles.includes(user.role)) {
      throw new ApiError('FORBIDDEN');
    }
    return true;
  }
}
