import { generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import type { AuditService } from '../audit/audit.service.js';
import { User } from '../users/entities/user.entity.js';
import type { PasswordHasher } from '../users/password-hasher.js';
import type { UsersService } from '../users/users.service.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  AccessTokenService,
} from './access-token.service.js';
import {
  ADMIN_AUTH_AUDIT,
  AdminAuthService,
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_CHALLENGE_TTL_SECONDS,
  MFA_ENROLMENT_TOKEN_TYPE,
  MFA_ENROLMENT_TTL_SECONDS,
  secondFactorOf,
  staffSignInPath,
} from './admin-auth.service.js';
import type { MfaCredential } from './entities/mfa-credential.entity.js';
import type { RefreshToken } from './entities/refresh-token.entity.js';
import { KeySet } from './key-set.js';
import { signMfaToken } from './mfa/mfa-tokens.js';
import type { MfaTokenType } from './mfa/mfa-tokens.js';
import type { InTransaction, MfaService, SecondFactor } from './mfa/mfa.service.js';
import type { RefreshTokenService, SessionTokens } from './refresh-token.service.js';

const NOW = '2026-11-07T03:00:00.000Z';
const USER_ID = '01930000-0000-7000-8000-000000000e01';
const FAMILY_ID = '01930000-0000-7000-8000-000000000e02';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';
const WRONG = 'kd-fixture-wrong-passphrase';
const fakeHashOf = (password: string): string => `fake-hash:${password}`;
const COOKIE_TOKEN = 'kdFixtureRefreshToken_0123456789-abcdefghij';

function account(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'fixture-staff@kd.example',
    passwordHash: fakeHashOf(PASSPHRASE),
    displayName: 'Nhân viên mẫu',
    phone: null,
    avatarUrl: null,
    locale: 'vi',
    role: 'STAFF',
    status: 'ACTIVE',
    preferredBranchId: null,
    emailVerifiedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  });
}

const LOCKED_UNTIL = new Date(new Date(NOW).getTime() + 15 * 60 * 1000);

describe('staffSignInPath (identical-response mapping)', () => {
  const now = new Date(NOW);

  it.each([
    ['an unknown email', null, null],
    ['a CUSTOMER account', account({ role: 'CUSTOMER' }), null],
    ['an INVITED staff account', account({ status: 'INVITED', passwordHash: null }), 'NOT_ACTIVE'],
    ['a DELETED staff account', account({ status: 'DELETED' }), 'NOT_ACTIVE'],
    ['a staff account without a password', account({ passwordHash: null }), 'NO_PASSWORD'],
    ['a locked staff account', account({ lockedUntil: LOCKED_UNTIL }), 'LOCKED'],
    [
      'a locked SUSPENDED account',
      account({ status: 'SUSPENDED', lockedUntil: LOCKED_UNTIL }),
      'LOCKED',
    ],
  ] as const)('refuses %s before any password check', (_case, user, failure) => {
    expect(staffSignInPath(user, now)).toEqual({ kind: 'refuse', user, failure });
  });

  it.each(['STAFF', 'MANAGER', 'ADMIN'] as const)('checks the password of an ACTIVE %s', (role) => {
    const user = account({ role });

    expect(staffSignInPath(user, now)).toEqual({
      kind: 'verify',
      user,
      passwordHash: fakeHashOf(PASSPHRASE),
    });
  });

  it('checks the password of a SUSPENDED account (ACCOUNT_SUSPENDED only after it)', () => {
    expect(staffSignInPath(account({ status: 'SUSPENDED' }), now).kind).toBe('verify');
  });

  it('checks the password again once the lock has ended', () => {
    expect(staffSignInPath(account({ lockedUntil: now }), now).kind).toBe('verify');
  });
});

describe('AdminAuthService', () => {
  let clock: FixedClock;
  let stored: User | null;
  let credential: Pick<MfaCredential, 'userId' | 'enabledAt'> | null;
  let tokenRow: Pick<RefreshToken, 'userId' | 'familyId' | 'revokedAt'> | null;
  let em: { update: ReturnType<typeof vi.fn> };
  let dataSource: {
    transaction: ReturnType<typeof vi.fn>;
    manager: { findOne: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  let users: {
    findByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    recordFailedLogin: ReturnType<typeof vi.fn>;
    recordSuccessfulLogin: ReturnType<typeof vi.fn>;
  };
  let hasher: {
    verify: ReturnType<typeof vi.fn>;
    verifyOrDummy: ReturnType<typeof vi.fn>;
    needsRehash: ReturnType<typeof vi.fn>;
    hash: ReturnType<typeof vi.fn>;
  };
  let tokens: {
    issue: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    revokeFamily: ReturnType<typeof vi.fn>;
  };
  let audit: { write: ReturnType<typeof vi.fn> };
  let mfa: {
    isEnrolled: ReturnType<typeof vi.fn>;
    recordRequested: ReturnType<typeof vi.fn>;
    verifySecondFactor: ReturnType<typeof vi.fn>;
  };
  let keys: KeySet;
  let publicPem: string;
  let service: AdminAuthService;

  function sessionTokens(role: SessionTokens['role'] = 'STAFF'): SessionTokens {
    return {
      userId: USER_ID,
      role,
      sessionId: FAMILY_ID,
      accessToken: 'fake-access-token',
      accessTokenExpiresAt: new Date(clock.now().getTime() + 15 * 60 * 1000),
      refreshToken: COOKIE_TOKEN,
      refreshTokenExpiresAt: new Date(clock.now().getTime() + 24 * 60 * 60 * 1000),
    };
  }

  beforeEach(async () => {
    clock = new FixedClock(NOW);
    stored = account();
    credential = null;
    tokenRow = { userId: USER_ID, familyId: FAMILY_ID, revokedAt: null };
    em = { update: vi.fn(() => Promise.resolve({})) };
    dataSource = {
      transaction: vi.fn((work: (manager: unknown) => Promise<unknown>) => work(em)),
      manager: {
        findOne: vi.fn(() => Promise.resolve(tokenRow)),
        update: vi.fn(() => Promise.resolve({})),
      },
    };
    users = {
      findByEmail: vi.fn(() => Promise.resolve(stored)),
      findById: vi.fn(() => Promise.resolve(stored)),
      recordFailedLogin: vi.fn(() =>
        Promise.resolve({ counted: true, failedLoginCount: 1, lockedUntil: null }),
      ),
      recordSuccessfulLogin: vi.fn(() => Promise.resolve()),
    };
    hasher = {
      verify: vi.fn((hash: string, password: string) =>
        Promise.resolve(hash === fakeHashOf(password)),
      ),
      verifyOrDummy: vi.fn(() => Promise.resolve(false)),
      needsRehash: vi.fn(() => false),
      hash: vi.fn((password: string) => Promise.resolve(fakeHashOf(password))),
    };
    tokens = {
      issue: vi.fn(() => Promise.resolve(sessionTokens())),
      rotate: vi.fn(() => Promise.resolve(sessionTokens())),
      revokeFamily: vi.fn(() => Promise.resolve()),
    };
    audit = { write: vi.fn(() => Promise.resolve()) };
    mfa = {
      isEnrolled: vi.fn(() =>
        Promise.resolve(credential !== null && credential.enabledAt !== null),
      ),
      recordRequested: vi.fn(() => Promise.resolve()),
      // Runs the session work as the real service does, inside its transaction.
      verifySecondFactor: vi.fn(
        async (_userId: string, _factor: SecondFactor, then: InTransaction<unknown>) => ({
          value: await then(em as never, stored ?? account()),
          recoveryCodesLeft: 7,
        }),
      ),
    };

    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
    keys = new KeySet({
      keyId: 'kd-spec-admin',
      privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
      publicKey: base64(publicPem),
      previousPublicKeys: [],
    });
    await keys.onModuleInit();

    service = new AdminAuthService(
      dataSource as unknown as DataSource,
      users as unknown as UsersService,
      hasher as unknown as PasswordHasher,
      tokens as unknown as RefreshTokenService,
      keys,
      audit as unknown as AuditService,
      clock,
      mfa as unknown as MfaService,
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
    const error = await promise.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  /** Everything the client sees of an error: code, status, detail, field errors, extras. */
  function seen(error: ApiError): unknown {
    return {
      code: error.code,
      status: error.status,
      detail: error.detail,
      errors: error.errors,
      extras: error.extras,
    };
  }

  describe('login', () => {
    it('answers the same INVALID_CREDENTIALS for every refusal, with the dummy hash where no password is checked', async () => {
      const wrong = seen(await failureOf(service.login({ email: 'x', password: WRONG }, {})));
      expect(wrong).toEqual({
        code: 'INVALID_CREDENTIALS',
        status: 401,
        detail: undefined,
        errors: undefined,
        extras: {},
      });

      for (const user of [
        null,
        account({ role: 'CUSTOMER' }),
        account({ status: 'INVITED', passwordHash: null }),
        account({ status: 'DELETED' }),
        account({ passwordHash: null }),
        account({ lockedUntil: LOCKED_UNTIL }),
        account({ status: 'SUSPENDED', lockedUntil: LOCKED_UNTIL }),
      ]) {
        stored = user;
        hasher.verifyOrDummy.mockClear();
        const refused = await failureOf(
          service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}),
        );
        expect(seen(refused)).toEqual(wrong);
        expect(hasher.verifyOrDummy).toHaveBeenCalledWith(null, PASSPHRASE);
      }
      // Only the real wrong password was counted; no session was issued.
      expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('never audits an unknown email or a customer account', async () => {
      for (const user of [null, account({ role: 'CUSTOMER' })]) {
        stored = user;
        await failureOf(service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}));
      }
      expect(audit.write).not.toHaveBeenCalled();
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
    });

    it.each([
      ['an INVITED account', account({ status: 'INVITED', passwordHash: null }), 'NOT_ACTIVE'],
      ['a locked account', account({ lockedUntil: LOCKED_UNTIL }), 'LOCKED'],
    ] as const)('audits %s without counting it', async (_case, user, reason) => {
      stored = user;
      await failureOf(service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}));

      expect(users.recordFailedLogin).not.toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalledWith({
        actorUserId: null,
        action: ADMIN_AUTH_AUDIT.loginFailed,
        entityType: 'USER',
        entityId: USER_ID,
        diff: { reason },
      });
    });

    it('counts a wrong password and audits it with no password in the diff', async () => {
      await failureOf(service.login({ email: 'fixture@kd.example', password: WRONG }, {}));

      expect(users.recordFailedLogin).toHaveBeenCalledWith(USER_ID, em);
      expect(audit.write).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: null,
          action: ADMIN_AUTH_AUDIT.loginFailed,
          entityType: 'USER',
          entityId: USER_ID,
          diff: { reason: 'WRONG_PASSWORD', failedLoginCount: 1 },
        },
        em,
      );
      expect(JSON.stringify(audit.write.mock.calls)).not.toContain(WRONG);
    });

    it('audits the lock in the same transaction, and the error does not reveal it', async () => {
      users.recordFailedLogin.mockResolvedValue({
        counted: true,
        failedLoginCount: 5,
        lockedUntil: LOCKED_UNTIL,
      });

      const error = await failureOf(
        service.login({ email: 'fixture@kd.example', password: WRONG }, {}),
      );

      expect(seen(error)).toEqual({
        code: 'INVALID_CREDENTIALS',
        status: 401,
        detail: undefined,
        errors: undefined,
        extras: {},
      });
      expect(audit.write.mock.calls.map(([entry]) => (entry as { action: string }).action)).toEqual(
        [ADMIN_AUTH_AUDIT.loginFailed, ADMIN_AUTH_AUDIT.accountLocked],
      );
      expect(audit.write.mock.calls.every(([, manager]) => manager === em)).toBe(true);
    });

    it('answers ACCOUNT_SUSPENDED only after the right password', async () => {
      stored = account({ status: 'SUSPENDED' });

      const wrong = await failureOf(
        service.login({ email: 'fixture@kd.example', password: WRONG }, {}),
      );
      expect(wrong.code).toBe('INVALID_CREDENTIALS');

      const right = await failureOf(
        service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}),
      );
      expect(right.code).toBe('ACCOUNT_SUSPENDED');
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('signs a STAFF account in: session, counters cleared, audited, no refresh token in the body', async () => {
      const signIn = await service.login(
        { email: 'fixture@kd.example', password: PASSPHRASE },
        { client: 'admin-web' },
      );

      expect(signIn).toEqual({
        session: {
          accessToken: 'fake-access-token',
          expiresIn: 900,
          user: { id: USER_ID, displayName: 'Nhân viên mẫu', role: 'STAFF' },
        },
        refreshToken: COOKIE_TOKEN,
        refreshTokenExpiresAt: new Date(new Date(NOW).getTime() + 24 * 60 * 60 * 1000),
      });
      expect(JSON.stringify(signIn.session)).not.toContain(COOKIE_TOKEN);
      expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(USER_ID, em);
      expect(tokens.issue).toHaveBeenCalledWith(USER_ID, { deviceLabel: 'admin-web' }, em);
      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: USER_ID,
          action: ADMIN_AUTH_AUDIT.loginSucceeded,
          entityType: 'USER',
          entityId: USER_ID,
        },
        em,
      );
    });

    it.each(['MANAGER', 'ADMIN'] as const)(
      'answers MFA_REQUIRED with a challenge token to an enrolled %s, without a session',
      async (role) => {
        stored = account({ role, failedLoginCount: 2 });
        credential = { userId: USER_ID, enabledAt: new Date('2026-10-01T00:00:00Z') };

        const error = await failureOf(
          service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}),
        );

        expect(error.code).toBe('MFA_REQUIRED');
        expect(error.status).toBe(403);
        expect(error.extras).toEqual({
          mfaToken: expect.any(String),
          mfaEnrolled: true,
          expiresIn: MFA_CHALLENGE_TTL_SECONDS,
        });
        const token = error.extras['mfaToken'] as string;
        expect(decodeProtectedHeader(token)).toEqual({
          alg: 'ES256',
          kid: 'kd-spec-admin',
          typ: MFA_CHALLENGE_TOKEN_TYPE,
        });
        const { payload } = await jwtVerify(token, await importSPKI(publicPem, 'ES256'), {
          issuer: ACCESS_TOKEN_ISSUER,
          audience: ACCESS_TOKEN_AUDIENCE,
          typ: MFA_CHALLENGE_TOKEN_TYPE,
          currentDate: clock.now(),
        });
        expect(payload).toEqual({
          iss: ACCESS_TOKEN_ISSUER,
          aud: ACCESS_TOKEN_AUDIENCE,
          sub: USER_ID,
          iat: Math.floor(new Date(NOW).getTime() / 1000),
          exp: Math.floor(new Date(NOW).getTime() / 1000) + MFA_CHALLENGE_TTL_SECONDS,
        });

        // No session, no counter reset and no last_login_at before the second factor (A3-T2).
        expect(tokens.issue).not.toHaveBeenCalled();
        expect(users.recordSuccessfulLogin).not.toHaveBeenCalled();
        expect(audit.write).not.toHaveBeenCalled();
        // The second step is requested and audited (brief E17).
        expect(mfa.recordRequested).toHaveBeenCalledWith(USER_ID, true);
      },
    );

    it('answers MFA_REQUIRED with the enrolment token when the second factor is not enabled', async () => {
      stored = account({ role: 'ADMIN' });
      credential = { userId: USER_ID, enabledAt: null };

      const error = await failureOf(
        service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}),
      );

      expect(error.extras).toMatchObject({
        mfaEnrolled: false,
        expiresIn: MFA_ENROLMENT_TTL_SECONDS,
      });
      expect(decodeProtectedHeader(error.extras['mfaToken'] as string).typ).toBe(
        MFA_ENROLMENT_TOKEN_TYPE,
      );
      expect(mfa.recordRequested).toHaveBeenCalledWith(USER_ID, false);
    });

    it('issues MFA tokens that the access-token verifier refuses', async () => {
      const access = new AccessTokenService(keys, clock);
      for (const enabledAt of [new Date('2026-10-01T00:00:00Z'), null]) {
        stored = account({ role: 'MANAGER' });
        credential = enabledAt === null ? null : { userId: USER_ID, enabledAt };
        const error = await failureOf(
          service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {}),
        );

        const refused = await failureOf(access.verify(error.extras['mfaToken'] as string));
        expect(refused.code).toBe('UNAUTHENTICATED');
      }
    });

    it('re-hashes a password stored with older parameters', async () => {
      hasher.needsRehash.mockReturnValue(true);

      await service.login({ email: 'fixture@kd.example', password: PASSPHRASE }, {});

      expect(em.update).toHaveBeenCalledWith(
        User,
        { id: USER_ID, passwordHash: fakeHashOf(PASSPHRASE) },
        { passwordHash: fakeHashOf(PASSPHRASE) },
      );
    });
  });

  describe('refresh', () => {
    it('refuses a missing cookie without touching the database', async () => {
      expect((await failureOf(service.refresh(undefined))).code).toBe('UNAUTHENTICATED');
      expect(dataSource.manager.findOne).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown token', null, account()],
      ['a CUSTOMER token', tokenRowOf(), account({ role: 'CUSTOMER' })],
      ['a SUSPENDED staff member', tokenRowOf(), account({ status: 'SUSPENDED' })],
    ])('refuses %s without consuming it', async (_case, row, owner) => {
      tokenRow = row;
      stored = owner;

      expect((await failureOf(service.refresh(COOKIE_TOKEN))).code).toBe('UNAUTHENTICATED');
      expect(tokens.rotate).not.toHaveBeenCalled();
    });

    it.each(['MANAGER', 'ADMIN'] as const)(
      'refuses a %s without a confirmed second factor, without consuming the token',
      async (role) => {
        stored = account({ role });
        credential = { userId: USER_ID, enabledAt: null };

        expect((await failureOf(service.refresh(COOKIE_TOKEN))).code).toBe('UNAUTHENTICATED');
        expect(tokens.rotate).not.toHaveBeenCalled();
      },
    );

    it('rotates the token of an enrolled MANAGER', async () => {
      stored = account({ role: 'MANAGER' });
      credential = { userId: USER_ID, enabledAt: new Date('2026-10-01T00:00:00Z') };
      tokens.rotate.mockResolvedValue(sessionTokens('MANAGER'));

      const signIn = await service.refresh(COOKIE_TOKEN);

      expect(signIn.session.user.role).toBe('MANAGER');
    });

    it('rotates a staff token and returns the session for the new cookie', async () => {
      const signIn = await service.refresh(COOKIE_TOKEN);

      expect(tokens.rotate).toHaveBeenCalledWith(COOKIE_TOKEN);
      expect(signIn.session.user).toEqual({
        id: USER_ID,
        displayName: 'Nhân viên mẫu',
        role: 'STAFF',
      });
      expect(signIn.refreshToken).toBe(COOKIE_TOKEN);
    });
  });

  describe('verifySecondStep', () => {
    async function challengeFor(type: MfaTokenType = MFA_CHALLENGE_TOKEN_TYPE): Promise<string> {
      return (await signMfaToken(keys, clock.now(), type, USER_ID)).token;
    }

    it('starts the session in the transaction that spends the code, with the codes left', async () => {
      stored = account({ role: 'ADMIN', failedLoginCount: 3 });
      tokens.issue.mockResolvedValue(sessionTokens('ADMIN'));

      const signIn = await service.verifySecondStep(
        { challenge: await challengeFor(), code: '123456' },
        { client: 'admin-web' },
      );

      expect(mfa.verifySecondFactor).toHaveBeenCalledWith(
        USER_ID,
        { method: 'TOTP', code: '123456' },
        expect.any(Function),
      );
      expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(USER_ID, em);
      expect(tokens.issue).toHaveBeenCalledWith(USER_ID, { deviceLabel: 'admin-web' }, em);
      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: USER_ID,
          action: ADMIN_AUTH_AUDIT.loginSucceeded,
          entityType: 'USER',
          entityId: USER_ID,
        },
        em,
      );
      expect(signIn.session.user).toEqual({
        id: USER_ID,
        displayName: 'Nhân viên mẫu',
        role: 'ADMIN',
      });
      expect(signIn.recoveryCodesLeft).toBe(7);
      expect(signIn.refreshToken).toBe(COOKIE_TOKEN);
      expect(signIn.session).not.toHaveProperty('refreshToken');
    });

    it('passes a recovery code as such', async () => {
      stored = account({ role: 'MANAGER' });

      await service.verifySecondStep(
        { challenge: await challengeFor(), recoveryCode: 'ABCDE-12345' },
        {},
      );

      expect(mfa.verifySecondFactor).toHaveBeenCalledWith(
        USER_ID,
        { method: 'RECOVERY_CODE', code: 'ABCDE-12345' },
        expect.any(Function),
      );
    });

    it.each([
      ['garbage', async () => 'not.a.jwt'],
      ['the enrolment token', () => challengeFor(MFA_ENROLMENT_TOKEN_TYPE)],
      [
        'an access token',
        async () =>
          (
            await new AccessTokenService(keys, clock).sign({
              userId: USER_ID,
              role: 'ADMIN',
              sessionId: FAMILY_ID,
            })
          ).token,
      ],
    ])(
      'refuses %s as the challenge with UNAUTHENTICATED, checking no code',
      async (_case, make) => {
        const error = await failureOf(
          service.verifySecondStep({ challenge: await make(), code: '123456' }, {}),
        );

        expect(seen(error)).toEqual({
          code: 'UNAUTHENTICATED',
          status: 401,
          detail: undefined,
          errors: undefined,
          extras: {},
        });
        expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
      },
    );

    it('refuses an expired challenge', async () => {
      const challenge = await challengeFor();
      clock.advance((MFA_CHALLENGE_TTL_SECONDS + 60) * 1000);

      expect(
        (await failureOf(service.verifySecondStep({ challenge, code: '123456' }, {}))).code,
      ).toBe('UNAUTHENTICATED');
      expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the family and audits it with the token owner as actor', async () => {
      await service.logout(COOKIE_TOKEN);

      expect(tokens.revokeFamily).toHaveBeenCalledWith(FAMILY_ID, em);
      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: USER_ID,
          action: ADMIN_AUTH_AUDIT.logout,
          entityType: 'USER',
          entityId: USER_ID,
        },
        em,
      );
    });

    it.each([
      ['no cookie', undefined, tokenRowOf()],
      ['an unknown token', COOKIE_TOKEN, null],
      ['a revoked token', COOKIE_TOKEN, { ...tokenRowOf(), revokedAt: new Date(NOW) }],
    ])('changes nothing for %s', async (_case, cookie, row) => {
      tokenRow = row;

      await expect(service.logout(cookie)).resolves.toBeUndefined();
      expect(tokens.revokeFamily).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });
});

function tokenRowOf(): Pick<RefreshToken, 'userId' | 'familyId' | 'revokedAt'> {
  return { userId: USER_ID, familyId: FAMILY_ID, revokedAt: null };
}

describe('secondFactorOf', () => {
  it.each([
    ['neither code', {}],
    ['both codes', { code: '123456', recoveryCode: 'ABCDE-12345' }],
  ])('refuses %s with VALIDATION_FAILED on both fields', (_case, codes) => {
    let thrown: unknown;
    try {
      secondFactorOf({ challenge: 'x', ...codes });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('VALIDATION_FAILED');
    expect((thrown as ApiError).errors?.map((error) => error.field)).toEqual([
      'code',
      'recoveryCode',
    ]);
    expect(JSON.stringify((thrown as ApiError).errors)).not.toContain('123456');
  });
});
