import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { normalizeVietnamMobile } from '../../common/phone/vietnam-phone.js';
import { AuditService } from '../audit/audit.service.js';
import { Branch } from '../branches/entities/branch.entity.js';
import type { ConsentDocumentType } from './entities/consent-document.entity.js';
import type { ConsentAction } from './entities/user-consent.entity.js';
import { User } from './entities/user.entity.js';
import { PasswordHasher } from './password-hasher.js';
import { checkPasswordPolicy, passwordAudienceOf } from './password-policy.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

/** The `event` field of the log lines of `POST /me/password` (proposal, api-divergences D-060). */
export const ME_EVENTS = {
  passwordChanged: 'auth.password_changed',
  passwordChangeFailed: 'auth.password_change_failed',
  // The audit action and log event of a lock, shared with the sign-in (`AuthService`).
  accountLocked: 'auth.account_locked',
} as const;

/** `GET /me` (api-outline "Current user"; mobile G94; api-divergences D-059). */
export interface MeProfile {
  readonly id: string;
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly displayName: string;
  readonly phone: string | null;
  readonly avatarUrl: string | null;
  readonly preferredBranchId: string | null;
}

/** One item of `GET /me/consents` (api-divergences D-062). */
export interface MyConsent {
  readonly documentId: string;
  readonly type: ConsentDocumentType;
  readonly version: string;
  readonly locale: string;
  readonly action: ConsentAction;
  readonly occurredAt: string;
}

/** The validated body of `PATCH /me`: `undefined` keeps a field, `null` clears it. */
export interface ProfilePatch {
  readonly displayName?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly preferredBranchId?: string | null | undefined;
}

/** The columns a `PATCH /me` writes; a key is present only when the body named the field. */
export interface ProfileChanges {
  displayName?: string;
  phone?: string | null;
  preferredBranchId?: string | null;
}

export function toMeProfile(user: User): MeProfile {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    displayName: user.displayName,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    preferredBranchId: user.preferredBranchId,
  };
}

/**
 * The merge rules of `PATCH /me`, without the database: a missing field is not changed;
 * `displayName` is trimmed and may not be blank (`REQUIRED`); `phone` is normalised to E.164
 * (`INVALID_PHONE` otherwise, a blank string included) or cleared by `null`; `preferredBranchId`
 * is copied (its existence is checked by the service) or cleared by `null`. Every field error is
 * collected. The rejected values are never put in an error.
 */
export function planProfilePatch(patch: ProfilePatch): {
  readonly changes: ProfileChanges;
  readonly errors: readonly ApiFieldError[];
} {
  const changes: ProfileChanges = {};
  const errors: ApiFieldError[] = [];

  if (patch.displayName !== undefined) {
    const displayName = patch.displayName.trim();
    if (displayName === '') {
      errors.push({ field: 'displayName', code: 'REQUIRED', message: 'is required' });
    } else {
      changes.displayName = displayName;
    }
  }

  if (patch.phone === null) {
    changes.phone = null;
  } else if (patch.phone !== undefined) {
    const phone = normalizeVietnamMobile(patch.phone);
    if (phone === null) {
      errors.push({
        field: 'phone',
        code: 'INVALID_PHONE',
        message: 'must be a Vietnamese mobile number',
      });
    } else {
      changes.phone = phone;
    }
  }

  if (patch.preferredBranchId !== undefined) {
    changes.preferredBranchId = patch.preferredBranchId;
  }

  return { changes, errors };
}

/**
 * The signed-in user's own account (api-outline "Current user", A2-T4). The acting user is always
 * the id of the access token; no method takes a user id from a body, path or query. Profile changes
 * write no audit row and log nothing, so the phone never reaches a log.
 */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string): Promise<MeProfile> {
    return toMeProfile(await this.requireUser(userId));
  }

  /**
   * Applies `planProfilePatch`, then checks that a named branch exists and is not deleted
   * (`VALIDATION_FAILED` with the field code `NOT_FOUND`, api-divergences D-061). An empty body
   * changes nothing and returns the profile.
   */
  async updateProfile(userId: string, patch: ProfilePatch): Promise<MeProfile> {
    const { changes, errors } = planProfilePatch(patch);
    const fieldErrors = [...errors];
    if (typeof changes.preferredBranchId === 'string') {
      const exists = await this.dataSource.getRepository(Branch).exists({
        where: { id: changes.preferredBranchId, deletedAt: IsNull() },
      });
      if (!exists) {
        fieldErrors.push({
          field: 'preferredBranchId',
          code: 'NOT_FOUND',
          message: 'does not exist',
        });
      }
    }
    if (fieldErrors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors: fieldErrors });
    }

    if (Object.keys(changes).length > 0) {
      await this.dataSource
        .createQueryBuilder()
        .update(User)
        .set(changes)
        .where('id = :id', { id: userId })
        .updateEntity(false)
        .execute();
    }
    return this.getProfile(userId);
  }

  /**
   * `POST /me/password` (api-divergences D-060). In order: an account without a password (social
   * only) is `INVALID_STATE`, since how it sets a first password is open (mobile G98); the policy
   * of the account's role on `newPassword` (`VALIDATION_FAILED`, no attempt counted); a locked
   * account is `INVALID_CREDENTIALS` after a dummy verification, without counting; a wrong current
   * password is `INVALID_CREDENTIALS` and counts toward the lockout, as at sign-in (decision 0008
   * section 4). On success, in one transaction: the new hash (lockout cleared) and every refresh
   * family revoked except the current one, `sid` of the access token.
   */
  async changePassword(
    actor: { readonly id: string; readonly sessionId: string },
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.requireUser(actor.id);
    if (user.passwordHash === null) {
      throw new ApiError('INVALID_STATE', { detail: 'This account has no password to change.' });
    }
    const policyErrors = checkPasswordPolicy(
      newPassword,
      passwordAudienceOf(user.role),
      user.email,
    ).map((error) => ({ ...error, field: 'newPassword' }));
    if (policyErrors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors: policyErrors });
    }
    if (this.users.isLocked(user)) {
      await this.hasher.verifyOrDummy(null, currentPassword);
      throw new ApiError('INVALID_CREDENTIALS');
    }
    if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
      await this.recordWrongPassword(user.id);
      throw new ApiError('INVALID_CREDENTIALS');
    }

    const revokedSessions = await this.dataSource.transaction(async (em) => {
      await this.users.setPassword(user.id, newPassword, em);
      return this.sessions.revokeAllExcept(user.id, actor.sessionId, em);
    });
    this.logger.log(
      { event: ME_EVENTS.passwordChanged, userId: user.id, revokedSessions },
      'password changed',
    );
  }

  /**
   * The latest consent event per document type (`user_consents` is an append-only log, the
   * current state is the latest row), in the order of the `consent_document_type` enum (Terms of
   * Service, then Privacy Policy). Nothing is written here: withdrawal is
   * account deletion in the first release (ADR-0008 #5).
   */
  async listConsents(userId: string): Promise<MyConsent[]> {
    const rows: {
      document_id: string;
      type: ConsentDocumentType;
      version: string;
      locale: string;
      action: ConsentAction;
      occurred_at: Date;
    }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (document.type)
              consent.document_id, document.type::text AS type, document.version, document.locale,
              consent.action::text AS action, consent.occurred_at
         FROM public.user_consents consent
         JOIN public.consent_documents document ON document.id = consent.document_id
        WHERE consent.user_id = $1
        ORDER BY document.type, consent.occurred_at DESC, consent.id DESC`,
      [userId],
    );
    return rows.map((row) => ({
      documentId: row.document_id,
      type: row.type,
      version: row.version,
      locale: row.locale,
      action: row.action,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  /**
   * Counts a wrong current password like a wrong sign-in password (decision 0008 section 4): the
   * same counter and schedule, and the `auth.account_locked` audit row in the transaction that
   * locks. The log lines follow the commit.
   */
  private async recordWrongPassword(userId: string): Promise<void> {
    const failure = await this.dataSource.transaction(async (em) => {
      const result = await this.users.recordFailedLogin(userId, em);
      if (result.counted && result.lockedUntil !== null) {
        await this.audit.write(
          {
            actorUserId: null,
            action: ME_EVENTS.accountLocked,
            entityType: 'USER',
            entityId: userId,
            diff: {
              failedLoginCount: result.failedLoginCount,
              lockedUntil: result.lockedUntil.toISOString(),
            },
          },
          em,
        );
      }
      return result;
    });
    this.logger.warn(
      {
        event: ME_EVENTS.passwordChangeFailed,
        userId,
        failedLoginCount: failure.failedLoginCount,
      },
      'password change refused: wrong current password',
    );
    if (failure.counted && failure.lockedUntil !== null) {
      this.logger.warn({ event: ME_EVENTS.accountLocked, userId }, 'account locked');
    }
  }

  /** The token's user; a missing row (an id from a token that outlived it) is `UNAUTHENTICATED`. */
  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (user === null) {
      throw new ApiError('UNAUTHENTICATED');
    }
    return user;
  }
}
