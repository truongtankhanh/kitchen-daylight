import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import { ApiError } from '../../common/errors/api-error.js';
import { Clock } from '../../common/time/clock.js';
import type { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { User } from '../users/entities/user.entity.js';
import type { UserRole } from '../users/entities/user.entity.js';
import { isLocked } from '../users/lockout.js';
import { PasswordHasher } from '../users/password-hasher.js';
import { UsersService } from '../users/users.service.js';
import { deviceLabelOf } from './auth.service.js';
import type { ClientHeaders, LoginInput } from './auth.service.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { KeySet } from './key-set.js';
import {
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_ENROLMENT_TOKEN_TYPE,
  signMfaToken,
  verifyMfaToken,
} from './mfa/mfa-tokens.js';
import { MfaService } from './mfa/mfa.service.js';
import type { SecondFactor } from './mfa/mfa.service.js';
import { hashRefreshToken, RefreshTokenService } from './refresh-token.service.js';
import type { SessionTokens } from './refresh-token.service.js';

/** The roles that sign in on the cookie transport (api-outline, staff transport). */
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles whose sign-in needs the second factor (ADR-0009 `WA4`; decision 0008 section 8). */
export const MFA_ROLES: readonly StaffRole[] = ['MANAGER', 'ADMIN'];

export function isStaffRole(role: UserRole): role is StaffRole {
  return STAFF_ROLES.some((staff) => staff === role);
}

// The MFA tokens moved to `mfa/mfa-tokens.ts` with their verifier (A3-T2); re-exported here.
export {
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_CHALLENGE_TTL_SECONDS,
  MFA_ENROLMENT_TOKEN_TYPE,
  MFA_ENROLMENT_TTL_SECONDS,
} from './mfa/mfa-tokens.js';

/** Audit codes written by the staff transport (catalogue in `@kd/contracts`; brief E17). */
export const ADMIN_AUTH_AUDIT = {
  loginSucceeded: 'auth.login_succeeded',
  loginFailed: 'auth.login_failed',
  accountLocked: 'auth.account_locked',
  logout: 'auth.logout',
} as const satisfies Readonly<Record<string, AuditAction>>;

/**
 * Why a sign-in of a staff email failed, stored in the `auth.login_failed` diff only (never in a
 * response): every one of them answers the same `INVALID_CREDENTIALS`.
 */
export type StaffSignInFailure =
  | 'WRONG_PASSWORD'
  | 'LOCKED'
  | 'NOT_ACTIVE'
  | 'NO_PASSWORD'
  // The right password of a `SUSPENDED` account (answered `ACCOUNT_SUSPENDED`; A3-T6).
  | 'SUSPENDED';

export interface AdminSessionUser {
  readonly id: string;
  readonly displayName: string;
  readonly role: StaffRole;
}

/** The body of a staff sign-in and refresh; the refresh token goes into the cookie only. */
export interface AdminSession {
  readonly accessToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
  readonly user: AdminSessionUser;
}

/** What the controller turns into a body (`session`) and a `kd_refresh` cookie. */
export interface AdminSignIn {
  readonly session: AdminSession;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/** A completed second step: the session and the recovery codes left (brief E20). */
export interface AdminMfaSignIn extends AdminSignIn {
  readonly recoveryCodesLeft: number;
}

/** `POST /admin/auth/mfa/verify`: the challenge with exactly one of the two codes. */
export interface SecondStepInput {
  readonly challenge: string;
  readonly code?: string | undefined;
  readonly recoveryCode?: string | undefined;
}

/** The members `MFA_REQUIRED` carries (api-divergences D-076). */
export interface MfaChallenge {
  readonly mfaToken: string;
  /** False: the token is the enrolment token and the admin web opens the enrolment screen. */
  readonly mfaEnrolled: boolean;
  /** Seconds until `mfaToken` expires. */
  readonly expiresIn: number;
}

/**
 * The path of a staff sign-in attempt before any password is checked. `verify`: the account may
 * sign in, check the password. `refuse`: run the dummy verification and answer
 * `INVALID_CREDENTIALS`; `failure` is the audit reason for a staff email, `null` when the email is
 * unknown or not a staff account (never logged or audited, decision 0008 section 4).
 */
export type StaffSignInPath =
  | { readonly kind: 'verify'; readonly user: User; readonly passwordHash: string }
  | {
      readonly kind: 'refuse';
      readonly user: User | null;
      readonly failure: StaffSignInFailure | null;
    };

/**
 * Decision 0008 sections 4 and 5: unknown email, a `CUSTOMER` account, an `INVITED` or `DELETED`
 * account, an account without a password and a locked account take the dummy path. Only `ACTIVE`
 * and `SUSPENDED` staff with a password and no lock check the password (`ACCOUNT_SUSPENDED` comes
 * only after the right one).
 */
export function staffSignInPath(user: User | null, now: Date): StaffSignInPath {
  if (user === null || !isStaffRole(user.role)) {
    return { kind: 'refuse', user, failure: null };
  }
  if (user.status !== 'ACTIVE' && user.status !== 'SUSPENDED') {
    return { kind: 'refuse', user, failure: 'NOT_ACTIVE' };
  }
  if (user.passwordHash === null) {
    return { kind: 'refuse', user, failure: 'NO_PASSWORD' };
  }
  if (isLocked(user, now)) {
    return { kind: 'refuse', user, failure: 'LOCKED' };
  }
  return { kind: 'verify', user, passwordHash: user.passwordHash };
}

function invalidCredentials(): ApiError {
  // One body for every refusal (decision 0008 section 5): no detail, no unlock time, no count left.
  return new ApiError('INVALID_CREDENTIALS');
}

function unauthenticated(): ApiError {
  return new ApiError('UNAUTHENTICATED');
}

/** Exactly one of `code` and `recoveryCode` (D-080); the message never repeats a value. */
export function secondFactorOf(input: SecondStepInput): SecondFactor {
  const hasCode = typeof input.code === 'string';
  const hasRecoveryCode = typeof input.recoveryCode === 'string';
  if (hasCode === hasRecoveryCode) {
    throw new ApiError('VALIDATION_FAILED', {
      errors: ['code', 'recoveryCode'].map((field) => ({
        field,
        code: 'INVALID' as const,
        message: 'send exactly one of code and recoveryCode',
      })),
    });
  }
  return hasCode
    ? { method: 'TOTP', code: input.code ?? '' }
    : { method: 'RECOVERY_CODE', code: input.recoveryCode ?? '' };
}

/**
 * Staff authentication on the cookie transport (A3-T1; ADR-0003 "Admin web"; decision 0008
 * sections 1, 4, 5, 8 and 10). Every method is public: the account is identified by its credentials
 * or by the refresh cookie only. No password, hash, token or cookie value is logged, audited or put
 * in an error; an unknown email typed is neither logged nor audited.
 */
@Injectable()
export class AdminAuthService {
  // Nest's logger, routed to pino by `app.useLogger` (decision 0005 section 11), as in `AuthService`.
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(KeySet) private readonly keys: KeySet,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  /**
   * `STAFF`: a new family, `last_login_at`, the counters cleared, `auth.login_succeeded`. `MANAGER`
   * and `ADMIN`: `auth.mfa_requested`, then `403 MFA_REQUIRED` with the challenge or enrolment
   * token and no session; the counters and `last_login_at` change only when the second step
   * completes (`verifySecondStep`, or `/me/mfa/confirm` with the enrolment token). A wrong password
   * counts toward the staff lockout (threshold 5).
   */
  async login(input: LoginInput, headers: ClientHeaders): Promise<AdminSignIn> {
    const path = staffSignInPath(await this.users.findByEmail(input.email), this.clock.now());
    if (path.kind === 'refuse') {
      await this.hasher.verifyOrDummy(null, input.password);
      if (path.user !== null && path.failure !== null) {
        await this.recordRefusal(path.user.id, path.failure);
      }
      throw invalidCredentials();
    }

    const { user, passwordHash } = path;
    if (!(await this.hasher.verify(passwordHash, input.password))) {
      await this.recordWrongPassword(user.id);
      throw invalidCredentials();
    }
    if (user.status === 'SUSPENDED') {
      // A failed sign-in of a staff email like the others (brief E17), not counted: the password
      // was right (decision 0008 section 4).
      await this.recordRefusal(user.id, 'SUSPENDED');
      throw new ApiError('ACCOUNT_SUSPENDED');
    }

    // Hashed before any transaction, so no row lock waits on argon2.
    const rehashed = this.hasher.needsRehash(passwordHash)
      ? await this.hasher.hash(input.password)
      : null;
    const role = user.role as StaffRole;

    if (MFA_ROLES.includes(role)) {
      if (rehashed !== null) {
        // Only if the hash is still the one verified: a concurrent password change wins.
        await this.dataSource.manager.update(
          User,
          { id: user.id, passwordHash },
          { passwordHash: rehashed },
        );
      }
      const challenge = await this.mfaChallengeFor(user.id);
      await this.mfa.recordRequested(user.id, challenge.mfaEnrolled);
      throw new ApiError('MFA_REQUIRED', { extras: { ...challenge } });
    }

    const tokens = await this.dataSource.transaction(async (em) => {
      if (rehashed !== null) {
        await em.update(User, { id: user.id, passwordHash }, { passwordHash: rehashed });
      }
      return this.startSession(user, deviceLabelOf(input.deviceLabel, headers.client), em);
    });
    this.logSignIn(user);
    return this.signInOf(tokens, { ...user, role });
  }

  /**
   * The second step of a `MANAGER` or `ADMIN` sign-in (api-outline staff transport; decision 0008
   * section 8). An invalid or expired challenge is `UNAUTHENTICATED` (sign in again); a wrong,
   * replayed or locked-out code is `CODE_INVALID` and counts toward the same lockout as a wrong
   * password (`MfaService`). Success starts the session in the transaction that spends the code.
   */
  async verifySecondStep(input: SecondStepInput, headers: ClientHeaders): Promise<AdminMfaSignIn> {
    const factor = secondFactorOf(input);
    const userId = await verifyMfaToken(
      this.keys,
      this.clock.now(),
      input.challenge,
      MFA_CHALLENGE_TOKEN_TYPE,
    );
    if (userId === null) {
      throw unauthenticated();
    }
    const { value, recoveryCodesLeft } = await this.mfa.verifySecondFactor(
      userId,
      factor,
      async (em, user) => ({
        user,
        tokens: await this.startSession(user, deviceLabelOf(undefined, headers.client), em),
      }),
    );
    this.logSignIn(value.user);
    return {
      ...this.signInOf(value.tokens, { ...value.user, role: value.user.role as StaffRole }),
      recoveryCodesLeft,
    };
  }

  /**
   * A completed staff sign-in, in the caller's transaction: counters cleared and `last_login_at`
   * set (brief E3), a new refresh-token family, `auth.login_succeeded` with the user as actor.
   */
  async startSession(
    user: Pick<User, 'id'>,
    deviceLabel: string | undefined,
    em: EntityManager,
  ): Promise<SessionTokens> {
    await this.users.recordSuccessfulLogin(user.id, em);
    const issued = await this.tokens.issue(user.id, { deviceLabel }, em);
    await this.audit.write(
      {
        actorUserId: user.id,
        action: ADMIN_AUTH_AUDIT.loginSucceeded,
        entityType: 'USER',
        entityId: user.id,
      },
      em,
    );
    return issued;
  }

  /** The log line of a completed sign-in, after the commit. */
  logSignIn(user: Pick<User, 'id' | 'failedLoginCount'>): void {
    this.logger.log(
      {
        event: ADMIN_AUTH_AUDIT.loginSucceeded,
        userId: user.id,
        failedLoginCountCleared: user.failedLoginCount,
      },
      'staff sign-in',
    );
  }

  /**
   * Rotates the cookie's refresh token through `RefreshTokenService` (reuse detection, audited
   * there, and the 10-second grace window). The owner is checked first, so a refused token is
   * never consumed: no cookie, an unknown token, a `CUSTOMER` token and a non-`ACTIVE` account are
   * `UNAUTHENTICATED`, as is every rotation failure. The controller clears the cookie on failure.
   * A `MANAGER` or `ADMIN` without a confirmed second factor (promoted from `STAFF`, or reset) is
   * refused too: such a role never holds a session without the second step (A3-T2).
   */
  async refresh(refreshToken: string | undefined): Promise<AdminSignIn> {
    if (refreshToken === undefined) {
      throw unauthenticated();
    }
    const owner = await this.ownerOf(refreshToken);
    if (owner === null || !isStaffRole(owner.role) || owner.status !== 'ACTIVE') {
      throw unauthenticated();
    }
    if (MFA_ROLES.includes(owner.role) && !(await this.mfa.isEnrolled(owner.id))) {
      throw unauthenticated();
    }
    const tokens = await this.tokens.rotate(refreshToken);
    const user = await this.users.findById(tokens.userId);
    if (user === null || !isStaffRole(user.role) || user.status !== 'ACTIVE') {
      throw unauthenticated();
    }
    return this.signInOf(tokens, { ...user, role: user.role });
  }

  /**
   * Revokes the family of the cookie's token and writes `auth.logout` (actor: the token owner). No
   * cookie, an unknown token or an already revoked one changes nothing; the answer is the same.
   */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken === undefined) {
      return;
    }
    const row = await this.dataSource.manager.findOne(RefreshToken, {
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });
    if (row === null || row.revokedAt !== null) {
      return;
    }
    await this.dataSource.transaction(async (em) => {
      await this.tokens.revokeFamily(row.familyId, em);
      await this.audit.write(
        {
          actorUserId: row.userId,
          action: ADMIN_AUTH_AUDIT.logout,
          entityType: 'USER',
          entityId: row.userId,
        },
        em,
      );
    });
    this.logger.log({ event: ADMIN_AUTH_AUDIT.logout, userId: row.userId }, 'staff sign-out');
  }

  /**
   * A refused attempt on a staff email (locked, not `ACTIVE`, no password, or suspended after the
   * right password): audited, not counted (decision 0008 section 4: no increment while locked).
   */
  private async recordRefusal(userId: string, failure: StaffSignInFailure): Promise<void> {
    await this.audit.write({
      actorUserId: null,
      action: ADMIN_AUTH_AUDIT.loginFailed,
      entityType: 'USER',
      entityId: userId,
      diff: { reason: failure },
    });
    this.logger.warn(
      { event: ADMIN_AUTH_AUDIT.loginFailed, userId, reason: failure },
      'staff sign-in refused',
    );
  }

  /**
   * Counts a wrong password and audits it; when it locks the account, `auth.account_locked` is
   * written in the same transaction as the lock. The log lines follow the commit.
   */
  private async recordWrongPassword(userId: string): Promise<void> {
    const result = await this.dataSource.transaction(async (em) => {
      const failure = await this.users.recordFailedLogin(userId, em);
      await this.audit.write(
        {
          // Detected by the system: the person typing may be the user or an attacker.
          actorUserId: null,
          action: ADMIN_AUTH_AUDIT.loginFailed,
          entityType: 'USER',
          entityId: userId,
          diff: { reason: 'WRONG_PASSWORD', failedLoginCount: failure.failedLoginCount },
        },
        em,
      );
      if (failure.counted && failure.lockedUntil !== null) {
        await this.audit.write(
          {
            actorUserId: null,
            action: ADMIN_AUTH_AUDIT.accountLocked,
            entityType: 'USER',
            entityId: userId,
            diff: {
              failedLoginCount: failure.failedLoginCount,
              lockedUntil: failure.lockedUntil.toISOString(),
            },
          },
          em,
        );
      }
      return failure;
    });
    this.logger.warn(
      { event: ADMIN_AUTH_AUDIT.loginFailed, userId, failedLoginCount: result.failedLoginCount },
      'staff sign-in failed',
    );
    if (result.counted && result.lockedUntil !== null) {
      this.logger.warn({ event: ADMIN_AUTH_AUDIT.accountLocked, userId }, 'account locked');
    }
  }

  /** The challenge token for an enrolled `MANAGER` or `ADMIN`, else the enrolment token. */
  private async mfaChallengeFor(userId: string): Promise<MfaChallenge> {
    const enrolled = await this.mfa.isEnrolled(userId);
    const { token, expiresIn } = await signMfaToken(
      this.keys,
      this.clock.now(),
      enrolled ? MFA_CHALLENGE_TOKEN_TYPE : MFA_ENROLMENT_TOKEN_TYPE,
      userId,
    );
    return { mfaToken: token, mfaEnrolled: enrolled, expiresIn };
  }

  /** The account that holds `refreshToken`, or `null` for an unknown token. */
  private async ownerOf(
    refreshToken: string,
  ): Promise<Pick<User, 'id' | 'role' | 'status'> | null> {
    const row = await this.dataSource.manager.findOne(RefreshToken, {
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });
    if (row === null) {
      return null;
    }
    return this.users.findById(row.userId);
  }

  /** The body and cookie values of a started session. */
  signInOf(
    tokens: SessionTokens,
    user: Pick<User, 'id' | 'displayName'> & { readonly role: StaffRole },
  ): AdminSignIn {
    const remainingMs = tokens.accessTokenExpiresAt.getTime() - this.clock.now().getTime();
    return {
      session: {
        accessToken: tokens.accessToken,
        expiresIn: Math.max(0, Math.floor(remainingMs / 1000)),
        user: { id: user.id, displayName: user.displayName, role: user.role },
      },
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  }
}
