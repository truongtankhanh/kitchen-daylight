import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { httpContext, requestOn } from '../auth/testing.js';
import type { GuardedRequest } from '../auth/request-user.js';
import {
  AppThrottlerGuard,
  throttleKeyOf,
  trackerOf,
  UNKNOWN_CLIENT,
} from './app-throttler.guard.js';
import { THROTTLER_MODULE_OPTIONS } from './throttling.module.js';

describe('trackerOf (client IP, decision 0007 section 5)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::1', '::1'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2:ffff::1', '2001:db8:1:2::/64'],
  ])('%s -> %s', (ip, tracker) => {
    expect(trackerOf({ ip })).toBe(tracker);
  });

  it('groups every address of one IPv6 /64 into one client', () => {
    expect(trackerOf({ ip: '2001:db8:aa:bb::1' })).toBe(trackerOf({ ip: '2001:db8:aa:bb:9::9' }));
  });

  it('reads req.ip only, never a header the client sent', () => {
    const request: GuardedRequest = {
      headers: { 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.8' },
      ip: '203.0.113.7',
    };

    expect(trackerOf(request)).toBe('203.0.113.7');
  });

  it('falls back to the socket address, then to one "unknown" bucket', () => {
    expect(trackerOf({ socket: { remoteAddress: '203.0.113.9' } })).toBe('203.0.113.9');
    expect(trackerOf({ ip: '' })).toBe(UNKNOWN_CLIENT);
    expect(trackerOf({})).toBe(UNKNOWN_CLIENT);
  });
});

describe('throttleKeyOf', () => {
  it('keys a counter by throttler, profile and client', () => {
    expect(throttleKeyOf('auth', 'customer-sign-in', '203.0.113.7')).toBe(
      'auth:customer-sign-in:203.0.113.7',
    );
  });
});

describe('AppThrottlerGuard with the module options and the memory store', () => {
  const route = { controller: class {}, handler: () => undefined };
  let storage: ThrottlerStorageService;
  let guard: AppThrottlerGuard;

  interface RecordingResponse {
    readonly headers: Record<string, unknown>;
    header(name: string, value: unknown): void;
  }

  function response(): RecordingResponse {
    const headers: Record<string, unknown> = {};
    return {
      headers,
      header(name, value) {
        headers[name] = value;
      },
    };
  }

  async function hit(
    routePath: string,
    ip = '203.0.113.7',
    res: RecordingResponse = response(),
  ): Promise<true | ThrottlerException> {
    try {
      await guard.canActivate(httpContext(route, requestOn(routePath, { ip }), res));
      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(ThrottlerException);
      return error as ThrottlerException;
    }
  }

  beforeEach(async () => {
    storage = new ThrottlerStorageService();
    guard = new AppThrottlerGuard(THROTTLER_MODULE_OPTIONS, storage, new Reflector());
    await guard.onModuleInit();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  it('refuses the 6th request to an unlisted /auth route, with Retry-After-auth', async () => {
    for (let count = 1; count <= 5; count += 1) {
      expect(await hit('/api/v1/auth/test')).toBe(true);
    }
    const res = response();

    const refused = await hit('/api/v1/auth/test', '203.0.113.7', res);

    expect(refused).toBeInstanceOf(ThrottlerException);
    expect((refused as ThrottlerException).getStatus()).toBe(429);
    expect(res.headers['Retry-After-auth']).toBeGreaterThan(0);
    expect(res.headers['Retry-After-auth']).toBeLessThanOrEqual(15 * 60);
  });

  it('counts each client apart', async () => {
    for (let count = 1; count <= 5; count += 1) {
      await hit('/api/v1/auth/test', '203.0.113.7');
    }

    expect(await hit('/api/v1/auth/test', '203.0.113.7')).toBeInstanceOf(ThrottlerException);
    expect(await hit('/api/v1/auth/test', '203.0.113.8')).toBe(true);
  });

  it('shares one counter between the routes of one 0008 group', async () => {
    for (let count = 1; count <= 10; count += 1) {
      await hit(count % 2 === 0 ? '/api/v1/auth/login' : '/api/v1/auth/social/google');
    }
    for (let count = 11; count <= 20; count += 1) {
      expect(await hit('/api/v1/auth/social/apple')).toBe(true);
    }

    expect(await hit('/api/v1/auth/login')).toBeInstanceOf(ThrottlerException);
  });

  it('keeps the strict counters away from the lenient default', async () => {
    for (let count = 1; count <= 6; count += 1) {
      await hit('/api/v1/auth/test');
    }
    const res = response();

    expect(await hit('/api/v1/menu/search', '203.0.113.7', res)).toBe(true);
    expect(res.headers['X-RateLimit-Limit']).toBe(600);
    expect(res.headers['X-RateLimit-Limit-auth']).toBeUndefined();
  });
});
