import { generateKeyPairSync } from 'node:crypto';

import { decodeJwt, decodeProtectedHeader } from 'jose';
import type { EntityManager } from 'typeorm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../common/errors/api-error.js';
import { FixedClock } from '../../../common/time/testing.js';
import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import type { User } from '../../users/entities/user.entity.js';
import type { UsersService } from '../../users/users.service.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TYPE,
  AccessTokenService,
} from '../access-token.service.js';
import { KeySet } from '../key-set.js';
import type { JwtKeyConfig } from '../key-set.js';
import { MFA_CHALLENGE_TOKEN_TYPE, signMfaToken } from '../mfa/mfa-tokens.js';
import type { CodeFailureAudit, InTransaction, MfaService } from '../mfa/mfa.service.js';
import {
  signStepUpToken,
  STEP_UP_AUDIENCE,
  STEP_UP_AUDIT,
  STEP_UP_TOKEN_TYPE,
  STEP_UP_TTL_SECONDS,
  StepUpService,
  verifyStepUpToken,
} from './step-up.service.js';

const NOW = '2026-11-07T03:00:00.000Z';
const ADMIN_ID = '01930000-0000-7000-8000-00000000c1a1';
const OTHER_ID = '01930000-0000-7000-8000-00000000c1a2';
const SESSION_ID = '01930000-0000-7000-8000-00000000c1b1';

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

async function keySetOf(config: JwtKeyConfig): Promise<KeySet> {
  const keys = new KeySet(config);
  await keys.onModuleInit();
  return keys;
}

describe('step-up token', () => {
  let keys: KeySet;
  let foreignKeys: KeySet;

  beforeAll(async () => {
    keys = await keySetOf(ephemeralKeys('kd-test-1'));
    foreignKeys = await keySetOf(ephemeralKeys('kd-test-1'));
  });

  it('carries typ, kid, iss, the step-up audience, sub, purpose, iat and exp, and nothing else', async () => {
    const now = new Date(NOW);
    const { stepUpToken, expiresAt } = await signStepUpToken(
      keys,
      now,
      ADMIN_ID,
      'settings.payment',
    );

    expect(decodeProtectedHeader(stepUpToken)).toEqual({
      alg: 'ES256',
      kid: 'kd-test-1',
      typ: STEP_UP_TOKEN_TYPE,
    });
    const issuedAt = now.getTime() / 1000;
    expect(decodeJwt(stepUpToken)).toEqual({
      iss: ACCESS_TOKEN_ISSUER,
      aud: STEP_UP_AUDIENCE,
      sub: ADMIN_ID,
      purpose: 'settings.payment',
      iat: issuedAt,
      exp: issuedAt + STEP_UP_TTL_SECONDS,
    });
    expect(expiresAt.toISOString()).toBe('2026-11-07T03:05:00.000Z');
  });

  it('differs from the access token in typ and audience', () => {
    expect(STEP_UP_TOKEN_TYPE).not.toBe(ACCESS_TOKEN_TYPE);
    expect(STEP_UP_AUDIENCE).not.toBe(ACCESS_TOKEN_AUDIENCE);
    expect(STEP_UP_TTL_SECONDS).toBe(5 * 60);
  });

  it('verifies until exp plus the 5 s tolerance, then refuses', async () => {
    const clock = new FixedClock(NOW);
    const { stepUpToken } = await signStepUpToken(keys, clock.now(), ADMIN_ID, 'settings.payment');

    const valid = { userId: ADMIN_ID, purpose: 'settings.payment' };

    clock.advance((STEP_UP_TTL_SECONDS - 1) * 1000);
    expect(await verifyStepUpToken(keys, clock.now(), stepUpToken)).toEqual(valid);
    // 4 s past exp: inside the 5 s tolerance of decision 0008 section 9.
    clock.advance(5000);
    expect(await verifyStepUpToken(keys, clock.now(), stepUpToken)).toEqual(valid);
    // 6 s past exp: refused.
    clock.advance(2000);
    expect(await verifyStepUpToken(keys, clock.now(), stepUpToken)).toBeNull();
  });

  it('refuses an access token and an MFA challenge token signed with the same key', async () => {
    const clock = new FixedClock(NOW);
    const { token: accessToken } = await new AccessTokenService(keys, clock).sign({
      userId: ADMIN_ID,
      role: 'ADMIN',
      sessionId: SESSION_ID,
    });
    const { token: challenge } = await signMfaToken(
      keys,
      clock.now(),
      MFA_CHALLENGE_TOKEN_TYPE,
      ADMIN_ID,
    );

    expect(await verifyStepUpToken(keys, clock.now(), accessToken)).toBeNull();
    expect(await verifyStepUpToken(keys, clock.now(), challenge)).toBeNull();
  });

  it('is refused as an access token', async () => {
    const clock = new FixedClock(NOW);
    const { stepUpToken } = await signStepUpToken(keys, clock.now(), ADMIN_ID, 'settings.payment');

    await expect(new AccessTokenService(keys, clock).verify(stepUpToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('refuses a token signed by another key under the same kid, and garbage', async () => {
    const now = new Date(NOW);
    const { stepUpToken } = await signStepUpToken(foreignKeys, now, ADMIN_ID, 'settings.payment');

    expect(await verifyStepUpToken(keys, now, stepUpToken)).toBeNull();
    expect(await verifyStepUpToken(keys, now, 'not.a.jwt')).toBeNull();
    expect(await verifyStepUpToken(keys, now, '')).toBeNull();
  });
});

describe('StepUpService', () => {
  let keys: KeySet;

  beforeAll(async () => {
    keys = await keySetOf(ephemeralKeys('kd-test-2'));
  });

  const EM = {} as EntityManager;

  function admin(overrides: Partial<User> = {}): User {
    return { id: ADMIN_ID, role: 'ADMIN', status: 'ACTIVE', ...overrides } as User;
  }

  interface Harness {
    service: StepUpService;
    written: AuditEntry[];
    failures: CodeFailureAudit[];
    verifyCurrentCode: ReturnType<typeof vi.fn>;
  }

  /** `MfaService.verifyCurrentCode` accepting the code (runs `then`) or refusing it. */
  function harness(stored: User | null, accept = true): Harness {
    const written: AuditEntry[] = [];
    const failures: CodeFailureAudit[] = [];
    const verifyCurrentCode = vi.fn(
      async (user: User, _code: string, failure: CodeFailureAudit, then: InTransaction<void>) => {
        failures.push(failure);
        if (!accept) {
          throw new ApiError('CODE_INVALID');
        }
        await then(EM, user);
      },
    );
    const mfa = { verifyCurrentCode } as unknown as MfaService;
    const users = { findById: () => Promise.resolve(stored) } as unknown as UsersService;
    const audit = {
      write: (entry: AuditEntry) => {
        written.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditService;
    const service = new StepUpService(mfa, users, keys, audit, new FixedClock(NOW));
    return { service, written, failures, verifyCurrentCode };
  }

  const actor = { id: ADMIN_ID, role: 'ADMIN' as const, sessionId: SESSION_ID };

  it('grants a token for the purpose and audits step_up_succeeded without the code or token', async () => {
    const { service, written, failures } = harness(admin());

    const grant = await service.grant(actor, '123456', 'settings.payment');

    expect(await verifyStepUpToken(keys, new Date(NOW), grant.stepUpToken)).toEqual({
      userId: ADMIN_ID,
      purpose: 'settings.payment',
    });
    expect(written).toEqual([
      {
        actorUserId: ADMIN_ID,
        action: STEP_UP_AUDIT.succeeded,
        entityType: 'USER',
        entityId: ADMIN_ID,
        diff: { purpose: 'settings.payment' },
      },
    ]);
    expect(JSON.stringify(written)).not.toContain('123456');
    expect(JSON.stringify(written)).not.toContain(grant.stepUpToken);
    expect(failures).toEqual([
      {
        action: STEP_UP_AUDIT.failed,
        actorUserId: ADMIN_ID,
        diff: { purpose: 'settings.payment' },
      },
    ]);
  });

  it('passes CODE_INVALID through and signs nothing', async () => {
    const { service, written } = harness(admin(), false);

    await expect(service.grant(actor, '000000', 'settings.payment')).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
    expect(written).toEqual([]);
  });

  it.each([
    ['no row', null, 'UNAUTHENTICATED'],
    ['a suspended account', admin({ status: 'SUSPENDED' }), 'UNAUTHENTICATED'],
    ['a demoted account', admin({ role: 'MANAGER' }), 'FORBIDDEN'],
  ] as const)('refuses %s before any code is checked', async (_case, stored, code) => {
    const { service, verifyCurrentCode } = harness(stored);

    await expect(service.grant(actor, '123456', 'settings.payment')).rejects.toMatchObject({
      code,
    });
    expect(verifyCurrentCode).not.toHaveBeenCalled();
  });

  it('verifies a token of the same user and purpose only', async () => {
    const { service } = harness(admin());
    const { stepUpToken } = await signStepUpToken(
      keys,
      new Date(NOW),
      ADMIN_ID,
      'settings.payment',
    );

    expect(await service.verify(stepUpToken, ADMIN_ID, 'settings.payment')).toBe(true);
    expect(await service.verify(stepUpToken, OTHER_ID, 'settings.payment')).toBe(false);
  });
});
