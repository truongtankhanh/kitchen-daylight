import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { ApiError } from '../errors/api-error.js';
import type { GuardedRequest, RequestUser } from './request-user.js';

/**
 * The request user set by `AuthGuard`. Without one (a `@Public()` handler, or a guard missing) it
 * fails closed with `401 UNAUTHENTICATED` rather than handing `undefined` to the handler.
 */
export function currentUserOf(context: ExecutionContext): RequestUser {
  const user = context.switchToHttp().getRequest<GuardedRequest>().user;
  if (user === undefined) {
    throw new ApiError('UNAUTHENTICATED');
  }
  return user;
}

/** `@CurrentUser() user: RequestUser`: the acting user, from the access token only. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  currentUserOf(context),
);
