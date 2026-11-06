import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { EmailToken } from '../../modules/auth/entities/email-token.entity.js';
import type { EmailTokenType } from '../../modules/auth/entities/email-token.entity.js';
import { User } from '../../modules/users/entities/user.entity.js';
import { isLocked } from '../../modules/users/lockout.js';
import { Clock } from '../time/clock.js';

/** At most one message per user and type every 60 s (decision 0008 section 6; api-outline). */
export const RESEND_INTERVAL_MS = 60_000;

export type ResendDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** Whole seconds until the next message may be sent, at least 1. */
      readonly retryAfterSeconds: number;
    };

/**
 * Per-account decisions kept in PostgreSQL (decision 0007 section 5), read from existing columns
 * only: `users.locked_until` (with `failed_login_count`, maintained by
 * `UsersService.recordFailedLogin` and `recordSuccessfulLogin`, A1-T5) and the newest
 * `email_tokens.created_at`. It decides; it never writes, so the lockout counter keeps one writer.
 *
 * The daily cap of 5 messages per user and type (decision 0008 section 6, header row 11) is not
 * here: `EmailCodeService` applies it to customer codes (A2-T2, under its row lock on the user),
 * and the staff link task of A3 applies it to links.
 *
 * Every method takes an optional `EntityManager`, so a caller can read inside its own transaction.
 */
@Injectable()
export class AccountThrottleService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * Whether the account is locked now (`locked_until > now`). An unknown id is not locked: the
   * caller runs its dummy-hash path. The caller never shows the unlock time or the cause: a locked
   * account answers the same `401 INVALID_CREDENTIALS` (decision 0008 sections 4 and 5).
   */
  async isSignInLocked(userId: string, manager?: EntityManager): Promise<boolean> {
    const user = await (manager ?? this.dataSource.manager).findOne(User, {
      select: { id: true, lockedUntil: true },
      where: { id: userId },
    });
    return user !== null && isLocked(user, this.clock.now());
  }

  /**
   * The 60 s resend rule for one user and token type, from the `created_at` of the newest
   * `email_tokens` row (used, expired or live). The customer endpoints still answer their generic
   * `202` when refused (decision 0008 section 5); `retryAfterSeconds` is for the staff resend
   * actions, which may show it.
   */
  async resendDecision(
    userId: string,
    type: EmailTokenType,
    manager?: EntityManager,
  ): Promise<ResendDecision> {
    const newest = await (manager ?? this.dataSource.manager).findOne(EmailToken, {
      select: { id: true, createdAt: true },
      where: { userId, type },
      order: { createdAt: 'DESC' },
    });
    if (newest === null) {
      return { allowed: true };
    }
    const waitMs = newest.createdAt.getTime() + RESEND_INTERVAL_MS - this.clock.now().getTime();
    if (waitMs <= 0) {
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }
}
