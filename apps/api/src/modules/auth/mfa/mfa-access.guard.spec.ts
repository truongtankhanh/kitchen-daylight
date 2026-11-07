import { generateKeyPairSync } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import type { ExecutionContext } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';

import { BEARER_CHALLENGE } from '../../../common/auth/auth.guard.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { FixedClock } from '../../../common/time/testing.js';
import type { UserRole } from '../../users/entities/user.entity.js';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from '../access-token.service.js';
import { KeySet } from '../key-set.js';
import type { MfaSubject } from './mfa-access.guard.js';
import { MfaAccessGuard } from './mfa-access.guard.js';
import {
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_ENROLMENT_TOKEN_TYPE,
  MFA_ENROLMENT_TTL_SECONDS,
  signMfaToken,
} from './mfa-tokens.js';

const NOW = '2026-11-07T03:00:00.000Z';
const USER_ID = '01930000-0000-7000-8000-000000000f21';
const SESSION_ID = '01930000-0000-7000-8000-000000000f22';

interface Probe {
  readonly context: ExecutionContext;
  readonly request: { headers: IncomingHttpHeaders; mfaSubject?: MfaSubject };
  readonly headers: Record<string, string>;
}

function probe(authorization?: string): Probe {
  const request: Probe['request'] = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const headers: Record<string, string> = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
    }),
  } as unknown as ExecutionContext;
  return { context, request, headers };
}

async function refusalOf(guard: MfaAccessGuard, target: Probe): Promise<ApiError> {
  const error = await guard.canActivate(target.context).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('MfaAccessGuard', () => {
  const clock = new FixedClock(NOW);
  let keys: KeySet;
  let accessTokens: AccessTokenService;
  let guard: MfaAccessGuard;

  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
    keys = new KeySet({
      keyId: 'kd-spec-mfa',
      privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
      publicKey: base64(publicKey.export({ type: 'spki', format: 'pem' })),
      previousPublicKeys: [],
    });
    await keys.onModuleInit();
    accessTokens = new AccessTokenService(keys, clock);
    guard = new MfaAccessGuard(accessTokens, keys, clock);
  });

  async function accessToken(role: UserRole): Promise<string> {
    return (await accessTokens.sign({ userId: USER_ID, role, sessionId: SESSION_ID })).token;
  }

  it('answers 401 with the Bearer challenge without a token, like AuthGuard', async () => {
    const target = probe();

    expect((await refusalOf(guard, target)).code).toBe('UNAUTHENTICATED');
    expect(target.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.missing);
  });

  it('answers 401 invalid_request to a header that is not Bearer <token>', async () => {
    const target = probe('Basic a2Q6a2Q=');

    expect((await refusalOf(guard, target)).code).toBe('UNAUTHENTICATED');
    expect(target.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.malformed);
  });

  it('accepts the enrolment token: subject via enrolment', async () => {
    const { token } = await signMfaToken(keys, clock.now(), MFA_ENROLMENT_TOKEN_TYPE, USER_ID);
    const target = probe(`Bearer ${token}`);

    await expect(guard.canActivate(target.context)).resolves.toBe(true);
    expect(target.request.mfaSubject).toEqual({ userId: USER_ID, via: 'enrolment' });
  });

  it('refuses an expired enrolment token', async () => {
    const { token } = await signMfaToken(keys, clock.now(), MFA_ENROLMENT_TOKEN_TYPE, USER_ID);
    const later = new FixedClock(
      new Date(clock.now().getTime() + (MFA_ENROLMENT_TTL_SECONDS + 60) * 1000),
    );
    const target = probe(`Bearer ${token}`);

    const error = await refusalOf(new MfaAccessGuard(accessTokens, keys, later), target);

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(target.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.refused);
  });

  it('refuses the challenge token (it is for /admin/auth/mfa/verify only)', async () => {
    const { token } = await signMfaToken(keys, clock.now(), MFA_CHALLENGE_TOKEN_TYPE, USER_ID);
    const target = probe(`Bearer ${token}`);

    expect((await refusalOf(guard, target)).code).toBe('UNAUTHENTICATED');
    expect(target.request.mfaSubject).toBeUndefined();
  });

  it.each(['MANAGER', 'ADMIN'] as const)(
    'accepts the access token of a %s: subject via session',
    async (role) => {
      const target = probe(`Bearer ${await accessToken(role)}`);

      await expect(guard.canActivate(target.context)).resolves.toBe(true);
      expect(target.request.mfaSubject).toEqual({ userId: USER_ID, via: 'session' });
    },
  );

  it.each(['STAFF', 'CUSTOMER'] as const)(
    'answers 403 FORBIDDEN to a %s access token',
    async (role) => {
      const target = probe(`Bearer ${await accessToken(role)}`);

      expect((await refusalOf(guard, target)).code).toBe('FORBIDDEN');
      expect(target.request.mfaSubject).toBeUndefined();
    },
  );

  it('answers TOKEN_EXPIRED to an expired access token', async () => {
    const token = await accessToken('ADMIN');
    const later = new FixedClock(
      new Date(clock.now().getTime() + (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000),
    );
    const target = probe(`Bearer ${token}`);

    const error = await refusalOf(
      new MfaAccessGuard(new AccessTokenService(keys, later), keys, later),
      target,
    );

    expect(error.code).toBe('TOKEN_EXPIRED');
    expect(target.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.refused);
  });

  it('refuses a forged token', async () => {
    const target = probe('Bearer not.a.jwt');

    expect((await refusalOf(guard, target)).code).toBe('UNAUTHENTICATED');
    expect(target.headers['WWW-Authenticate']).toBe(BEARER_CHALLENGE.refused);
  });
});
