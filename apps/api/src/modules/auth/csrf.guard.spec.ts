import type { IncomingHttpHeaders } from 'node:http';

import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import type { ServerConfig } from '../../config/load-config.js';
import { CsrfGuard, passesCsrfCheck } from './csrf.guard.js';

const ORIGINS = ['http://localhost:4200', 'https://admin.kitchendaylight.example'] as const;
const GOOD: IncomingHttpHeaders = { 'x-client': 'admin-web', origin: 'http://localhost:4200' };

function without(name: string): IncomingHttpHeaders {
  return Object.fromEntries(Object.entries(GOOD).filter(([key]) => key !== name));
}

function contextOf(headers: IncomingHttpHeaders): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('passesCsrfCheck', () => {
  it.each(ORIGINS)('passes with X-Client: admin-web and the allowed Origin %s', (origin) => {
    expect(passesCsrfCheck({ ...GOOD, origin }, ORIGINS)).toBe(true);
  });

  it('tolerates spaces around the X-Client value', () => {
    expect(passesCsrfCheck({ ...GOOD, 'x-client': ' admin-web ' }, ORIGINS)).toBe(true);
  });

  it.each([
    ['no X-Client', without('x-client')],
    ['no Origin', without('origin')],
    ['neither header', {}],
    ['another client', { ...GOOD, 'x-client': 'mobile-ios' }],
    ['an upper-case client', { ...GOOD, 'x-client': 'ADMIN-WEB' }],
    ['an empty client', { ...GOOD, 'x-client': '' }],
    ['a repeated client', { ...GOOD, 'x-client': ['admin-web', 'admin-web'] }],
    ['a foreign Origin', { ...GOOD, origin: 'https://evil.example' }],
    ['Origin null', { ...GOOD, origin: 'null' }],
    ['an Origin with a trailing slash', { ...GOOD, origin: 'http://localhost:4200/' }],
    ['an Origin on another port', { ...GOOD, origin: 'http://localhost:4201' }],
    ['an Origin on another scheme', { ...GOOD, origin: 'https://localhost:4200' }],
    ['an Origin in upper case', { ...GOOD, origin: 'HTTP://LOCALHOST:4200' }],
    [
      'an Origin that only starts with an allowed one',
      { ...GOOD, origin: 'http://localhost:42000' },
    ],
    [
      'a sub-domain of an allowed origin',
      { ...GOOD, origin: 'https://x.admin.kitchendaylight.example' },
    ],
  ] as const)('refuses %s', (_case, headers) => {
    expect(passesCsrfCheck(headers as IncomingHttpHeaders, ORIGINS)).toBe(false);
  });

  it('refuses everything when no origin is allowed', () => {
    expect(passesCsrfCheck(GOOD, [])).toBe(false);
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard({ adminOrigins: ORIGINS } as unknown as ServerConfig);

  it('lets an admin-web request from an allowed origin through', () => {
    expect(guard.canActivate(contextOf(GOOD))).toBe(true);
  });

  it.each([
    ['no X-Client', without('x-client')],
    ['no Origin', without('origin')],
    ['a foreign Origin', { ...GOOD, origin: 'https://evil.example' }],
  ])('answers 403 FORBIDDEN for %s, with no detail', (_case, headers) => {
    let thrown: unknown;
    try {
      guard.canActivate(contextOf(headers));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('FORBIDDEN');
    expect((thrown as ApiError).status).toBe(403);
    expect((thrown as ApiError).detail).toBeUndefined();
  });
});
