import type { ExecutionContext } from '@nestjs/common';
import { hours, minutes } from '@nestjs/throttler';

import { isUnderPrefix, routePathOf } from '../auth/request-user.js';
import type { GuardedRequest } from '../auth/request-user.js';

/** The two named throttlers of decision 0007 section 5. */
export const THROTTLER_NAMES = ['default', 'auth'] as const;
export type ThrottlerName = (typeof THROTTLER_NAMES)[number];

/**
 * One per-IP counter: its throttler, its figures (decision 0008 section 7) and its `name`, which
 * keys the counter. Routes of one group share the profile and therefore one counter per client.
 * `ttl` is in milliseconds; `blockDuration` equals `ttl` (0008: "unless stated", nothing stated).
 */
export interface ThrottleProfile {
  readonly name: string;
  readonly throttler: ThrottlerName;
  readonly limit: number;
  readonly ttl: number;
}

function profile(
  name: string,
  throttler: ThrottlerName,
  limit: number,
  ttl: number,
): ThrottleProfile {
  return Object.freeze({ name, throttler, limit, ttl });
}

/** "Everything else": 600 per minute per client, across all routes. */
export const DEFAULT_PROFILE = profile('default', 'default', 600, minutes(1));

// Strict groups of decision 0008 section 7, all on the `auth` throttler.
export const CUSTOMER_SIGN_IN_PROFILE = profile('customer-sign-in', 'auth', 20, minutes(5));
export const STAFF_SIGN_IN_PROFILE = profile('staff-sign-in', 'auth', 10, minutes(5));
export const REGISTER_PROFILE = profile('register', 'auth', 10, hours(1));
export const SEND_MAIL_PROFILE = profile('send-mail', 'auth', 5, minutes(15));
export const VERIFY_PROFILE = profile('verify', 'auth', 10, minutes(15));
export const REFRESH_PROFILE = profile('refresh', 'auth', 60, minutes(5));
export const SIGN_OUT_PROFILE = profile('sign-out', 'auth', 30, minutes(5));
export const MFA_PROFILE = profile('mfa', 'auth', 10, minutes(5));

/**
 * A route under `/api/v1/auth/` or `/api/v1/admin/auth/` that the table below does not list takes
 * the strictest figure of 0008 (5 per 15 minutes): a new auth route is protected from its first
 * request, and loosening it is a visible change to this table. One counter per prefix.
 */
export const UNLISTED_AUTH_PROFILE = profile('auth-unlisted', 'auth', 5, minutes(15));
export const UNLISTED_ADMIN_AUTH_PROFILE = profile('admin-auth-unlisted', 'auth', 5, minutes(15));

/** Route groups of decision 0008 section 7, by registered route path (lower case). */
const STRICT_ROUTES: ReadonlyMap<string, ThrottleProfile> = new Map([
  ['/api/v1/auth/login', CUSTOMER_SIGN_IN_PROFILE],
  ['/api/v1/auth/social/google', CUSTOMER_SIGN_IN_PROFILE],
  ['/api/v1/auth/social/apple', CUSTOMER_SIGN_IN_PROFILE],
  // A2-T6: linking and unlinking verify a provider token like a sign-in (api-divergences D-070).
  ['/api/v1/me/identities/:provider', CUSTOMER_SIGN_IN_PROFILE],
  ['/api/v1/admin/auth/login', STAFF_SIGN_IN_PROFILE],
  ['/api/v1/admin/auth/mfa/verify', STAFF_SIGN_IN_PROFILE],
  ['/api/v1/admin/auth/step-up', STAFF_SIGN_IN_PROFILE],
  ['/api/v1/auth/register', REGISTER_PROFILE],
  ['/api/v1/auth/email/send-code', SEND_MAIL_PROFILE],
  ['/api/v1/auth/password/forgot', SEND_MAIL_PROFILE],
  ['/api/v1/admin/auth/password/forgot', SEND_MAIL_PROFILE],
  ['/api/v1/auth/email/verify', VERIFY_PROFILE],
  ['/api/v1/auth/password/reset', VERIFY_PROFILE],
  ['/api/v1/admin/auth/password/set', VERIFY_PROFILE],
  ['/api/v1/auth/refresh', REFRESH_PROFILE],
  ['/api/v1/admin/auth/refresh', REFRESH_PROFILE],
  ['/api/v1/auth/logout', SIGN_OUT_PROFILE],
  ['/api/v1/auth/logout-all', SIGN_OUT_PROFILE],
  ['/api/v1/admin/auth/logout', SIGN_OUT_PROFILE],
  ['/api/v1/auth/social/nonce', SIGN_OUT_PROFILE],
]);

/**
 * The strict prefixes, chosen by URL so that a new route below them inherits the `auth`
 * throttler without a decorator. `/api/v1/me/mfa/` is listed by 0008 section 7 (`/me/mfa/*`,
 * 10 per 5 minutes); the other two take their "unlisted" profile for a route not in the table.
 */
export const STRICT_PREFIXES: ReadonlyMap<string, ThrottleProfile> = new Map([
  ['/api/v1/auth/', UNLISTED_AUTH_PROFILE],
  ['/api/v1/admin/auth/', UNLISTED_ADMIN_AUTH_PROFILE],
  ['/api/v1/me/mfa/', MFA_PROFILE],
]);

/** The profile of a registered route path (see `routePathOf`): table, then prefix, then default. */
export function selectThrottleProfile(routePath: string): ThrottleProfile {
  const path = routePath.toLowerCase().replace(/\/+$/, '');
  const listed = STRICT_ROUTES.get(path);
  if (listed !== undefined) {
    return listed;
  }
  for (const [prefix, strict] of STRICT_PREFIXES) {
    if (isUnderPrefix(path, prefix)) {
      return strict;
    }
  }
  return DEFAULT_PROFILE;
}

/** The profile of the route being handled. */
export function throttleProfileOf(context: ExecutionContext): ThrottleProfile {
  return selectThrottleProfile(routePathOf(context.switchToHttp().getRequest<GuardedRequest>()));
}
