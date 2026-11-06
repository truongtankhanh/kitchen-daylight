import { generateKeyPairSync } from 'node:crypto';

import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
} from '../../modules/auth/access-token.service.js';
import { KeySet } from '../../modules/auth/key-set.js';
import type { JwtKeyConfig } from '../../modules/auth/key-set.js';
import { ApiError } from '../errors/api-error.js';
import { FixedClock } from '../time/testing.js';
import { AuthGuard, BEARER_CHALLENGE, bearerTokenOf } from './auth.guard.js';
import { Public } from './public.decorator.js';
import type { GuardedRequest } from './request-user.js';
import { httpContext, requestOn } from './testing.js';

const NOW = '2026-11-06T03:00:00.000Z';
const USER_ID = '01930000-0000-7000-8000-00000000a1a1';
const SESSION_ID = '01930000-0000-7000-8000-00000000a1b1';

/** A P-256 pair generated at run time: no key literal in the repository. */
function ephemeralKeys(keyId: string): JwtKeyConfig {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
  return {
    keyId,
    privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKey: base64(publicKey.export({ type: 'spki', format: 'pem' })),
    previousPublicKeys: [],
  };
}

async function tokenServiceWith(jwt: JwtKeyConfig, clock: FixedClock): Promise<AccessTokenService> {
  const keys = new KeySet(jwt);
  await keys.onModuleInit();
  return new AccessTokenService(keys, clock);
}

@Controller('orders')
class ProtectedController {
  @Get()
  list(): void {}

  @Public()
  @Get('open')
  open(): void {}
}

@Public()
@Controller('meta')
class PublicController {
  @Get()
  read(): void {}
}

const PROTECTED = { controller: ProtectedController, handler: ProtectedController.prototype.list };
const PUBLIC_HANDLER = {
  controller: ProtectedController,
  handler: ProtectedController.prototype.open,
};
const PUBLIC_CLASS = { controller: PublicController, handler: PublicController.prototype.read };

/** A response that records the headers the guard sets. */
function recorder(): {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
} {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

async function errorOf(work: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('bearerTokenOf', () => {
  it.each([
    ['Bearer abc.def-ghi_jkl', 'abc.def-ghi_jkl'],
    ['bearer abc', 'abc'],
    ['BEARER  abc==', 'abc=='],
  ])('reads %j', (header, token) => {
    expect(bearerTokenOf(header)).toBe(token);
  });

  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic a2Q6a2Q=',
    'Bearer a b',
    'Bearer a,b',
    'Token abc',
  ])('refuses %j', (header) => {
    expect(bearerTokenOf(header)).toBeUndefined();
  });
});

describe('AuthGuard decision table', () => {
  let clock: FixedClock;
  let tokens: AccessTokenService;
  let guard: AuthGuard;

  async function signed(role: 'CUSTOMER' | 'STAFF' = 'CUSTOMER'): Promise<string> {
    const { token } = await tokens.sign({ userId: USER_ID, role, sessionId: SESSION_ID });
    return token;
  }

  function on(authorization?: string): GuardedRequest {
    return requestOn(
      '/api/v1/orders',
      authorization === undefined ? {} : { headers: { authorization } },
    );
  }

  beforeAll(async () => {
    clock = new FixedClock(NOW);
    tokens = await tokenServiceWith(ephemeralKeys('kd-test-guard'), clock);
    guard = new AuthGuard(new Reflector(), tokens);
  });

  it('no header: 401 UNAUTHENTICATED, challenge without an error code', async () => {
    const res = recorder();

    const error = await errorOf(guard.canActivate(httpContext(PROTECTED, on(), res)));

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.status).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.missing);
  });

  it.each(['Basic a2Q6a2Q=', 'Bearer', 'Bearer not a token', 'Token abc'])(
    'malformed header %j: 401 UNAUTHENTICATED, invalid_request challenge',
    async (authorization) => {
      const res = recorder();

      const error = await errorOf(
        guard.canActivate(httpContext(PROTECTED, on(authorization), res)),
      );

      expect(error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.malformed);
    },
  );

  it('token signed by another key: 401 UNAUTHENTICATED, invalid_token challenge', async () => {
    const other = await tokenServiceWith(ephemeralKeys('kd-test-guard'), clock);
    const { token } = await other.sign({ userId: USER_ID, role: 'ADMIN', sessionId: SESSION_ID });
    const res = recorder();

    const error = await errorOf(
      guard.canActivate(httpContext(PROTECTED, on(`Bearer ${token}`), res)),
    );

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(res.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.refused);
  });

  it('expired token: 401 TOKEN_EXPIRED, the same invalid_token challenge', async () => {
    const token = await signed();
    const res = recorder();
    clock.advance((ACCESS_TOKEN_TTL_SECONDS + 60) * 1000);
    try {
      const error = await errorOf(
        guard.canActivate(httpContext(PROTECTED, on(`Bearer ${token}`), res)),
      );

      expect(error.code).toBe('TOKEN_EXPIRED');
      expect(error.status).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.refused);
    } finally {
      clock.set(NOW);
    }
  });

  it('valid token: allowed, request user { id, role } from the token only', async () => {
    const request = on(`Bearer ${await signed('STAFF')}`);
    const res = recorder();

    await expect(guard.canActivate(httpContext(PROTECTED, request, res))).resolves.toBe(true);
    expect(request.user).toEqual({ id: USER_ID, role: 'STAFF' });
    expect(Object.isFrozen(request.user)).toBe(true);
    expect(res.headers).toEqual({});
  });

  it('@Public() on the handler: allowed without a header, no request user', async () => {
    const request = on();

    await expect(guard.canActivate(httpContext(PUBLIC_HANDLER, request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('@Public() on the controller: allowed without a header', async () => {
    await expect(guard.canActivate(httpContext(PUBLIC_CLASS, on()))).resolves.toBe(true);
  });

  it('@Public() skips the token check even with a broken header', async () => {
    await expect(guard.canActivate(httpContext(PUBLIC_HANDLER, on('Bearer broken')))).resolves.toBe(
      true,
    );
  });

  it('non-HTTP context without @Public(): 401 UNAUTHENTICATED (fail closed)', async () => {
    const context = httpContext(PROTECTED, on(`Bearer ${await signed()}`), {}, 'ws');

    const error = await errorOf(guard.canActivate(context));

    expect(error.code).toBe('UNAUTHENTICATED');
  });
});
