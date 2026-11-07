import { describe, expect, it } from 'vitest';

import { httpContext, requestOn } from '../auth/testing.js';
import {
  CUSTOMER_SIGN_IN_PROFILE,
  DEFAULT_PROFILE,
  MFA_PROFILE,
  REFRESH_PROFILE,
  REGISTER_PROFILE,
  selectThrottleProfile,
  SEND_MAIL_PROFILE,
  SIGN_OUT_PROFILE,
  STAFF_SIGN_IN_PROFILE,
  throttleProfileOf,
  UNLISTED_ADMIN_AUTH_PROFILE,
  UNLISTED_AUTH_PROFILE,
  VERIFY_PROFILE,
} from './throttle-profiles.js';

const MINUTE = 60 * 1000;

describe('throttle figures (decision 0008 section 7)', () => {
  it.each([
    [DEFAULT_PROFILE, 'default', 600, MINUTE],
    [CUSTOMER_SIGN_IN_PROFILE, 'auth', 20, 5 * MINUTE],
    [STAFF_SIGN_IN_PROFILE, 'auth', 10, 5 * MINUTE],
    [REGISTER_PROFILE, 'auth', 10, 60 * MINUTE],
    [SEND_MAIL_PROFILE, 'auth', 5, 15 * MINUTE],
    [VERIFY_PROFILE, 'auth', 10, 15 * MINUTE],
    [REFRESH_PROFILE, 'auth', 60, 5 * MINUTE],
    [SIGN_OUT_PROFILE, 'auth', 30, 5 * MINUTE],
    [MFA_PROFILE, 'auth', 10, 5 * MINUTE],
    [UNLISTED_AUTH_PROFILE, 'auth', 5, 15 * MINUTE],
    [UNLISTED_ADMIN_AUTH_PROFILE, 'auth', 5, 15 * MINUTE],
  ] as const)('%o', (profile, throttler, limit, ttl) => {
    expect({ throttler: profile.throttler, limit: profile.limit, ttl: profile.ttl }).toEqual({
      throttler,
      limit,
      ttl,
    });
  });
});

describe('selectThrottleProfile (by URL prefix)', () => {
  it.each([
    ['/api/v1/auth/login', CUSTOMER_SIGN_IN_PROFILE],
    ['/api/v1/auth/social/google', CUSTOMER_SIGN_IN_PROFILE],
    ['/api/v1/auth/social/apple', CUSTOMER_SIGN_IN_PROFILE],
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
  ])('listed route %s', (path, profile) => {
    expect(selectThrottleProfile(path)).toBe(profile);
  });

  it.each([
    ['/api/v1/auth/new-flow', UNLISTED_AUTH_PROFILE],
    ['/api/v1/auth', UNLISTED_AUTH_PROFILE],
    ['/api/v1/auth/sessions/:id', UNLISTED_AUTH_PROFILE],
    ['/api/v1/admin/auth/new-flow', UNLISTED_ADMIN_AUTH_PROFILE],
    ['/api/v1/admin/auth', UNLISTED_ADMIN_AUTH_PROFILE],
    ['/api/v1/me/mfa/setup', MFA_PROFILE],
    ['/api/v1/me/mfa/recovery-codes', MFA_PROFILE],
  ])('a new route under a strict prefix inherits it without a decorator: %s', (path, profile) => {
    expect(selectThrottleProfile(path)).toBe(profile);
  });

  it.each([
    '/api/health',
    '/api/v1/menu/search',
    '/api/v1/authors',
    '/api/v1/admin/orders',
    '/api/v1/admin/authz',
    '/api/v1/me',
    '/api/v1/me/mfa-status',
    '/api/v2/auth/login',
    '',
  ])('everything else is the lenient default: %j', (path) => {
    expect(selectThrottleProfile(path)).toBe(DEFAULT_PROFILE);
  });

  it('ignores case and trailing slashes', () => {
    expect(selectThrottleProfile('/API/V1/AUTH/LOGIN/')).toBe(CUSTOMER_SIGN_IN_PROFILE);
    expect(selectThrottleProfile('/Api/V1/Admin/Auth/Whatever')).toBe(UNLISTED_ADMIN_AUTH_PROFILE);
  });
});

describe('throttleProfileOf', () => {
  const route = { controller: class {}, handler: () => undefined };

  it('reads the registered route, not the raw request path', () => {
    const request = requestOn('/api/v1/auth/login', { path: '/API/V1/Auth/Login/' });

    expect(throttleProfileOf(httpContext(route, request))).toBe(CUSTOMER_SIGN_IN_PROFILE);
  });

  it('falls back to the request path when no route was matched', () => {
    const context = httpContext(route, { headers: {}, path: '/api/v1/admin/auth/login' });

    expect(throttleProfileOf(context)).toBe(STAFF_SIGN_IN_PROFILE);
  });
});
