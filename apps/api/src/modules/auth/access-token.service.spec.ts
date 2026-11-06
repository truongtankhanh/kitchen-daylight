import { generateKeyPairSync } from 'node:crypto';

import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import { AccessTokenService } from './access-token.service.js';
import { KeySet } from './key-set.js';
import type { JwtKeyConfig } from './key-set.js';

const NOW = '2026-11-06T03:00:00.000Z';
const USER_ID = '01930000-0000-7000-8000-0000000000d1';
const SESSION_ID = '01930000-0000-7000-8000-0000000000e1';

interface Pair {
  readonly keyId: string;
  readonly privateKey: string;
  readonly publicKey: string;
}

/** A P-256 pair generated at run time: no key literal in the repository. */
function ephemeralPair(keyId: string): Pair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
  return {
    keyId,
    privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKey: base64(publicKey.export({ type: 'spki', format: 'pem' })),
  };
}

function config(current: Pair, previous: Pair[] = []): JwtKeyConfig {
  return {
    keyId: current.keyId,
    privateKey: current.privateKey,
    publicKey: current.publicKey,
    previousPublicKeys: previous.map(({ keyId, publicKey }) => ({ keyId, publicKey })),
  };
}

async function serviceWith(
  jwt: JwtKeyConfig,
  clock = new FixedClock(NOW),
): Promise<{ service: AccessTokenService; keys: KeySet; clock: FixedClock }> {
  const keys = new KeySet(jwt);
  await keys.onModuleInit();
  return { service: new AccessTokenService(keys, clock), keys, clock };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function errorOf(work: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

async function expectUnauthenticated(work: Promise<unknown>): Promise<void> {
  const error = await errorOf(work);
  expect(error.code).toBe('UNAUTHENTICATED');
  // No hint of the cause.
  expect(error.detail).toBeUndefined();
}

const SUBJECT = { userId: USER_ID, role: 'MANAGER', sessionId: SESSION_ID } as const;

describe('AccessTokenService', () => {
  let current: Pair;

  beforeAll(() => {
    current = ephemeralPair('kd-test-current');
  });

  it('signs ES256 with kid and typ, the claims of decision 0008 and a 15-minute expiry', async () => {
    const { service, clock } = await serviceWith(config(current));

    const { token, expiresAt } = await service.sign(SUBJECT);

    expect(decodeProtectedHeader(token)).toEqual({
      alg: 'ES256',
      kid: 'kd-test-current',
      typ: 'at+jwt',
    });
    const iat = clock.now().getTime() / 1000;
    expect(decodeJwt(token)).toEqual({
      iss: 'kd-api',
      aud: 'kd-api',
      sub: USER_ID,
      role: 'MANAGER',
      sid: SESSION_ID,
      iat,
      exp: iat + 900,
    });
    expect(expiresAt.getTime()).toBe(clock.now().getTime() + 15 * 60 * 1000);
  });

  it('verifies its own token', async () => {
    const { service, clock } = await serviceWith(config(current));
    const { token } = await service.sign(SUBJECT);

    await expect(service.verify(token)).resolves.toEqual({
      ...SUBJECT,
      issuedAt: clock.now(),
      expiresAt: new Date(clock.now().getTime() + 900_000),
    });
  });

  it('accepts a token up to the 5-second tolerance after exp, then answers TOKEN_EXPIRED', async () => {
    const { service, clock } = await serviceWith(config(current));
    const { token } = await service.sign(SUBJECT);

    clock.advance(15 * 60 * 1000 + 4_000);
    await expect(service.verify(token)).resolves.toMatchObject({ userId: USER_ID });

    clock.advance(1_000);
    const error = await errorOf(service.verify(token));
    expect(error.code).toBe('TOKEN_EXPIRED');
  });

  it('refuses a tampered payload', async () => {
    const { service } = await serviceWith(config(current));
    const [header, , signature] = (await service.sign(SUBJECT)).token.split('.');
    const forged = base64url({ ...decodeJwt((await service.sign(SUBJECT)).token), role: 'ADMIN' });

    await expectUnauthenticated(service.verify(`${header}.${forged}.${signature}`));
  });

  it('refuses alg none', async () => {
    const { service } = await serviceWith(config(current));
    const payload = decodeJwt((await service.sign(SUBJECT)).token);
    const unsigned = `${base64url({ alg: 'none', kid: 'kd-test-current', typ: 'at+jwt' })}.${base64url(payload)}.`;

    await expectUnauthenticated(service.verify(unsigned));
  });

  it('refuses an HS256 token keyed with anything', async () => {
    const { service, clock } = await serviceWith(config(current));
    const iat = Math.floor(clock.now().getTime() / 1000);
    const token = await new SignJWT({ role: 'ADMIN', sid: SESSION_ID })
      .setProtectedHeader({ alg: 'HS256', kid: 'kd-test-current', typ: 'at+jwt' })
      .setIssuer('kd-api')
      .setAudience('kd-api')
      .setSubject(USER_ID)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 900)
      .sign(Buffer.from(current.publicKey, 'base64'));

    await expectUnauthenticated(service.verify(token));
  });

  it('refuses an unknown kid and a wrong key under a known kid', async () => {
    const { service } = await serviceWith(config(current));
    const { service: otherKid } = await serviceWith(config(ephemeralPair('kd-test-other')));
    const { service: sameKidOtherKey } = await serviceWith(
      config(ephemeralPair('kd-test-current')),
    );

    await expectUnauthenticated(service.verify((await otherKid.sign(SUBJECT)).token));
    await expectUnauthenticated(service.verify((await sameKidOtherKey.sign(SUBJECT)).token));
  });

  it.each([
    ['audience', { aud: 'kd-other' }],
    ['issuer', { iss: 'kd-other' }],
    ['typ', { typ: 'JWT' }],
    ['missing sid', { sid: undefined }],
    ['unknown role', { role: 'OWNER' }],
  ])('refuses a wrong %s', async (_case, change: Record<string, unknown>) => {
    const { service, keys, clock } = await serviceWith(config(current));
    const iat = Math.floor(clock.now().getTime() / 1000);
    const claims: Record<string, unknown> = {
      role: change['role'] ?? 'STAFF',
      ...('sid' in change ? {} : { sid: SESSION_ID }),
    };
    const token = await new SignJWT(claims)
      .setProtectedHeader({
        alg: 'ES256',
        kid: 'kd-test-current',
        typ: typeof change['typ'] === 'string' ? change['typ'] : 'at+jwt',
      })
      .setIssuer(typeof change['iss'] === 'string' ? change['iss'] : 'kd-api')
      .setAudience(typeof change['aud'] === 'string' ? change['aud'] : 'kd-api')
      .setSubject(USER_ID)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 900)
      .sign(keys.signingKey().key);

    await expectUnauthenticated(service.verify(token));
  });

  it('refuses garbage and an expired token with a bad signature as UNAUTHENTICATED', async () => {
    const { service, clock } = await serviceWith(config(current));
    const { service: stranger } = await serviceWith(
      config(ephemeralPair('kd-test-current')),
      clock,
    );
    const foreign = (await stranger.sign(SUBJECT)).token;
    clock.advance(60 * 60 * 1000);

    await expectUnauthenticated(service.verify(foreign));
    await expectUnauthenticated(service.verify('not-a-token'));
    await expectUnauthenticated(service.verify(''));
  });

  it('verifies a token signed before a key rotation until the previous key is removed', async () => {
    const previous = ephemeralPair('kd-test-previous');
    const { service: before } = await serviceWith(config(previous));
    const token = (await before.sign(SUBJECT)).token;

    const { service: rotated } = await serviceWith(config(current, [previous]));
    await expect(rotated.verify(token)).resolves.toMatchObject({ userId: USER_ID });
    expect(decodeProtectedHeader((await rotated.sign(SUBJECT)).token).kid).toBe('kd-test-current');

    const { service: afterRemoval } = await serviceWith(config(current));
    await expectUnauthenticated(afterRemoval.verify(token));
  });
});
