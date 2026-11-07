import type { AppEnv } from '../../config/config.schema.js';

/**
 * The staff refresh cookie (decision 0008 section 10): `kd_refresh`, host only (no `Domain`),
 * `Path` limited to the admin auth routes, `HttpOnly`, `SameSite=Strict`, `Secure` outside `dev`
 * and `test`. No `__Host-` prefix: it requires `Path=/`. The value is never logged.
 */
export const REFRESH_COOKIE_NAME = 'kd_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/admin/auth';

/**
 * A refresh token is 43 base64url characters (`generateRefreshToken`); the bound leaves room for a
 * longer format and refuses anything else before it reaches the database.
 */
const REFRESH_COOKIE_VALUE = /^[A-Za-z0-9_-]{1,128}$/;

/** Tiers whose admin runs on `http://localhost`, where some browsers ignore a `Secure` cookie. */
const INSECURE_COOKIE_TIERS: readonly AppEnv[] = ['dev', 'test'];

/** `Secure` in every tier except `dev` and `test`; `demo` and `prod` always set it. */
export function refreshCookieSecure(appEnv: AppEnv): boolean {
  return !INSECURE_COOKIE_TIERS.includes(appEnv);
}

function attributes(maxAgeSeconds: number, secure: boolean): string[] {
  const list = [
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) {
    list.push('Secure');
  }
  return list;
}

/**
 * The `Set-Cookie` value that stores `token` until `expiresAt` (the idle end of the token, never
 * after the family's absolute end). `Max-Age` counts whole seconds from `now`, at least 0.
 */
export function serializeRefreshCookie(
  token: string,
  expiresAt: Date,
  now: Date,
  secure: boolean,
): string {
  if (!REFRESH_COOKIE_VALUE.test(token)) {
    // Programmer error; the message never repeats the value.
    throw new Error('A refresh cookie value must be base64url.');
  }
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [`${REFRESH_COOKIE_NAME}=${token}`, ...attributes(maxAge, secure)].join('; ');
}

/** The `Set-Cookie` value that removes the cookie: same name and path, empty, `Max-Age=0`. */
export function clearRefreshCookie(secure: boolean): string {
  return [
    `${REFRESH_COOKIE_NAME}=`,
    ...attributes(0, secure),
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

/**
 * The `kd_refresh` value of a `Cookie` header (RFC 6265 section 5.4: `name=value` pairs separated
 * by `;`), or `undefined` when absent or not a well-formed token. The first match wins: a browser
 * lists the cookie with the longest path first. No decoding: a refresh token is base64url.
 */
export function readRefreshCookie(
  header: string | readonly string[] | undefined,
): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) {
      continue;
    }
    const value = pair.slice(separator + 1).trim();
    return REFRESH_COOKIE_VALUE.test(value) ? value : undefined;
  }
  return undefined;
}
