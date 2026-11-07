import { describe, expect, it } from 'vitest';

import { APP_ENVS } from '../../config/config.schema.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  refreshCookieSecure,
  serializeRefreshCookie,
} from './refresh-cookie.js';

// Fictional token: 43 base64url characters, the shape of `generateRefreshToken`.
const TOKEN = 'kdFixtureRefreshToken_0123456789-abcdefghij';
const NOW = new Date('2026-11-07T03:00:00.000Z');
const IN_ONE_DAY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

function attributesOf(cookie: string): string[] {
  return cookie.split('; ').slice(1);
}

describe('refreshCookieSecure', () => {
  it.each(['demo', 'prod'] as const)('always sets Secure in %s', (appEnv) => {
    expect(refreshCookieSecure(appEnv)).toBe(true);
    expect(
      attributesOf(serializeRefreshCookie(TOKEN, IN_ONE_DAY, NOW, refreshCookieSecure(appEnv))),
    ).toContain('Secure');
    expect(attributesOf(clearRefreshCookie(refreshCookieSecure(appEnv)))).toContain('Secure');
  });

  it.each(['dev', 'test'] as const)('leaves Secure out in %s (http://localhost)', (appEnv) => {
    expect(refreshCookieSecure(appEnv)).toBe(false);
  });

  it('sets Secure in every tier but dev and test', () => {
    expect(APP_ENVS.filter((appEnv) => !refreshCookieSecure(appEnv))).toEqual(['dev', 'test']);
  });
});

describe('serializeRefreshCookie', () => {
  it('writes the name, value, path, lifetime and flags of decision 0008 section 10', () => {
    expect(serializeRefreshCookie(TOKEN, IN_ONE_DAY, NOW, true)).toBe(
      `kd_refresh=${TOKEN}; Path=/api/v1/admin/auth; Max-Age=86400; HttpOnly; SameSite=Strict; Secure`,
    );
  });

  it('has no Domain and no Expires (host only, Max-Age wins)', () => {
    const cookie = serializeRefreshCookie(TOKEN, IN_ONE_DAY, NOW, true).toLowerCase();

    expect(cookie).not.toContain('domain=');
    expect(cookie).not.toContain('expires=');
  });

  it('counts whole seconds and never goes below 0', () => {
    const soon = new Date(NOW.getTime() + 1999);

    expect(serializeRefreshCookie(TOKEN, soon, NOW, false)).toContain('Max-Age=1;');
    expect(serializeRefreshCookie(TOKEN, new Date(NOW.getTime() - 5000), NOW, false)).toContain(
      'Max-Age=0;',
    );
  });

  it.each(['', 'a b', 'a;b', 'a=b', 'é', 'x'.repeat(129)])(
    'refuses a value that is not a base64url token, without echoing it (%#)',
    (value) => {
      expect(() => serializeRefreshCookie(value, IN_ONE_DAY, NOW, true)).toThrow(
        'A refresh cookie value must be base64url.',
      );
    },
  );
});

describe('clearRefreshCookie', () => {
  it('empties the cookie with the same name and path, Max-Age=0', () => {
    expect(clearRefreshCookie(false)).toBe(
      'kd_refresh=; Path=/api/v1/admin/auth; Max-Age=0; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
    expect(clearRefreshCookie(true).startsWith(`${REFRESH_COOKIE_NAME}=;`)).toBe(true);
    expect(clearRefreshCookie(true)).toContain(`Path=${REFRESH_COOKIE_PATH};`);
  });
});

describe('readRefreshCookie', () => {
  it('reads the value among other cookies', () => {
    expect(readRefreshCookie(`theme=dark; kd_refresh=${TOKEN}; lang=vi`)).toBe(TOKEN);
    expect(readRefreshCookie(`kd_refresh=${TOKEN}`)).toBe(TOKEN);
    expect(readRefreshCookie(`  kd_refresh = ${TOKEN} `)).toBe(TOKEN);
  });

  it('takes the first kd_refresh (the longest path comes first)', () => {
    expect(readRefreshCookie(`kd_refresh=${TOKEN}; kd_refresh=other`)).toBe(TOKEN);
  });

  it.each([
    ['no header', undefined],
    ['an array', [`kd_refresh=${TOKEN}`]],
    ['an empty header', ''],
    ['another cookie only', 'theme=dark'],
    ['a similar name', `kd_refresh_old=${TOKEN}; xkd_refresh=${TOKEN}`],
    ['an empty value', 'kd_refresh='],
    ['a quoted value', `kd_refresh="${TOKEN}"`],
    ['an encoded value', 'kd_refresh=a%20b'],
    ['a value too long', `kd_refresh=${'x'.repeat(129)}`],
    ['a pair without =', 'kd_refresh'],
  ])('returns undefined for %s', (_case, header) => {
    expect(readRefreshCookie(header)).toBeUndefined();
  });

  it('round-trips a serialized cookie', () => {
    const [pair] = serializeRefreshCookie(TOKEN, IN_ONE_DAY, NOW, true).split('; ');

    expect(readRefreshCookie(pair)).toBe(TOKEN);
  });
});
