import type { IncomingHttpHeaders } from 'node:http';

import type { UserRole } from '../../modules/users/entities/user.entity.js';

/**
 * The acting user of a request. It comes only from the verified access token (ADR-0003,
 * "Ownership"), never from the body, the path or the query; `AuthGuard` sets it and
 * `@CurrentUser()` reads it.
 */
export interface RequestUser {
  readonly id: string;
  readonly role: UserRole;
  /**
   * The refresh-token family the access token was issued for (claim `sid`, decision 0008): the
   * current session, kept by `POST /me/password` and marked in `GET /me/sessions` (A2-T4).
   */
  readonly sessionId: string;
}

/** The parts of an Express request that the guards read (and, for `user`, write). */
export interface GuardedRequest {
  readonly headers: IncomingHttpHeaders;
  /** Set by Express on the matched route: `path` is the registered pattern, not the raw URL. */
  readonly route?: { readonly path?: unknown };
  readonly path?: string;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
  user?: RequestUser;
}

/** Feature routes under `/api/v1/admin` are staff routes (decision 0005, section 6). */
export const ADMIN_ROUTE_PREFIX = '/api/v1/admin/';

/**
 * The route as Express matched it, in lower case. The registered pattern (`req.route.path`, for
 * example `/api/v1/admin/orders/:id`) is used rather than the request path, because Express
 * routes without regard to case or a trailing slash: `/API/V1/Admin/Orders/` reaches the same
 * handler, and a check on the raw path could be bypassed that way. The request path is the
 * fallback only when no route was matched.
 */
export function routePathOf(request: Pick<GuardedRequest, 'route' | 'path'>): string {
  const pattern = request.route?.path;
  const path = typeof pattern === 'string' ? pattern : (request.path ?? '');
  return path.toLowerCase();
}

/** True when `prefix` (ending in `/`) is the route itself or one of its parents. */
export function isUnderPrefix(routePath: string, prefix: string): boolean {
  const probe = routePath.endsWith('/') ? routePath : `${routePath}/`;
  return probe.startsWith(prefix);
}

/** True for `/api/v1/admin` and every route below it. */
export function isAdminRoute(routePath: string): boolean {
  return isUnderPrefix(routePath, ADMIN_ROUTE_PREFIX);
}
