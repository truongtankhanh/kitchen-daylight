import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import { Clock } from '../../common/time/clock.js';
import { User } from './entities/user.entity.js';
import type { UserRole, UserStatus } from './entities/user.entity.js';
import { normalizeEmail } from './email.js';
import { isLocked, lockedUntilAfter } from './lockout.js';
import { PasswordHasher } from './password-hasher.js';
import { checkPasswordPolicy, passwordAudienceOf } from './password-policy.js';
import { canTransition, endsSessions } from './user-status.js';

/**
 * The email is already used by another account. A domain error, not `ALREADY_EXISTS`:
 * registration answers the same `202` whether or not the email exists (decision 0008 section 5),
 * so the caller decides what, if anything, the client sees. Carries no email.
 */
export class EmailTakenError extends Error {
  constructor() {
    super('The email is already used by another account.');
    this.name = 'EmailTakenError';
  }
}

/**
 * Hook of brief E6 and decision 0008 section 1: a role change, a suspension and an account deletion
 * revoke every refresh-token family of the user, in the caller's transaction. A1-T6 (token service)
 * provides the implementation.
 */
export abstract class UserSessionRevoker {
  abstract revokeAllSessions(manager: EntityManager, userId: string): Promise<void>;
}

/**
 * Bound by `UsersModule` until A1-T6 replaces it. Fails closed: a move that must end sessions
 * throws instead of silently leaving them alive.
 */
export class PendingUserSessionRevoker extends UserSessionRevoker {
  revokeAllSessions(): Promise<void> {
    return Promise.reject(
      new Error('Session revocation is not available before the token service (A1-T6).'),
    );
  }
}

export interface NewCustomer {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly locale: string;
}

export interface NewInvitedStaff {
  readonly email: string;
  readonly displayName: string;
  readonly locale: string;
  readonly role: Exclude<UserRole, 'CUSTOMER'>;
}

export interface FailedLoginResult {
  /** False when the account was already locked: nothing was counted (decision 0008 section 4). */
  readonly counted: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
}

/**
 * Accounts and credentials (A1-T5). No controller: the auth endpoints (A2-T1, A3-T1) call it. Every
 * write takes an optional `EntityManager`, so a caller can join it to its own transaction (for
 * example registration with its consent rows); `transition` and `recordFailedLogin` need that
 * manager to be inside a transaction, and open their own without one. Passwords and hashes are
 * never logged or returned in an error.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(UserSessionRevoker) private readonly sessions: UserSessionRevoker,
  ) {}

  /**
   * A self-registered customer: `ACTIVE`, email not verified. Policy failure → `VALIDATION_FAILED`
   * on `password`; a taken email → `EmailTakenError`. `ON CONFLICT DO NOTHING` keeps the caller's
   * transaction usable after a taken email.
   */
  async createCustomer(input: NewCustomer, manager?: EntityManager): Promise<User> {
    assertPasswordPolicy(input.password, 'CUSTOMER');
    const passwordHash = await this.hasher.hash(input.password);
    return this.insertUser(manager ?? this.dataSource.manager, {
      email: normalizeEmail(input.email),
      passwordHash,
      displayName: input.displayName,
      locale: input.locale,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });
  }

  /** A staff account waiting for its invitation link: `INVITED`, no password (data-model). */
  async createInvitedStaff(input: NewInvitedStaff, manager?: EntityManager): Promise<User> {
    return this.insertUser(manager ?? this.dataSource.manager, {
      email: normalizeEmail(input.email),
      passwordHash: null,
      displayName: input.displayName,
      locale: input.locale,
      role: input.role,
      status: 'INVITED',
    });
  }

  /** Trimmed and lower-cased first; `citext` matches without regard to case anyway. */
  findByEmail(email: string, manager?: EntityManager): Promise<User | null> {
    return (manager ?? this.dataSource.manager).findOne(User, {
      where: { email: normalizeEmail(email) },
    });
  }

  findById(userId: string, manager?: EntityManager): Promise<User | null> {
    return (manager ?? this.dataSource.manager).findOne(User, { where: { id: userId } });
  }

  /**
   * Checks the policy for the user's role, stores a new hash and clears the lockout (a completed
   * reset or an accepted invitation unlocks the account, decision 0008 section 4). Ending other
   * sessions and leaving `INVITED` are the callers' steps.
   */
  async setPassword(userId: string, password: string, manager?: EntityManager): Promise<void> {
    const em = manager ?? this.dataSource.manager;
    const user = await this.requireUser(em, userId);
    assertPasswordPolicy(password, user.role);
    const passwordHash = await this.hasher.hash(password);
    await em
      .createQueryBuilder()
      .update(User)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null })
      .where('id = :id', { id: userId })
      .updateEntity(false)
      .execute();
  }

  /** Sets `email_verified_at` once; a second call keeps the first instant. */
  async markEmailVerified(userId: string, manager?: EntityManager): Promise<void> {
    const em = manager ?? this.dataSource.manager;
    await this.requireUser(em, userId);
    await em
      .createQueryBuilder()
      .update(User)
      .set({ emailVerifiedAt: this.clock.now() })
      .where('id = :id AND email_verified_at IS NULL', { id: userId })
      .updateEntity(false)
      .execute();
  }

  /**
   * Moves `status` along `USER_STATUS_TRANSITIONS` under a row lock; any other move is
   * `INVALID_TRANSITION`. `SUSPENDED` and `DELETED` revoke the user's sessions in the same
   * transaction. Scrubbing a tombstone is the account deletion's work (A11), not this method's.
   */
  async transition(userId: string, to: UserStatus, manager?: EntityManager): Promise<User> {
    return this.inTransaction(manager, async (em) => {
      const user = await em.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (user === null) {
        throw new ApiError('NOT_FOUND');
      }
      if (!canTransition(user.status, to)) {
        throw new ApiError('INVALID_TRANSITION', {
          detail: `A user cannot move from ${user.status} to ${to}.`,
        });
      }
      await em
        .createQueryBuilder()
        .update(User)
        .set({ status: to })
        .where('id = :id', { id: userId })
        .updateEntity(false)
        .execute();
      if (endsSessions(to)) {
        await this.sessions.revokeAllSessions(em, userId);
      }
      return em.findOneOrFail(User, { where: { id: userId } });
    });
  }

  /**
   * Counts one failed sign-in (wrong password or, for staff, wrong second factor) and sets
   * `locked_until` by the schedule of `lockout.ts`. The increment is one atomic `UPDATE …
   * RETURNING`, skipped while the account is locked; the row lock it takes is held until the lock
   * time is written, so parallel failures are counted exactly and never pass the threshold
   * unseen.
   */
  async recordFailedLogin(userId: string, manager?: EntityManager): Promise<FailedLoginResult> {
    return this.inTransaction(manager, async (em) => {
      const now = this.clock.now();
      const result = await em
        .createQueryBuilder()
        .update(User)
        .set({ failedLoginCount: () => 'failed_login_count + 1' })
        .where('id = :id AND (locked_until IS NULL OR locked_until <= :now)', { id: userId, now })
        .returning('failed_login_count, role')
        .updateEntity(false)
        .execute();
      const rows = result.raw as { failed_login_count: number; role: UserRole }[];
      const row = rows[0];

      if (row === undefined) {
        const user = await this.requireUser(em, userId);
        return {
          counted: false,
          failedLoginCount: user.failedLoginCount,
          lockedUntil: user.lockedUntil,
        };
      }

      const lockedUntil = lockedUntilAfter(row.failed_login_count, row.role, now);
      if (lockedUntil !== null) {
        await em
          .createQueryBuilder()
          .update(User)
          .set({ lockedUntil })
          .where('id = :id', { id: userId })
          .updateEntity(false)
          .execute();
      }
      return { counted: true, failedLoginCount: row.failed_login_count, lockedUntil };
    });
  }

  /** A completed sign-in (after the second factor for `MANAGER` and `ADMIN`): reset and stamp. */
  async recordSuccessfulLogin(userId: string, manager?: EntityManager): Promise<void> {
    const em = manager ?? this.dataSource.manager;
    await this.requireUser(em, userId);
    await em
      .createQueryBuilder()
      .update(User)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.clock.now() })
      .where('id = :id', { id: userId })
      .updateEntity(false)
      .execute();
  }

  /** Whether the account is locked now, by the injected `Clock`. */
  isLocked(user: Pick<User, 'lockedUntil'>): boolean {
    return isLocked(user, this.clock.now());
  }

  private async insertUser(
    em: EntityManager,
    values: Pick<User, 'email' | 'passwordHash' | 'displayName' | 'locale' | 'role' | 'status'>,
  ): Promise<User> {
    const result = await em
      .createQueryBuilder()
      .insert()
      .into(User)
      .values(values)
      .orIgnore()
      .returning('id')
      .updateEntity(false)
      .execute();
    const rows = result.raw as { id: string }[];
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new EmailTakenError();
    }
    return em.findOneOrFail(User, { where: { id } });
  }

  private async requireUser(em: EntityManager, userId: string): Promise<User> {
    const user = await em.findOne(User, { where: { id: userId } });
    if (user === null) {
      throw new ApiError('NOT_FOUND');
    }
    return user;
  }

  /** Joins the caller's transaction when given, otherwise opens one. */
  private inTransaction<T>(
    manager: EntityManager | undefined,
    work: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    return manager === undefined ? this.dataSource.transaction(work) : work(manager);
  }
}

function assertPasswordPolicy(password: string, role: UserRole): void {
  const errors = checkPasswordPolicy(password, passwordAudienceOf(role));
  if (errors.length > 0) {
    throw new ApiError('VALIDATION_FAILED', { errors });
  }
}
