import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { MANAGER_ROLES } from '../../../common/auth/roles.decorator.js';
import { ApiError } from '../../../common/errors/api-error.js';
import type { ApiFieldError } from '../../../common/errors/api-error.js';
import { Clock } from '../../../common/time/clock.js';
import { InjectAppConfig } from '../../../config/config.module.js';
import type { ServerConfig } from '../../../config/load-config.js';
import type { AuditAction } from '../../audit/audit-actions.js';
import { AuditService } from '../../audit/audit.service.js';
import { User } from '../../users/entities/user.entity.js';
import { isLocked } from '../../users/lockout.js';
import { PasswordHasher } from '../../users/password-hasher.js';
import { UsersService } from '../../users/users.service.js';
import { MfaCredential } from '../entities/mfa-credential.entity.js';
import {
  findRecoveryCodeHash,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
} from './recovery-codes.js';
import { SecretCipher } from './secret-cipher.js';
import {
  generateTotpSecret,
  normalizeTotpCode,
  totpIssuer,
  totpSecretBase32,
  totpUri,
  verifyTotp,
} from './totp.js';

/** Audit codes of the second factor (catalogue in `@kd/contracts`; brief E17, D-081). */
export const MFA_AUDIT = {
  requested: 'auth.mfa_requested',
  succeeded: 'auth.mfa_succeeded',
  failed: 'auth.mfa_failed',
  enrolled: 'auth.mfa_enrolled',
  recoveryCodeUsed: 'auth.mfa_recovery_code_used',
  recoveryCodesRegenerated: 'auth.mfa_recovery_codes_regenerated',
  accountLocked: 'auth.account_locked',
} as const satisfies Readonly<Record<string, AuditAction>>;

/** How the second step was answered; stored in audit diffs, never the code itself. */
export type SecondFactorMethod = 'TOTP' | 'RECOVERY_CODE';

export interface SecondFactor {
  readonly method: SecondFactorMethod;
  /** As typed; normalised here. Never logged. */
  readonly code: string;
}

/** The code the caller answers when the account may not use the MFA routes at all. */
export type MfaRefusal = 'UNAUTHENTICATED' | 'FORBIDDEN';

/** `POST /me/mfa/setup`: shown once; the secret is never returned again. */
export interface MfaSetup {
  readonly otpauthUri: string;
  /** Base32, for typing into an authenticator app by hand. */
  readonly secret: string;
}

export interface MfaEnrolment<T> {
  /** The ten codes, formatted `XXXXX-XXXXX`; shown once. */
  readonly recoveryCodes: readonly string[];
  /** What the caller did in the enrolment transaction (the session of the enrolment token). */
  readonly value: T;
}

export interface SecondStep<T> {
  readonly value: T;
  readonly recoveryCodesLeft: number;
}

/** Work joined to the transaction that spends a code (a session started, for example). */
export type InTransaction<T> = (em: EntityManager, user: User) => Promise<T>;

function codeInvalid(): ApiError {
  // One body for a wrong, replayed or locked-out code (brief E15): no hint of the cause.
  return new ApiError('CODE_INVALID');
}

function formatError(field: string, message: string): ApiError {
  // The generic field code (api-divergences D-001); the message never repeats the value.
  const error: ApiFieldError = { field, code: 'INVALID', message };
  return new ApiError('VALIDATION_FAILED', { errors: [error] });
}

const MFA_ROLE_SET: ReadonlySet<string> = new Set(MANAGER_ROLES);

/**
 * TOTP enrolment, recovery codes and the second step of a staff sign-in (A3-T2; ADR-0009 `WA4`,
 * `WA20`; decision 0008 sections 4 and 8). `MANAGER` and `ADMIN` only. A wrong, replayed or
 * locked-out code is `CODE_INVALID`; a wrong code counts toward the staff lockout like a wrong
 * password (brief E15). The secret, the codes and their hashes never reach a log line, an audit
 * diff or an error; the secret and the codes are returned once, by setup and by the code-set
 * routes.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
    @InjectAppConfig() private readonly config: ServerConfig,
  ) {}

  /**
   * The account behind an MFA route, read fresh: `ACTIVE` and `MANAGER` or `ADMIN` now (a role or
   * status change after the token was issued counts). Otherwise `refusal`, with no detail.
   */
  async requireMfaUser(userId: string, refusal: MfaRefusal): Promise<User> {
    const user = await this.users.findById(userId);
    if (user === null || user.status !== 'ACTIVE' || !MFA_ROLE_SET.has(user.role)) {
      throw new ApiError(refusal);
    }
    return user;
  }

  /** True when `userId` has a confirmed second factor (`enabled_at` set). */
  async isEnrolled(userId: string, manager?: EntityManager): Promise<boolean> {
    const credential = await (manager ?? this.dataSource.manager).findOne(MfaCredential, {
      where: { userId },
    });
    return credential !== null && credential.enabledAt !== null;
  }

  /**
   * Creates the pending credential, or replaces a pending one (new secret, no step, no codes).
   * An enabled credential is never replaced here: `409 ALREADY_EXISTS` (a reset is A3-T4).
   */
  async setup(user: User): Promise<MfaSetup> {
    const secret = generateTotpSecret();
    try {
      const secretEncrypted = this.cipher.encrypt(secret, user.id);
      const inserted = await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(MfaCredential)
        .values({ userId: user.id, secretEncrypted })
        .orIgnore()
        .returning('user_id')
        .updateEntity(false)
        .execute();
      if ((inserted.raw as unknown[]).length === 0) {
        const replaced = await this.dataSource
          .createQueryBuilder()
          .update(MfaCredential)
          .set({ secretEncrypted, lastUsedStep: null, recoveryCodeHashes: [] })
          .where('user_id = :id AND enabled_at IS NULL', { id: user.id })
          .updateEntity(false)
          .execute();
        if (replaced.affected !== 1) {
          throw new ApiError('ALREADY_EXISTS');
        }
      }
      return {
        otpauthUri: totpUri(secret, totpIssuer(this.config.appEnv), user.email),
        secret: totpSecretBase32(secret),
      };
    } finally {
      secret.fill(0);
    }
  }

  /**
   * Confirms the pending credential with a current code: `enabled_at`, the accepted step and ten
   * new recovery codes, `auth.mfa_enrolled`, then `then` in the same transaction (the enrolment
   * token starts the session there, decision 0008 section 8).
   */
  async confirm<T>(
    user: User,
    typedCode: string,
    then: InTransaction<T>,
  ): Promise<MfaEnrolment<T>> {
    const code = totpCodeOf(typedCode);
    const credential = await this.credentialOf(user.id);
    if (credential === null) {
      // Nothing to check against: setup comes first. Not counted.
      throw codeInvalid();
    }
    if (credential.enabledAt !== null) {
      throw new ApiError('ALREADY_EXISTS');
    }
    await this.refuseWhileLocked(user, 'TOTP');
    const checked = this.checkTotp(credential, code);
    if (checked === null) {
      return this.wrongCode(user.id, 'TOTP');
    }

    // Hashed before the transaction, so no row lock waits on argon2.
    const recoveryCodes = generateRecoveryCodes();
    const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes, this.hasher);
    const outcome = await this.dataSource.transaction(async (em) => {
      const left = await this.claimStep(em, credential, checked, {
        enabledAt: this.clock.now(),
        recoveryCodeHashes,
      });
      if (left === null) {
        return null;
      }
      await this.audit.write(
        {
          actorUserId: user.id,
          action: MFA_AUDIT.enrolled,
          entityType: 'USER',
          entityId: user.id,
          diff: { recoveryCodesLeft: left },
        },
        em,
      );
      return { value: await then(em, user) };
    });
    if (outcome === null) {
      return this.wrongCode(user.id, 'TOTP');
    }
    this.logger.log({ event: MFA_AUDIT.enrolled, userId: user.id }, 'second factor enrolled');
    return { recoveryCodes, value: outcome.value };
  }

  /**
   * Replaces the whole recovery set after a current TOTP code (decision 0008 section 8). No
   * confirmed credential: `409 MFA_NOT_ENABLED`.
   */
  async regenerateRecoveryCodes(user: User, typedCode: string): Promise<readonly string[]> {
    const code = totpCodeOf(typedCode);
    const credential = await this.credentialOf(user.id);
    if (credential === null || credential.enabledAt === null) {
      throw new ApiError('MFA_NOT_ENABLED');
    }
    await this.refuseWhileLocked(user, 'TOTP');
    const checked = this.checkTotp(credential, code);
    if (checked === null) {
      return this.wrongCode(user.id, 'TOTP');
    }

    const recoveryCodes = generateRecoveryCodes();
    const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes, this.hasher);
    const claimed = await this.dataSource.transaction(async (em) => {
      const left = await this.claimStep(em, credential, checked, { recoveryCodeHashes });
      if (left === null) {
        return false;
      }
      await this.audit.write(
        {
          actorUserId: user.id,
          action: MFA_AUDIT.recoveryCodesRegenerated,
          entityType: 'USER',
          entityId: user.id,
          diff: { recoveryCodesLeft: left },
        },
        em,
      );
      return true;
    });
    if (!claimed) {
      return this.wrongCode(user.id, 'TOTP');
    }
    this.logger.log(
      { event: MFA_AUDIT.recoveryCodesRegenerated, userId: user.id },
      'recovery codes replaced',
    );
    return recoveryCodes;
  }

  /**
   * The second step of a `MANAGER` or `ADMIN` sign-in (`POST /admin/auth/mfa/verify`). The account
   * must still be `ACTIVE`, of an MFA role and enrolled, else `UNAUTHENTICATED` (the challenge is
   * void; signing in again leads to enrolment). A TOTP code claims its step; a recovery code is
   * removed from the set under the row lock of its `UPDATE`. Both in the transaction that runs
   * `then` (the session), with `auth.mfa_succeeded` (and `auth.mfa_recovery_code_used`).
   */
  async verifySecondFactor<T>(
    userId: string,
    factor: SecondFactor,
    then: InTransaction<T>,
  ): Promise<SecondStep<T>> {
    const user = await this.requireMfaUser(userId, 'UNAUTHENTICATED');
    const typed = factor.method === 'TOTP' ? totpCodeOf(factor.code) : recoveryCodeOf(factor.code);
    const credential = await this.credentialOf(user.id);
    if (credential === null || credential.enabledAt === null) {
      throw new ApiError('UNAUTHENTICATED');
    }
    await this.refuseWhileLocked(user, factor.method);

    let spend: (em: EntityManager) => Promise<number | null>;
    if (factor.method === 'TOTP') {
      const checked = this.checkTotp(credential, typed);
      if (checked === null) {
        return this.wrongCode(user.id, factor.method);
      }
      spend = (em) => this.claimStep(em, credential, checked, {});
    } else {
      const hash = await findRecoveryCodeHash(credential.recoveryCodeHashes, typed, this.hasher);
      if (hash === undefined) {
        return this.wrongCode(user.id, factor.method);
      }
      spend = (em) => this.spendRecoveryCode(em, user.id, hash);
    }

    const outcome = await this.dataSource.transaction(async (em) => {
      const left = await spend(em);
      if (left === null) {
        return null;
      }
      await this.audit.write(
        {
          actorUserId: user.id,
          action: MFA_AUDIT.succeeded,
          entityType: 'USER',
          entityId: user.id,
          diff: { method: factor.method },
        },
        em,
      );
      if (factor.method === 'RECOVERY_CODE') {
        await this.audit.write(
          {
            actorUserId: user.id,
            action: MFA_AUDIT.recoveryCodeUsed,
            entityType: 'USER',
            entityId: user.id,
            diff: { recoveryCodesLeft: left },
          },
          em,
        );
      }
      return { value: await then(em, user), recoveryCodesLeft: left };
    });
    if (outcome === null) {
      // Spent by a concurrent request between the check and the claim: a replay.
      return this.wrongCode(user.id, factor.method);
    }
    this.logger.log(
      { event: MFA_AUDIT.succeeded, userId: user.id, method: factor.method },
      'second factor accepted',
    );
    return outcome;
  }

  /** `auth.mfa_requested` after a correct password (login answers `MFA_REQUIRED`). */
  async recordRequested(userId: string, enrolled: boolean): Promise<void> {
    await this.audit.write({
      actorUserId: null,
      action: MFA_AUDIT.requested,
      entityType: 'USER',
      entityId: userId,
      diff: { enrolled },
    });
    this.logger.log({ event: MFA_AUDIT.requested, userId, enrolled }, 'second factor requested');
  }

  private credentialOf(userId: string): Promise<MfaCredential | null> {
    return this.dataSource.manager.findOne(MfaCredential, { where: { userId } });
  }

  /**
   * The accepted step and, when a previous key decrypted the secret, the value re-encrypted with
   * the current key (decision 0008 section 8, rotation); `null` for a wrong or replayed code.
   */
  private checkTotp(
    credential: MfaCredential,
    code: string,
  ): { readonly step: number; readonly reencrypted: string | null } | null {
    const { plaintext, current } = this.cipher.decrypt(
      credential.secretEncrypted,
      credential.userId,
    );
    try {
      const step = verifyTotp(plaintext, code, this.clock.now(), credential.lastUsedStep);
      if (step === null) {
        return null;
      }
      return {
        step,
        reencrypted: current ? null : this.cipher.encrypt(plaintext, credential.userId),
      };
    } finally {
      plaintext.fill(0);
    }
  }

  /**
   * Spends a TOTP step (decision 0008 section 8, replay rule): one conditional `UPDATE` that also
   * writes `changes`, only while the row still holds the secret that was checked and is in the same
   * state (pending or enabled). Returns the recovery codes left, or `null` when it changed nothing.
   */
  private async claimStep(
    em: EntityManager,
    credential: MfaCredential,
    checked: { readonly step: number; readonly reencrypted: string | null },
    changes: Partial<Pick<MfaCredential, 'enabledAt' | 'recoveryCodeHashes'>>,
  ): Promise<number | null> {
    const result = await em
      .createQueryBuilder()
      .update(MfaCredential)
      .set({
        ...changes,
        lastUsedStep: checked.step,
        ...(checked.reencrypted === null ? {} : { secretEncrypted: checked.reencrypted }),
      })
      .where('user_id = :id', { id: credential.userId })
      .andWhere('secret_encrypted = :checked', { checked: credential.secretEncrypted })
      .andWhere(credential.enabledAt === null ? 'enabled_at IS NULL' : 'enabled_at IS NOT NULL')
      .andWhere('(last_used_step IS NULL OR last_used_step < :step)', { step: checked.step })
      .returning('cardinality(recovery_code_hashes) AS recovery_codes_left')
      .updateEntity(false)
      .execute();
    return leftOf(result.raw);
  }

  /** Removes one recovery code hash if it is still in the set; `null` when already spent. */
  private async spendRecoveryCode(
    em: EntityManager,
    userId: string,
    hash: string,
  ): Promise<number | null> {
    const result = await em
      .createQueryBuilder()
      .update(MfaCredential)
      .set({ recoveryCodeHashes: () => 'array_remove(recovery_code_hashes, :hash)' })
      .where('user_id = :id AND enabled_at IS NOT NULL AND :hash = ANY(recovery_code_hashes)', {
        id: userId,
        hash,
      })
      .returning('cardinality(recovery_code_hashes) AS recovery_codes_left')
      .updateEntity(false)
      .execute();
    return leftOf(result.raw);
  }

  /**
   * While `locked_until` is in the future no code is checked or counted (decision 0008 section 4);
   * the answer is the same `CODE_INVALID` as a wrong code, so the lock is not revealed (E15).
   */
  private async refuseWhileLocked(user: User, method: SecondFactorMethod): Promise<void> {
    if (!isLocked(user, this.clock.now())) {
      return;
    }
    await this.audit.write({
      actorUserId: null,
      action: MFA_AUDIT.failed,
      entityType: 'USER',
      entityId: user.id,
      diff: { method, reason: 'LOCKED' },
    });
    this.logger.warn(
      { event: MFA_AUDIT.failed, userId: user.id, method, reason: 'LOCKED' },
      'second factor refused',
    );
    throw codeInvalid();
  }

  /**
   * Counts a wrong code toward the staff lockout (the same counter as a wrong password, brief
   * E15), audits it and the lock in one transaction, then answers `CODE_INVALID`.
   */
  private async wrongCode(userId: string, method: SecondFactorMethod): Promise<never> {
    const result = await this.dataSource.transaction(async (em) => {
      const failure = await this.users.recordFailedLogin(userId, em);
      await this.audit.write(
        {
          actorUserId: null,
          action: MFA_AUDIT.failed,
          entityType: 'USER',
          entityId: userId,
          diff: { method, reason: 'WRONG_CODE', failedLoginCount: failure.failedLoginCount },
        },
        em,
      );
      if (failure.counted && failure.lockedUntil !== null) {
        await this.audit.write(
          {
            actorUserId: null,
            action: MFA_AUDIT.accountLocked,
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
      { event: MFA_AUDIT.failed, userId, method, failedLoginCount: result.failedLoginCount },
      'second factor failed',
    );
    if (result.counted && result.lockedUntil !== null) {
      this.logger.warn({ event: MFA_AUDIT.accountLocked, userId }, 'account locked');
    }
    throw codeInvalid();
  }
}

function totpCodeOf(typed: string): string {
  const code = normalizeTotpCode(typed);
  if (code === null) {
    // A malformed code is not an attempt: not counted (as email codes, decision 0008 section 6).
    throw formatError('code', 'must be 6 digits');
  }
  return code;
}

function recoveryCodeOf(typed: string): string {
  const code = normalizeRecoveryCode(typed);
  if (code === null) {
    throw formatError('recoveryCode', 'must be 10 letters or digits (XXXXX-XXXXX)');
  }
  return code;
}

function leftOf(raw: unknown): number | null {
  const rows = raw as { recovery_codes_left: number | string }[];
  const row = rows[0];
  return row === undefined ? null : Number(row.recovery_codes_left);
}
