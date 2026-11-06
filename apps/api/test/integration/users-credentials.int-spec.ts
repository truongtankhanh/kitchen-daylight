import type { DataSource, EntityManager } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../src/common/errors/api-error.js';
import { FixedClock } from '../../src/common/time/testing.js';
import { User } from '../../src/modules/users/entities/user.entity.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import {
  EmailTakenError,
  UserSessionRevoker,
  UsersService,
} from '../../src/modules/users/users.service.js';
import { expectSqlState, openAppDataSource } from '../support/app-role.js';
import { truncateAll } from '../support/truncate.js';

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';
const NOW = '2026-11-06T03:00:00.000Z';
const MINUTE = 60 * 1000;

/** Fictional fixture text; never a real credential. */
const FIXTURE_PASSPHRASE = 'kd-fixture-passphrase';

class RecordingRevoker extends UserSessionRevoker {
  readonly calls: string[] = [];
  revokeAllSessions(_manager: EntityManager, userId: string): Promise<void> {
    this.calls.push(userId);
    return Promise.resolve();
  }
}

describe('UsersService credentials (kd_app, real PostgreSQL)', () => {
  let dataSource: DataSource;
  let clock: FixedClock;
  let revoker: RecordingRevoker;
  let hasher: PasswordHasher;
  let users: UsersService;

  beforeAll(async () => {
    dataSource = await openAppDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAll();
    clock = new FixedClock(NOW);
    revoker = new RecordingRevoker();
    hasher = new PasswordHasher();
    users = new UsersService(dataSource, hasher, clock, revoker);
  });

  function createCustomer(email: string): Promise<User> {
    return users.createCustomer({
      email,
      password: FIXTURE_PASSPHRASE,
      displayName: 'Người dùng mẫu',
      locale: 'vi',
    });
  }

  async function reload(id: string): Promise<User> {
    return dataSource.manager.findOneOrFail(User, { where: { id } });
  }

  describe('accounts', () => {
    it('creates an ACTIVE, unverified customer with a normalised email and a verifiable hash', async () => {
      const user = await createCustomer('  Fixture-A@KD.example ');

      expect(user).toMatchObject({
        email: 'fixture-a@kd.example',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerifiedAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      expect(user.passwordHash).not.toBeNull();
      expect(user.passwordHash).not.toContain(FIXTURE_PASSPHRASE);
      await expect(hasher.verify(user.passwordHash ?? '', FIXTURE_PASSPHRASE)).resolves.toBe(true);
    });

    it('lets citext refuse a second account that differs only in case', async () => {
      await createCustomer('fixture-a@kd.example');

      await expect(createCustomer('FIXTURE-A@KD.EXAMPLE')).rejects.toBeInstanceOf(EmailTakenError);
      // Below the service's normalisation: the column itself compares without regard to case.
      await expectSqlState(
        dataSource.query(
          `INSERT INTO public.users (email, display_name, locale, role, status)
           VALUES ('Fixture-A@KD.Example', 'Người dùng mẫu', 'vi', 'CUSTOMER', 'ACTIVE')`,
        ),
        UNIQUE_VIOLATION,
      );
      expect(await dataSource.manager.count(User)).toBe(1);
    });

    it('finds a stored mixed-case email by any case', async () => {
      await dataSource.query(
        `INSERT INTO public.users (email, display_name, locale, role, status)
         VALUES ('Fixture-B@KD.example', 'Người dùng mẫu', 'vi', 'CUSTOMER', 'ACTIVE')`,
      );

      expect((await users.findByEmail(' fixture-b@kd.EXAMPLE '))?.email).toBe(
        'Fixture-B@KD.example',
      );
      await expect(createCustomer('fixture-b@kd.example')).rejects.toBeInstanceOf(EmailTakenError);
      await expect(users.findByEmail('nobody@kd.example')).resolves.toBeNull();
    });

    it('keeps the caller transaction usable after a taken email', async () => {
      await createCustomer('fixture-a@kd.example');

      await dataSource.transaction(async (manager) => {
        await expect(
          users.createCustomer(
            {
              email: 'fixture-a@kd.example',
              password: FIXTURE_PASSPHRASE,
              displayName: 'Người dùng mẫu',
              locale: 'vi',
            },
            manager,
          ),
        ).rejects.toBeInstanceOf(EmailTakenError);
        await expect(manager.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
      });
    });

    it('creates an INVITED staff member with a null hash', async () => {
      const staff = await users.createInvitedStaff({
        email: 'fixture-staff@kd.example',
        displayName: 'Nhân viên mẫu',
        locale: 'vi',
        role: 'STAFF',
      });

      expect(staff).toMatchObject({ role: 'STAFF', status: 'INVITED', passwordHash: null });
      expect((await reload(staff.id)).passwordHash).toBeNull();
      await expect(
        users.createInvitedStaff({
          email: 'FIXTURE-STAFF@kd.example',
          displayName: 'Nhân viên mẫu',
          locale: 'vi',
          role: 'MANAGER',
        }),
      ).rejects.toBeInstanceOf(EmailTakenError);
    });

    it('refuses a password equal to the account email or its local part, writing nothing', async () => {
      await expect(
        users.createCustomer({
          email: 'fixture-policy-customer@example.com',
          password: 'Fixture-Policy-Customer',
          displayName: 'Người dùng mẫu',
          locale: 'vi',
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'password', code: 'INVALID' }],
      });
      await expect(dataSource.manager.count(User)).resolves.toBe(0);

      const staff = await users.createInvitedStaff({
        email: 'fixture-policy-staff@example.com',
        displayName: 'Nhân viên mẫu',
        locale: 'vi',
        role: 'STAFF',
      });
      await expect(
        users.setPassword(staff.id, 'FIXTURE-POLICY-STAFF@EXAMPLE.COM'),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'password', code: 'INVALID' }],
      });
      expect((await reload(staff.id)).passwordHash).toBeNull();
    });

    it('sets a password with the staff minimum and clears the lockout', async () => {
      const staff = await users.createInvitedStaff({
        email: 'fixture-staff@kd.example',
        displayName: 'Nhân viên mẫu',
        locale: 'vi',
        role: 'ADMIN',
      });
      for (let failure = 0; failure < 5; failure += 1) {
        await users.recordFailedLogin(staff.id);
      }
      expect((await reload(staff.id)).lockedUntil).not.toBeNull();

      await expect(users.setPassword(staff.id, 'eleven-char')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await users.setPassword(staff.id, FIXTURE_PASSPHRASE);

      const after = await reload(staff.id);
      expect(after).toMatchObject({ failedLoginCount: 0, lockedUntil: null, status: 'INVITED' });
      await expect(hasher.verify(after.passwordHash ?? '', FIXTURE_PASSPHRASE)).resolves.toBe(true);
    });

    it('marks the email verified once', async () => {
      const user = await createCustomer('fixture-a@kd.example');

      await users.markEmailVerified(user.id);
      clock.advance(MINUTE);
      await users.markEmailVerified(user.id);

      expect((await reload(user.id)).emailVerifiedAt?.toISOString()).toBe(NOW);
    });
  });

  describe('lockout', () => {
    it('counts ten parallel failures exactly and locks at the customer threshold', async () => {
      const user = await createCustomer('fixture-a@kd.example');

      const results = await Promise.all(
        Array.from({ length: 10 }, () => users.recordFailedLogin(user.id)),
      );

      const after = await reload(user.id);
      expect(after.failedLoginCount).toBe(10);
      expect(after.lockedUntil?.toISOString()).toBe(
        new Date(clock.now().getTime() + 15 * MINUTE).toISOString(),
      );
      expect(results.every((result) => result.counted)).toBe(true);
      expect(results.map((result) => result.failedLoginCount).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(users.isLocked(after)).toBe(true);
    });

    it('does not count while locked, and doubles the lock after it ends', async () => {
      const staff = await users.createInvitedStaff({
        email: 'fixture-staff@kd.example',
        displayName: 'Nhân viên mẫu',
        locale: 'vi',
        role: 'STAFF',
      });
      for (let failure = 1; failure <= 4; failure += 1) {
        expect((await users.recordFailedLogin(staff.id)).lockedUntil).toBeNull();
      }
      const fifth = await users.recordFailedLogin(staff.id);
      expect(fifth.lockedUntil?.getTime()).toBe(clock.now().getTime() + 15 * MINUTE);

      const whileLocked = await Promise.all(
        Array.from({ length: 5 }, () => users.recordFailedLogin(staff.id)),
      );
      expect(whileLocked.every((result) => !result.counted)).toBe(true);
      expect((await reload(staff.id)).failedLoginCount).toBe(5);

      clock.advance(15 * MINUTE);
      const sixth = await users.recordFailedLogin(staff.id);
      expect(sixth).toMatchObject({ counted: true, failedLoginCount: 6 });
      expect(sixth.lockedUntil?.getTime()).toBe(clock.now().getTime() + 30 * MINUTE);
    });

    it('resets the counter and stamps last_login_at on success', async () => {
      const user = await createCustomer('fixture-a@kd.example');
      for (let failure = 0; failure < 10; failure += 1) {
        await users.recordFailedLogin(user.id);
      }
      clock.advance(MINUTE);

      await users.recordSuccessfulLogin(user.id);

      const after = await reload(user.id);
      expect(after.failedLoginCount).toBe(0);
      expect(after.lockedUntil).toBeNull();
      expect(after.lastLoginAt?.getTime()).toBe(clock.now().getTime());
      expect(users.isLocked(after)).toBe(false);
    });
  });

  describe('status transitions', () => {
    it('moves along the table and revokes sessions on suspension and deletion', async () => {
      const staff = await users.createInvitedStaff({
        email: 'fixture-staff@kd.example',
        displayName: 'Nhân viên mẫu',
        locale: 'vi',
        role: 'STAFF',
      });

      expect((await users.transition(staff.id, 'ACTIVE')).status).toBe('ACTIVE');
      expect((await users.transition(staff.id, 'SUSPENDED')).status).toBe('SUSPENDED');
      expect(revoker.calls).toEqual([staff.id]);
      expect((await users.transition(staff.id, 'DELETED')).status).toBe('DELETED');
      expect(revoker.calls).toEqual([staff.id, staff.id]);

      const error: unknown = await users.transition(staff.id, 'ACTIVE').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('INVALID_TRANSITION');
      expect((await reload(staff.id)).status).toBe('DELETED');
    });

    it('rolls the status back when session revocation fails', async () => {
      const user = await createCustomer('fixture-a@kd.example');
      const failing = new UsersService(dataSource, hasher, clock, {
        revokeAllSessions: () => Promise.reject(new Error('fixture failure')),
      });

      await expect(failing.transition(user.id, 'SUSPENDED')).rejects.toThrow('fixture failure');
      expect((await reload(user.id)).status).toBe('ACTIVE');
    });
  });
});
