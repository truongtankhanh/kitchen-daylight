import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ServerConfig } from '../../config/load-config.js';
import { SETTING_DEFAULTS } from '../../modules/settings/settings-defaults.js';
import { ApiError } from '../errors/api-error.js';
import { FixedClock } from '../time/testing.js';
import { AppGatesGuard, decideGate, isGateExempt, retryAfterSeconds } from './app-gates.guard.js';
import type { GateRequest } from './app-gates.guard.js';
import type { GateSnapshot, GateState } from './gate-snapshot.js';

const NOW = '2026-11-08T03:00:00.000Z';
const STORE_URLS = {
  ios: 'https://apps.apple.invalid/app/kitchen-daylight',
  android: 'https://play.google.invalid/store/apps/details?id=com.example.kitchendaylight',
};

const OPEN: GateState = {
  maintenance: SETTING_DEFAULTS.maintenance,
  minAppVersion: { ios: '2.0.0', android: '1.5.0' },
};

const DOWN: GateState = {
  maintenance: {
    enabled: true,
    message: 'Hệ thống đang bảo trì.',
    expectedBackAt: '2026-11-08T03:10:00.000Z',
    since: '2026-11-08T02:50:00.000Z',
  },
  minAppVersion: OPEN.minAppVersion,
};

function request(routePath: string, client?: string, appVersion?: string): GateRequest {
  return { routePath, client, appVersion };
}

describe('isGateExempt', () => {
  it.each([
    '/api/v1/admin/auth/login',
    '/api/v1/admin/auth/mfa/verify',
    '/api/v1/admin/auth/refresh',
    '/api/v1/admin/app-settings',
    '/api/v1/admin/meta/config',
    '/api/v1/admin',
    '/api/v1/me/mfa/setup',
    '/api/v1/me/mfa/confirm',
    '/api/v1/meta/config',
    '/api/v1/internal/jobs/run',
    '/api/health',
    '/api/docs',
    '/API/V1/Admin/Users',
  ])('exempts %s', (path) => {
    expect(isGateExempt(path)).toBe(true);
  });

  it.each([
    '/api/v1/provinces',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/me',
    '/api/v1/me/addresses',
    '/api/v1/me/sessions',
    '/api/v1/meta/config-extra',
    '/api/v1/administrators',
    '/api/v1/metaconfig',
  ])('gates %s', (path) => {
    expect(isGateExempt(path)).toBe(false);
  });
});

describe('decideGate', () => {
  it('passes everything while the service is open and the app is current', () => {
    expect(decideGate(request('/api/v1/provinces'), OPEN, STORE_URLS)).toEqual({ kind: 'PASS' });
  });

  it('answers MAINTENANCE with the message and the expected time on a customer path', () => {
    expect(decideGate(request('/api/v1/provinces'), DOWN, STORE_URLS)).toEqual({
      kind: 'MAINTENANCE',
      message: 'Hệ thống đang bảo trì.',
      expectedBackAt: '2026-11-08T03:10:00.000Z',
    });
  });

  it.each(['/api/v1/admin/auth/login', '/api/v1/meta/config', '/api/v1/me/mfa/setup'])(
    'lets %s through during maintenance',
    (path) => {
      expect(decideGate(request(path, 'mobile-ios', '0.0.1'), DOWN, STORE_URLS)).toEqual({
        kind: 'PASS',
      });
    },
  );

  it('answers UPGRADE_REQUIRED with the store URL of the platform below its minimum', () => {
    expect(
      decideGate(request('/api/v1/provinces', 'mobile-ios', '1.9.9'), OPEN, STORE_URLS),
    ).toEqual({ kind: 'UPGRADE_REQUIRED', storeUrl: STORE_URLS.ios });
    expect(
      decideGate(request('/api/v1/provinces', 'mobile-android', '1.4.9'), OPEN, STORE_URLS),
    ).toEqual({ kind: 'UPGRADE_REQUIRED', storeUrl: STORE_URLS.android });
  });

  it('gives storeUrl null when the store URL is not configured', () => {
    expect(
      decideGate(request('/api/v1/provinces', 'mobile-android', '1.0.0'), OPEN, {
        ios: null,
        android: null,
      }),
    ).toEqual({ kind: 'UPGRADE_REQUIRED', storeUrl: null });
  });

  it.each([
    ['the minimum itself', 'mobile-android', '1.5.0'],
    ['a higher version', 'mobile-ios', '2.0.1'],
    ['1.10.0 against 1.5.0', 'mobile-android', '1.10.0'],
    ['a missing version', 'mobile-ios', undefined],
    ['a malformed version', 'mobile-ios', '1.2'],
    ['the admin web', 'admin-web', '0.0.1'],
    ['an unknown client', 'web', '0.0.1'],
    ['no client', undefined, '0.0.1'],
    ['a prototype key as client', 'constructor', '0.0.1'],
  ])('lets %s through the version gate', (_case, client, version) => {
    expect(decideGate(request('/api/v1/provinces', client, version), OPEN, STORE_URLS)).toEqual({
      kind: 'PASS',
    });
  });

  it('answers MAINTENANCE before UPGRADE_REQUIRED', () => {
    expect(
      decideGate(request('/api/v1/provinces', 'mobile-ios', '0.0.1'), DOWN, STORE_URLS).kind,
    ).toBe('MAINTENANCE');
  });
});

describe('retryAfterSeconds', () => {
  it('rounds the time left up to whole seconds', () => {
    expect(retryAfterSeconds('2026-11-08T03:10:00.500Z', new Date(NOW))).toBe(601);
  });

  it.each([null, '2026-11-08T02:59:00.000Z', 'not a date'])('gives nothing for %j', (value) => {
    expect(retryAfterSeconds(value, new Date(NOW))).toBeUndefined();
  });
});

describe('AppGatesGuard', () => {
  function context(path: string, headers: Record<string, string>) {
    const setHeader = vi.fn();
    const execution = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ route: { path }, headers }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    return { execution, setHeader };
  }

  function guardWith(state: GateState) {
    const current = vi.fn(() => Promise.resolve(state));
    const guard = new AppGatesGuard(
      { current } as unknown as GateSnapshot,
      { appStoreUrls: STORE_URLS } as unknown as ServerConfig,
      new FixedClock(NOW),
    );
    return { guard, current };
  }

  async function errorOf(work: Promise<unknown>): Promise<ApiError> {
    const error: unknown = await work.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  it('answers MAINTENANCE the same with or without a token, with Retry-After', async () => {
    const { guard } = guardWith(DOWN);
    const variants: Record<string, string>[] = [{}, { authorization: 'Bearer some.access.token' }];
    for (const headers of variants) {
      const { execution, setHeader } = context('/api/v1/me', headers);

      const error = await errorOf(guard.canActivate(execution));

      expect(error.code).toBe('MAINTENANCE');
      expect(error.status).toBe(503);
      expect(error.extras).toEqual({
        message: 'Hệ thống đang bảo trì.',
        expectedBackAt: '2026-11-08T03:10:00.000Z',
      });
      expect(setHeader).toHaveBeenCalledWith('Retry-After', '600');
    }
  });

  it('answers UPGRADE_REQUIRED (400) with the store URL', async () => {
    const { guard } = guardWith(OPEN);
    const { execution } = context('/api/v1/provinces', {
      'x-client': 'mobile-ios',
      'x-app-version': '1.0.0',
    });

    const error = await errorOf(guard.canActivate(execution));

    expect(error.code).toBe('UPGRADE_REQUIRED');
    expect(error.status).toBe(400);
    expect(error.extras).toEqual({ storeUrl: STORE_URLS.ios });
  });

  it('decides an exempt path without reading the snapshot', async () => {
    const { guard, current } = guardWith(DOWN);

    await expect(
      guard.canActivate(context('/api/v1/admin/auth/login', {}).execution),
    ).resolves.toBe(true);
    expect(current).not.toHaveBeenCalled();
  });

  it('does not gate a non-HTTP context', async () => {
    const { guard, current } = guardWith(DOWN);

    await expect(
      guard.canActivate({ getType: () => 'ws' } as unknown as ExecutionContext),
    ).resolves.toBe(true);
    expect(current).not.toHaveBeenCalled();
  });
});
