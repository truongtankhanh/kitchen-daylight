import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../common/errors/api-error.js';
import { FixedClock } from '../../../common/time/testing.js';
import type { ServerConfig } from '../../../config/load-config.js';
import type { AuditService } from '../../audit/audit.service.js';
import { User } from '../../users/entities/user.entity.js';
import type { PasswordHasher } from '../../users/password-hasher.js';
import type { UsersService } from '../../users/users.service.js';
import { MfaCredential } from '../entities/mfa-credential.entity.js';
import { MFA_AUDIT, MfaService } from './mfa.service.js';
import { mfaKeyIdOf, SecretCipher } from './secret-cipher.js';
import { totpStep } from './totp.js';

const NOW = '2026-11-07T03:00:10.000Z';
const USER_ID = '01930000-0000-7000-8000-000000000f11';
const DISPLAYED_CODE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
const LOCKED_UNTIL = new Date(new Date(NOW).getTime() + 15 * 60 * 1000);

/** One recorded query-builder statement. */
interface Statement {
  kind: 'insert' | 'update';
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  where: string[];
  params: Record<string, unknown>;
  returning?: string;
}

interface StatementResult {
  readonly raw?: unknown[];
  readonly affected?: number;
}

/** A chainable stand-in for TypeORM's query builder that records what is executed. */
function fakeBuilder(statements: Statement[], results: StatementResult[]): unknown {
  const statement: Statement = { kind: 'update', where: [], params: {} };
  const condition = (where: string, params: Record<string, unknown> = {}): unknown => {
    statement.where.push(where);
    Object.assign(statement.params, params);
    return builder;
  };
  const builder = {
    insert: () => ((statement.kind = 'insert'), builder),
    into: () => builder,
    values: (values: Record<string, unknown>) => ((statement.values = values), builder),
    orIgnore: () => builder,
    update: () => ((statement.kind = 'update'), builder),
    set: (set: Record<string, unknown>) => ((statement.set = set), builder),
    where: condition,
    andWhere: condition,
    returning: (returning: string) => ((statement.returning = returning), builder),
    updateEntity: () => builder,
    execute: () => {
      statements.push(statement);
      return Promise.resolve(results.shift() ?? { raw: [], affected: 0 });
    },
  };
  return builder;
}

function account(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'fixture-manager@kitchendaylight.example',
    passwordHash: 'fake-hash',
    displayName: 'Quản lý mẫu',
    role: 'MANAGER',
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    ...overrides,
  });
}

describe('MfaService', () => {
  let clock: FixedClock;
  let statements: Statement[];
  let results: StatementResult[];
  let credential: MfaCredential | null;
  let stored: User | null;
  let em: { createQueryBuilder: () => unknown };
  let dataSource: {
    createQueryBuilder: () => unknown;
    transaction: ReturnType<typeof vi.fn>;
    manager: { findOne: ReturnType<typeof vi.fn> };
  };
  let users: { findById: ReturnType<typeof vi.fn>; recordFailedLogin: ReturnType<typeof vi.fn> };
  let hasher: { hash: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
  let audit: { write: ReturnType<typeof vi.fn> };
  let key: Buffer;
  let cipher: SecretCipher;
  let secret: Buffer;
  let service: MfaService;

  function credentialOf(overrides: Partial<MfaCredential> = {}): MfaCredential {
    return Object.assign(new MfaCredential(), {
      userId: USER_ID,
      secretEncrypted: cipher.encrypt(secret, USER_ID),
      enabledAt: new Date('2026-10-01T00:00:00Z'),
      lastUsedStep: null,
      recoveryCodeHashes: ['fake-phc:ABCDE12345', 'fake-phc:FGHJK67890'],
      createdAt: new Date('2026-10-01T00:00:00Z'),
      ...overrides,
    });
  }

  /** The code an authenticator app shows now, `offsetSteps` away. */
  function codeNow(offsetSteps = 0): string {
    return TOTP.generate({
      secret: new Secret({ buffer: Uint8Array.from(secret).buffer }),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      timestamp: clock.now().getTime() + offsetSteps * 30_000,
    });
  }

  async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
    const error = await promise.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  function auditedActions(): string[] {
    return audit.write.mock.calls.map(([entry]) => (entry as { action: string }).action);
  }

  /** Every audit diff and log argument, as text: no code, secret or hash may appear in it. */
  function everythingRecorded(): string {
    return JSON.stringify([
      audit.write.mock.calls,
      vi.mocked(Logger.prototype.log).mock.calls,
      vi.mocked(Logger.prototype.warn).mock.calls,
    ]);
  }

  beforeEach(() => {
    clock = new FixedClock(NOW);
    statements = [];
    results = [];
    key = randomBytes(32);
    cipher = new SecretCipher(key);
    secret = randomBytes(20);
    credential = credentialOf();
    stored = account();
    em = { createQueryBuilder: () => fakeBuilder(statements, results) };
    dataSource = {
      createQueryBuilder: () => fakeBuilder(statements, results),
      transaction: vi.fn((work: (manager: unknown) => Promise<unknown>) => work(em)),
      manager: { findOne: vi.fn(() => Promise.resolve(credential)) },
    };
    users = {
      findById: vi.fn(() => Promise.resolve(stored)),
      recordFailedLogin: vi.fn(() =>
        Promise.resolve({ counted: true, failedLoginCount: 1, lockedUntil: null }),
      ),
    };
    hasher = {
      hash: vi.fn((code: string) => Promise.resolve(`fake-phc:${code}`)),
      verify: vi.fn((hash: string, code: string) => Promise.resolve(hash === `fake-phc:${code}`)),
    };
    audit = { write: vi.fn(() => Promise.resolve()) };
    service = new MfaService(
      dataSource as unknown as DataSource,
      users as unknown as UsersService,
      hasher as unknown as PasswordHasher,
      cipher,
      audit as unknown as AuditService,
      clock,
      { appEnv: 'test' } as ServerConfig,
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('requireMfaUser', () => {
    it.each(['MANAGER', 'ADMIN'] as const)('returns an ACTIVE %s', async (role) => {
      stored = account({ role });

      await expect(service.requireMfaUser(USER_ID, 'FORBIDDEN')).resolves.toBe(stored);
    });

    it.each([
      ['an unknown user', null],
      ['a STAFF account (cannot enrol)', account({ role: 'STAFF' })],
      ['a CUSTOMER', account({ role: 'CUSTOMER' })],
      ['an INVITED manager', account({ status: 'INVITED' })],
      ['a SUSPENDED manager', account({ status: 'SUSPENDED' })],
    ])('refuses %s with the given code', async (_case, user) => {
      stored = user;

      expect((await failureOf(service.requireMfaUser(USER_ID, 'FORBIDDEN'))).code).toBe(
        'FORBIDDEN',
      );
      expect((await failureOf(service.requireMfaUser(USER_ID, 'UNAUTHENTICATED'))).code).toBe(
        'UNAUTHENTICATED',
      );
    });
  });

  describe('setup', () => {
    it('stores a new secret encrypted for the user and returns it once with the URI', async () => {
      results = [{ raw: [{ user_id: USER_ID }] }];

      const setup = await service.setup(account());

      expect(statements).toHaveLength(1);
      const inserted = statements[0]?.values ?? {};
      expect(inserted['userId']).toBe(USER_ID);
      const encrypted = inserted['secretEncrypted'] as string;
      expect(encrypted).toMatch(/^v1\.[0-9a-f]{16}\./);
      expect(encrypted).not.toContain(setup.secret);
      const { plaintext } = cipher.decrypt(encrypted, USER_ID);
      expect(new Secret({ buffer: Uint8Array.from(plaintext).buffer }).base32).toBe(setup.secret);
      expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.otpauthUri).toContain('otpauth://totp/Kitchen%20Daylight%20(test):');
      expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
      expect(audit.write).not.toHaveBeenCalled();
      expect(everythingRecorded()).not.toContain(setup.secret);
    });

    it('replaces a pending credential: new secret, no step, no codes', async () => {
      results = [{ raw: [] }, { affected: 1 }];

      await service.setup(account());

      expect(statements[1]).toMatchObject({
        kind: 'update',
        set: { lastUsedStep: null, recoveryCodeHashes: [] },
        where: ['user_id = :id AND enabled_at IS NULL'],
      });
    });

    it('never replaces an enabled credential: ALREADY_EXISTS', async () => {
      results = [{ raw: [] }, { affected: 0 }];

      expect((await failureOf(service.setup(account()))).code).toBe('ALREADY_EXISTS');
    });
  });

  describe('confirm', () => {
    beforeEach(() => {
      credential = credentialOf({ enabledAt: null, recoveryCodeHashes: [] });
    });

    it('enables the credential, claims the step, stores ten hashed codes and runs the session work', async () => {
      results = [{ raw: [{ recovery_codes_left: 10 }] }];
      const then = vi.fn(() => Promise.resolve('session'));

      const enrolment = await service.confirm(account(), codeNow(), then);

      expect(enrolment.value).toBe('session');
      expect(then).toHaveBeenCalledWith(em, expect.objectContaining({ id: USER_ID }));
      expect(enrolment.recoveryCodes).toHaveLength(10);
      for (const code of enrolment.recoveryCodes) {
        expect(code).toMatch(DISPLAYED_CODE);
      }
      const claim = statements[0];
      expect(claim?.set).toMatchObject({
        enabledAt: clock.now(),
        lastUsedStep: totpStep(clock.now()),
        recoveryCodeHashes: enrolment.recoveryCodes.map(
          (code) => `fake-phc:${code.replace('-', '')}`,
        ),
      });
      expect(claim?.where).toEqual([
        'user_id = :id',
        'secret_encrypted = :checked',
        'enabled_at IS NULL',
        '(last_used_step IS NULL OR last_used_step < :step)',
      ]);
      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: USER_ID,
          action: MFA_AUDIT.enrolled,
          entityType: 'USER',
          entityId: USER_ID,
          diff: { recoveryCodesLeft: 10 },
        },
        em,
      );
      for (const code of enrolment.recoveryCodes) {
        expect(everythingRecorded()).not.toContain(code.replace('-', ''));
      }
    });

    it('refuses a malformed code with VALIDATION_FAILED, not counted', async () => {
      const error = await failureOf(service.confirm(account(), '12ab56', vi.fn()));

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors).toEqual([
        { field: 'code', code: 'INVALID', message: 'must be 6 digits' },
      ]);
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('answers CODE_INVALID without counting when setup never ran', async () => {
      credential = null;

      expect((await failureOf(service.confirm(account(), codeNow(), vi.fn()))).code).toBe(
        'CODE_INVALID',
      );
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('answers ALREADY_EXISTS for an enabled credential', async () => {
      credential = credentialOf();

      expect((await failureOf(service.confirm(account(), codeNow(), vi.fn()))).code).toBe(
        'ALREADY_EXISTS',
      );
    });

    it('counts a wrong code toward the lockout and audits it without the code', async () => {
      const wrong = codeNow(5);
      const then = vi.fn();

      const error = await failureOf(service.confirm(account(), wrong, then));

      expect(error.code).toBe('CODE_INVALID');
      expect(error.status).toBe(400);
      expect(users.recordFailedLogin).toHaveBeenCalledWith(USER_ID, em);
      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: null,
          action: MFA_AUDIT.failed,
          entityType: 'USER',
          entityId: USER_ID,
          diff: { method: 'TOTP', reason: 'WRONG_CODE', failedLoginCount: 1 },
        },
        em,
      );
      expect(then).not.toHaveBeenCalled();
      expect(everythingRecorded()).not.toContain(wrong);
    });
  });

  describe('verifySecondFactor', () => {
    const then = vi.fn(() => Promise.resolve('session'));

    beforeEach(() => {
      then.mockClear();
    });

    it('accepts the current TOTP code, claims its step and starts the session in one transaction', async () => {
      results = [{ raw: [{ recovery_codes_left: 2 }] }];

      const step = await service.verifySecondFactor(
        USER_ID,
        { method: 'TOTP', code: codeNow() },
        then,
      );

      expect(step).toEqual({ value: 'session', recoveryCodesLeft: 2 });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(statements[0]).toMatchObject({
        set: { lastUsedStep: totpStep(clock.now()) },
        where: expect.arrayContaining(['enabled_at IS NOT NULL']) as unknown,
        params: { id: USER_ID, step: totpStep(clock.now()) },
      });
      expect(statements[0]?.set).not.toHaveProperty('secretEncrypted');
      expect(auditedActions()).toEqual([MFA_AUDIT.succeeded]);
      expect(audit.write.mock.calls[0]?.[0]).toMatchObject({ diff: { method: 'TOTP' } });
    });

    it('accepts a code of the previous step (window) once', async () => {
      results = [{ raw: [{ recovery_codes_left: 2 }] }];

      await service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow(-1) }, then);

      expect(statements[0]?.set).toMatchObject({ lastUsedStep: totpStep(clock.now()) - 1 });
    });

    it('refuses a replayed step as a wrong code, counted', async () => {
      credential = credentialOf({ lastUsedStep: totpStep(clock.now()) });

      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow() }, then),
      );

      expect(error.code).toBe('CODE_INVALID');
      expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
      expect(statements).toHaveLength(0);
      expect(then).not.toHaveBeenCalled();
    });

    it('refuses a step spent by a concurrent request (the claim changes no row), counted', async () => {
      results = [{ raw: [] }];

      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow() }, then),
      );

      expect(error.code).toBe('CODE_INVALID');
      expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
      expect(then).not.toHaveBeenCalled();
    });

    it('re-encrypts a secret of a previous key with the current key (rotation)', async () => {
      const previous = randomBytes(32);
      credential = credentialOf({
        secretEncrypted: new SecretCipher(previous).encrypt(secret, USER_ID),
      });
      service = new MfaService(
        dataSource as unknown as DataSource,
        users as unknown as UsersService,
        hasher as unknown as PasswordHasher,
        new SecretCipher(key, [previous]),
        audit as unknown as AuditService,
        clock,
        { appEnv: 'test' } as ServerConfig,
      );
      results = [{ raw: [{ recovery_codes_left: 2 }] }];

      await service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow() }, then);

      const reencrypted = statements[0]?.set?.['secretEncrypted'] as string;
      expect(reencrypted.split('.')[1]).toBe(mfaKeyIdOf(key));
      expect(cipher.decrypt(reencrypted, USER_ID).plaintext.equals(secret)).toBe(true);
    });

    it('accepts a recovery code once: its hash is removed under the update, the rest stays', async () => {
      results = [{ raw: [{ recovery_codes_left: 1 }] }];

      const step = await service.verifySecondFactor(
        USER_ID,
        { method: 'RECOVERY_CODE', code: 'fghjk-67890' },
        then,
      );

      expect(step.recoveryCodesLeft).toBe(1);
      expect(statements[0]?.where).toEqual([
        'user_id = :id AND enabled_at IS NOT NULL AND :hash = ANY(recovery_code_hashes)',
      ]);
      expect(statements[0]?.params).toEqual({ id: USER_ID, hash: 'fake-phc:FGHJK67890' });
      expect(typeof statements[0]?.set?.['recoveryCodeHashes']).toBe('function');
      expect(auditedActions()).toEqual([MFA_AUDIT.succeeded, MFA_AUDIT.recoveryCodeUsed]);
      expect(audit.write.mock.calls[1]?.[0]).toMatchObject({ diff: { recoveryCodesLeft: 1 } });
      expect(everythingRecorded()).not.toContain('FGHJK67890');
    });

    it('refuses a recovery code already spent by a concurrent request, counted', async () => {
      results = [{ raw: [] }];

      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'RECOVERY_CODE', code: 'ABCDE-12345' }, then),
      );

      expect(error.code).toBe('CODE_INVALID');
      expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
    });

    it('counts an unknown recovery code and audits the method, not the code', async () => {
      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'RECOVERY_CODE', code: 'ZZZZZ-ZZZZZ' }, then),
      );

      expect(error.code).toBe('CODE_INVALID');
      expect(audit.write.mock.calls[0]?.[0]).toMatchObject({
        action: MFA_AUDIT.failed,
        diff: { method: 'RECOVERY_CODE', reason: 'WRONG_CODE', failedLoginCount: 1 },
      });
      expect(everythingRecorded()).not.toContain('ZZZZZ');
    });

    it('audits the lock in the same transaction when a wrong code reaches the threshold', async () => {
      users.recordFailedLogin.mockResolvedValue({
        counted: true,
        failedLoginCount: 5,
        lockedUntil: LOCKED_UNTIL,
      });

      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow(4) }, then),
      );

      expect(error.code).toBe('CODE_INVALID');
      expect(error.detail).toBeUndefined();
      expect(error.extras).toEqual({});
      expect(audit.write).toHaveBeenLastCalledWith(
        {
          actorUserId: null,
          action: MFA_AUDIT.accountLocked,
          entityType: 'USER',
          entityId: USER_ID,
          diff: { failedLoginCount: 5, lockedUntil: LOCKED_UNTIL.toISOString() },
        },
        em,
      );
    });

    it('checks and counts nothing while locked, and answers the same CODE_INVALID', async () => {
      stored = account({ lockedUntil: LOCKED_UNTIL, failedLoginCount: 5 });

      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow() }, then),
      );

      expect(error.code).toBe('CODE_INVALID');
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
      expect(statements).toHaveLength(0);
      expect(audit.write.mock.calls[0]?.[0]).toMatchObject({
        action: MFA_AUDIT.failed,
        diff: { method: 'TOTP', reason: 'LOCKED' },
      });
    });

    it.each([
      ['a SUSPENDED account', () => (stored = account({ status: 'SUSPENDED' }))],
      ['an INVITED account', () => (stored = account({ status: 'INVITED' }))],
      ['a demoted account', () => (stored = account({ role: 'STAFF' }))],
      ['an account whose MFA was reset', () => (credential = null)],
      ['a pending credential', () => (credential = credentialOf({ enabledAt: null }))],
    ])('refuses %s with UNAUTHENTICATED, counting nothing', async (_case, arrange) => {
      arrange();

      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'TOTP', code: codeNow() }, then),
      );

      expect(error.code).toBe('UNAUTHENTICATED');
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
      expect(then).not.toHaveBeenCalled();
    });

    it('refuses a malformed recovery code with VALIDATION_FAILED, not counted', async () => {
      const error = await failureOf(
        service.verifySecondFactor(USER_ID, { method: 'RECOVERY_CODE', code: 'short' }, then),
      );

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors?.[0]?.field).toBe('recoveryCode');
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
    });
  });

  describe('regenerateRecoveryCodes', () => {
    it('replaces the whole set after a current code', async () => {
      results = [{ raw: [{ recovery_codes_left: 10 }] }];

      const codes = await service.regenerateRecoveryCodes(account(), codeNow());

      expect(codes).toHaveLength(10);
      expect(statements[0]?.set).toMatchObject({
        lastUsedStep: totpStep(clock.now()),
        recoveryCodeHashes: codes.map((code) => `fake-phc:${code.replace('-', '')}`),
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: MFA_AUDIT.recoveryCodesRegenerated,
          diff: { recoveryCodesLeft: 10 },
        }),
        em,
      );
    });

    it('answers MFA_NOT_ENABLED without a confirmed second factor', async () => {
      credential = credentialOf({ enabledAt: null });

      expect((await failureOf(service.regenerateRecoveryCodes(account(), codeNow()))).code).toBe(
        'MFA_NOT_ENABLED',
      );
    });

    it('keeps the old set on a wrong code, and counts it', async () => {
      const error = await failureOf(service.regenerateRecoveryCodes(account(), codeNow(3)));

      expect(error.code).toBe('CODE_INVALID');
      expect(statements).toHaveLength(0);
      expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordRequested', () => {
    it('audits the second step request with no actor', async () => {
      await service.recordRequested(USER_ID, false);

      expect(audit.write).toHaveBeenCalledWith({
        actorUserId: null,
        action: MFA_AUDIT.requested,
        entityType: 'USER',
        entityId: USER_ID,
        diff: { enrolled: false },
      });
    });
  });
});
