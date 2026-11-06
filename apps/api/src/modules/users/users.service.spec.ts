import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import type { User, UserStatus } from './entities/user.entity.js';
import { PasswordHasher } from './password-hasher.js';
import { PendingUserSessionRevoker, UserSessionRevoker, UsersService } from './users.service.js';

const NOW = '2026-11-06T03:00:00.000Z';
const USER_ID = '01930000-0000-7000-8000-0000000000c1';

class RecordingRevoker extends UserSessionRevoker {
  readonly calls: string[] = [];
  revokeAllSessions(_manager: EntityManager, userId: string): Promise<void> {
    this.calls.push(userId);
    return Promise.resolve();
  }
}

/**
 * A stand-in `EntityManager`: `findOne` answers `user`, every query builder call chains, and
 * `execute` records nothing. Enough for the rules decided before or around SQL; the SQL itself is
 * covered by test/integration/users-credentials.int-spec.ts.
 */
function fakeManager(user: Partial<User> | null) {
  const builder: Record<string, unknown> = {};
  for (const method of ['update', 'set', 'where', 'updateEntity', 'returning']) {
    builder[method] = vi.fn(() => builder);
  }
  builder['execute'] = vi.fn(() => Promise.resolve({ raw: [] }));
  const manager = {
    findOne: vi.fn(() => Promise.resolve(user)),
    findOneOrFail: vi.fn(() => Promise.resolve(user)),
    createQueryBuilder: vi.fn(() => builder),
  };
  return { manager, builder, em: manager as unknown as EntityManager };
}

function serviceWith(em: EntityManager, revoker: UserSessionRevoker = new RecordingRevoker()) {
  const dataSource = {
    manager: em,
    transaction: (work: (manager: EntityManager) => Promise<unknown>) => work(em),
  } as unknown as DataSource;
  const hasher = new PasswordHasher();
  const clock = new FixedClock(NOW);
  return { service: new UsersService(dataSource, hasher, clock, revoker), hasher, clock };
}

async function apiErrorOf(work: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('UsersService', () => {
  it('normalises the email before looking it up', async () => {
    const { manager, em } = fakeManager(null);
    const { service } = serviceWith(em);

    await service.findByEmail('  Fixture-User@KD.example ');

    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
      where: { email: 'fixture-user@kd.example' },
    });
  });

  it('refuses a short customer password before hashing or writing', async () => {
    const { manager, em } = fakeManager(null);
    const { service, hasher } = serviceWith(em);
    const hash = vi.spyOn(hasher, 'hash');

    const error = await apiErrorOf(
      service.createCustomer({
        email: 'fixture-user@kd.example',
        password: 'short-pw',
        displayName: 'Người dùng mẫu',
        locale: 'vi',
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors).toEqual([
      { field: 'password', code: 'TOO_SHORT', message: 'must be at least 10 characters' },
    ]);
    expect(hash).not.toHaveBeenCalled();
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('refuses a customer password equal to the email local part before hashing', async () => {
    const { manager, em } = fakeManager(null);
    const { service, hasher } = serviceWith(em);
    const hash = vi.spyOn(hasher, 'hash');

    const error = await apiErrorOf(
      service.createCustomer({
        email: 'Fixture.Policy.Customer@Example.com',
        password: 'fixture.policy.customer',
        displayName: 'Người dùng mẫu',
        locale: 'vi',
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors).toEqual([
      {
        field: 'password',
        code: 'INVALID',
        message: 'must not be the account email or the part before @',
      },
    ]);
    expect(hash).not.toHaveBeenCalled();
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('checks a new password against the stored email of the user', async () => {
    const { manager, em } = fakeManager({
      id: USER_ID,
      role: 'STAFF',
      status: 'ACTIVE',
      email: 'fixture.policy.staff@example.com',
    });
    const { service } = serviceWith(em);

    const error = await apiErrorOf(
      service.setPassword(USER_ID, 'FIXTURE.POLICY.STAFF@EXAMPLE.COM'),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors?.[0]?.code).toBe('INVALID');
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('applies the staff minimum when a staff member sets a password', async () => {
    const { manager, em } = fakeManager({ id: USER_ID, role: 'MANAGER', status: 'INVITED' });
    const { service } = serviceWith(em);

    const error = await apiErrorOf(service.setPassword(USER_ID, 'eleven-char'));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors?.[0]?.code).toBe('TOO_SHORT');
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an unknown user', async () => {
    const { em } = fakeManager(null);
    const { service } = serviceWith(em);

    expect((await apiErrorOf(service.setPassword(USER_ID, 'long-enough-pw'))).code).toBe(
      'NOT_FOUND',
    );
    expect((await apiErrorOf(service.transition(USER_ID, 'ACTIVE'))).code).toBe('NOT_FOUND');
  });

  it.each([
    ['DELETED', 'ACTIVE'],
    ['ACTIVE', 'INVITED'],
    ['ACTIVE', 'ACTIVE'],
  ] as const)('refuses %s → %s with INVALID_TRANSITION', async (from, to) => {
    const { manager, em } = fakeManager({ id: USER_ID, role: 'STAFF', status: from });
    const revoker = new RecordingRevoker();
    const { service } = serviceWith(em, revoker);

    const error = await apiErrorOf(service.transition(USER_ID, to));

    expect(error.code).toBe('INVALID_TRANSITION');
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    expect(revoker.calls).toEqual([]);
  });

  it.each([
    ['INVITED', 'ACTIVE', false],
    ['ACTIVE', 'SUSPENDED', true],
    ['SUSPENDED', 'ACTIVE', false],
    ['SUSPENDED', 'DELETED', true],
  ] as const)(
    '%s → %s revokes sessions: %s',
    async (from: UserStatus, to: UserStatus, revokes: boolean) => {
      const { manager, em } = fakeManager({ id: USER_ID, role: 'STAFF', status: from });
      const revoker = new RecordingRevoker();
      const { service } = serviceWith(em, revoker);

      await service.transition(USER_ID, to);

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: USER_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(revoker.calls).toEqual(revokes ? [USER_ID] : []);
    },
  );

  it('reads isLocked from the injected clock', () => {
    const { em } = fakeManager(null);
    const { service, clock } = serviceWith(em);
    const lockedUntil = new Date(clock.now().getTime() + 60_000);

    expect(service.isLocked({ lockedUntil })).toBe(true);
    clock.advance(60_000);
    expect(service.isLocked({ lockedUntil })).toBe(false);
  });
});

describe('PendingUserSessionRevoker', () => {
  it('fails closed until the token service replaces it', async () => {
    const { em } = fakeManager(null);
    const revoker: UserSessionRevoker = new PendingUserSessionRevoker();
    await expect(revoker.revokeAllSessions(em, USER_ID)).rejects.toThrow(
      'Session revocation is not available before the token service (A1-T6).',
    );
  });

  it('makes a suspension fail instead of leaving sessions alive', async () => {
    const { em } = fakeManager({ id: USER_ID, role: 'STAFF', status: 'ACTIVE' });
    const { service } = serviceWith(em, new PendingUserSessionRevoker());

    await expect(service.transition(USER_ID, 'SUSPENDED')).rejects.toThrow(/A1-T6/);
  });
});
