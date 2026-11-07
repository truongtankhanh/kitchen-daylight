import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import { AccountThrottleService } from '../../common/throttling/account-throttle.service.js';
import { Clock } from '../../common/time/clock.js';
import { InjectAppConfig } from '../../config/config.module.js';
import type { ServerConfig } from '../../config/load-config.js';
import type { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { MailDeliveryError } from '../mail/ports/mail.port.js';
import type { MailMessage } from '../mail/ports/mail.port.js';
import { renderStaffInvite } from '../mail/templates/staff-invite.template.js';
import { renderStaffPasswordReset } from '../mail/templates/staff-password-reset.template.js';
import type { RenderedMail } from '../mail/templates/verify-email-code.template.js';
import { User } from '../users/entities/user.entity.js';
import { normalizeEmail } from '../users/email.js';
import { checkPasswordPolicy } from '../users/password-policy.js';
import { UsersService } from '../users/users.service.js';
import { isStaffRole } from './admin-auth.service.js';
import { dailyWindowStart, EMAIL_CODE_DAILY_CAP } from './email-code.service.js';
import { EmailToken } from './entities/email-token.entity.js';
import type { EmailTokenType } from './entities/email-token.entity.js';
import { RefreshTokenService } from './refresh-token.service.js';

/** The two staff link purposes (ADR-0008 #2; `email_tokens.channel = LINK`). */
export type StaffLinkType = Extract<EmailTokenType, 'INVITE' | 'RESET_PASSWORD'>;

/** Lifetimes of ADR-0003 and ADR-0008 #2 (decision 0008 section 6). */
export const STAFF_INVITE_TTL_HOURS = 48;
export const STAFF_RESET_TTL_MINUTES = 30;
export const STAFF_LINK_TTL_MS: Readonly<Record<StaffLinkType, number>> = Object.freeze({
  INVITE: STAFF_INVITE_TTL_HOURS * 60 * 60 * 1000,
  RESET_PASSWORD: STAFF_RESET_TTL_MINUTES * 60 * 1000,
});

/** 256 bits from the CSPRNG (decision 0008 section 6). */
export const STAFF_LINK_TOKEN_BYTES = 32;
/** Unpadded base64url of 32 bytes. */
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
/** A link is spent by its one use; `email_tokens.max_attempts` must be at least 1. */
const LINK_MAX_ATTEMPTS = 1;

/**
 * Admin web routes the links open (a contract with the admin track, api-divergences D-085). The
 * token travels in the fragment, never in the query (decision 0008 section 6).
 */
export const STAFF_LINK_PATHS: Readonly<Record<StaffLinkType, string>> = Object.freeze({
  INVITE: '/auth/set-password',
  RESET_PASSWORD: '/auth/reset-password',
});

/** The `event` field of the log lines of this flow: user id and type only, never a token or address. */
export const STAFF_LINK_EVENTS = {
  dailyCapReached: 'auth.staff_link_daily_cap',
  sendFailed: 'auth.staff_link_send_failed',
  passwordSet: 'auth.password_set',
  passwordResetCompleted: 'auth.password_reset_completed',
} as const;

/** Audit codes of this flow (catalogue in `@kd/contracts`; api-divergences D-086). */
export const STAFF_LINK_AUDIT = {
  resetRequested: 'auth.password_reset_requested',
  passwordSet: 'auth.password_set',
  resetCompleted: 'auth.password_reset_completed',
} as const satisfies Readonly<Record<string, AuditAction>>;

/** A new link token: 32 random bytes, unpadded base64url (43 characters). */
export function generateLinkToken(draw: (size: number) => Buffer = randomBytes): string {
  return draw(STAFF_LINK_TOKEN_BYTES).toString('base64url');
}

/** Whether `token` has the shape `generateLinkToken` produces; anything else is unknown. */
export function isLinkTokenFormat(token: string): boolean {
  return LINK_TOKEN_PATTERN.test(token);
}

/** `email_tokens.token_hash` of a link: plain SHA-256, the token has 256 bits of entropy. */
export function hashLinkToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Expiry of a link of `type` issued at `now`. */
export function staffLinkExpiresAt(type: StaffLinkType, now: Date): Date {
  return new Date(now.getTime() + STAFF_LINK_TTL_MS[type]);
}

/** Live: neither used nor superseded, and not expired (`expires_at` is exclusive). */
export function isStaffLinkLive(row: Pick<EmailToken, 'usedAt' | 'expiresAt'>, now: Date): boolean {
  return row.usedAt === null && row.expiresAt.getTime() > now.getTime();
}

/** `<admin origin><route>#token=<token>` (decision 0008 section 6). */
export function staffLinkUrl(adminOrigin: string, type: StaffLinkType, token: string): string {
  return `${adminOrigin}${STAFF_LINK_PATHS[type]}#token=${token}`;
}

/**
 * The link an account may receive: an `INVITED` staff account an invitation (it has no password
 * yet, so a reset makes no sense; api-divergences D-084), an `ACTIVE` one a reset. Customers,
 * suspended and deleted accounts receive nothing.
 */
export function staffLinkTypeFor(user: Pick<User, 'role' | 'status'>): StaffLinkType | null {
  if (!isStaffRole(user.role)) {
    return null;
  }
  if (user.status === 'INVITED') {
    return 'INVITE';
  }
  return user.status === 'ACTIVE' ? 'RESET_PASSWORD' : null;
}

/**
 * Result of `issueInvite` and `issueReset`, for the admin actions of A3-T4 to map: `NOT_ELIGIBLE`
 * (the account is not an `INVITED` or `ACTIVE` staff account for that link, `INVALID_STATE`),
 * `RESEND_TOO_SOON` (60 s rule, `RATE_LIMITED` with `Retry-After`), `DAILY_CAP` (5 per 24 h).
 */
export type StaffLinkIssue =
  | { readonly issued: true }
  | { readonly issued: false; readonly reason: 'NOT_ELIGIBLE' | 'DAILY_CAP' }
  | {
      readonly issued: false;
      readonly reason: 'RESEND_TOO_SOON';
      readonly retryAfterSeconds: number;
    };

/** Inside the issuing transaction only: the token leaves it to build the mail, nowhere else. */
type IssueOutcome =
  | { readonly kind: 'issued'; readonly token: string; readonly to: string }
  | { readonly kind: 'refused'; readonly result: Exclude<StaffLinkIssue, { issued: true }> };

interface SpentLink {
  readonly userId: string;
  readonly type: StaffLinkType;
  readonly failedLoginCountCleared: number;
}

interface ConsumedRow {
  readonly user_id: string;
  readonly type: StaffLinkType;
  readonly target_email: string;
}

function codeInvalid(): ApiError {
  // One body for expired, used, superseded and unknown links (brief E19; decision 0008 section 5).
  return new ApiError('CODE_INVALID');
}

/**
 * Staff invitation and password links (A3-T3; ADR-0003 "Email flows", ADR-0008 #2; decision 0008
 * sections 4 to 7). A link token is 256 random bits, stored only as its SHA-256, single use, one
 * live per user and type (a new one supersedes the old in the issuing transaction), 48 hours for
 * an invitation and 30 minutes for a reset. At most one message per user and type every 60 s
 * (`AccountThrottleService`) and 5 in 24 hours.
 *
 * The token and the link appear only in the mail body: never in a log line, an audit diff, an
 * error or a response. The mail goes out after the commit and the response never waits for it; a
 * failed send is logged without the address.
 */
@Injectable()
export class StaffLinkService {
  // Nest's logger, routed to pino (decision 0005 section 11), as in `EmailCodeService`.
  private readonly logger = new Logger(StaffLinkService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(AccountThrottleService) private readonly throttle: AccountThrottleService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(Clock) private readonly clock: Clock,
    @InjectAppConfig() private readonly config: ServerConfig,
  ) {}

  /** A new invitation link (48 hours) for an `INVITED` staff account; used by A3-T4. */
  issueInvite(userId: string): Promise<StaffLinkIssue> {
    return this.issue(userId, 'INVITE', false);
  }

  /** A new reset link (30 minutes) for an `ACTIVE` staff account; used by A3-T4. */
  issueReset(userId: string): Promise<StaffLinkIssue> {
    return this.issue(userId, 'RESET_PASSWORD', false);
  }

  /**
   * `POST /admin/auth/password/forgot`. An `ACTIVE` staff account gets a reset link, an `INVITED`
   * one a fresh invitation (api-divergences D-084); an unknown email, a customer, a suspended or a
   * deleted account gets nothing. Every case answers the same, so nothing is returned.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    const type = user === null ? null : staffLinkTypeFor(user);
    if (user === null || type === null) {
      return;
    }
    await this.issue(user.id, type, true);
  }

  /**
   * `POST /admin/auth/password/set`. The password length is judged first, on the input alone
   * (`VALIDATION_FAILED`). The link is spent by one conditional `UPDATE` in the transaction that
   * sets the password, so a second use, a superseded, an expired or an unknown token answer the
   * same `CODE_INVALID`. Invitation: `INVITED` to `ACTIVE` and `email_verified_at` (the link proves
   * the mailbox). Reset: every refresh-token family of the user is revoked. Both clear the lockout
   * counters (`UsersService.setPassword`) and neither signs the user in. A password refused by the
   * account rule (equal to the email) rolls back, and the link stays usable.
   */
  async setPassword(token: string, password: string): Promise<void> {
    // The email rule needs the account, so only the length rule is checked here (empty email).
    const errors = checkPasswordPolicy(password, 'staff', '');
    if (errors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors });
    }
    if (!isLinkTokenFormat(token)) {
      throw codeInvalid();
    }

    const spent = await this.dataSource.transaction(async (em): Promise<SpentLink | null> => {
      const now = this.clock.now();
      const result = await em
        .createQueryBuilder()
        .update(EmailToken)
        .set({ usedAt: now })
        .where(
          `token_hash = :hash AND channel = 'LINK' AND type IN ('INVITE', 'RESET_PASSWORD')
           AND used_at IS NULL AND expires_at > :now`,
          { hash: hashLinkToken(token), now },
        )
        .returning('user_id, type, target_email')
        .updateEntity(false)
        .execute();
      const row = (result.raw as ConsumedRow[])[0];
      if (row === undefined) {
        return null;
      }

      const user = await em.findOne(User, {
        where: { id: row.user_id },
        lock: { mode: 'pessimistic_write' },
      });
      // The account moved on since the link was sent (suspended, activated, email changed): the
      // link is spent and answers like any other dead link.
      if (
        user === null ||
        staffLinkTypeFor(user) !== row.type ||
        normalizeEmail(row.target_email) !== normalizeEmail(user.email)
      ) {
        return null;
      }

      await this.users.setPassword(user.id, password, em);
      if (row.type === 'INVITE') {
        await this.users.transition(user.id, 'ACTIVE', em);
        await this.users.markEmailVerified(user.id, em);
      } else {
        await this.tokens.revokeAllForUser(user.id, em);
      }
      await this.audit.write(
        {
          actorUserId: user.id,
          action:
            row.type === 'INVITE' ? STAFF_LINK_AUDIT.passwordSet : STAFF_LINK_AUDIT.resetCompleted,
          entityType: 'USER',
          entityId: user.id,
        },
        em,
      );
      return { userId: user.id, type: row.type, failedLoginCountCleared: user.failedLoginCount };
    });

    if (spent === null) {
      throw codeInvalid();
    }
    this.logger.log(
      {
        event:
          spent.type === 'INVITE'
            ? STAFF_LINK_EVENTS.passwordSet
            : STAFF_LINK_EVENTS.passwordResetCompleted,
        userId: spent.userId,
        // The failures this cleared, as on a completed sign-in (api-divergences D-050).
        failedLoginCountCleared: spent.failedLoginCountCleared,
      },
      spent.type === 'INVITE'
        ? 'staff password set from invitation'
        : 'staff password reset by link',
    );
  }

  /**
   * Issues a link under a row lock on the user, so the eligibility, the 60 s rule, the daily cap
   * and the one-live-link rule hold for parallel requests; then sends it after the commit.
   * `auditRequest` writes `auth.password_reset_requested` in the same transaction (the public
   * forgot route; the admin actions of A3-T4 write their own entry).
   */
  private async issue(
    userId: string,
    type: StaffLinkType,
    auditRequest: boolean,
  ): Promise<StaffLinkIssue> {
    // Read before anything is written, so a missing base never leaves a link nobody received.
    const origin = this.adminOrigin();
    const outcome = await this.dataSource.transaction(async (em): Promise<IssueOutcome> => {
      const user = await em.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (user === null || staffLinkTypeFor(user) !== type) {
        return { kind: 'refused', result: { issued: false, reason: 'NOT_ELIGIBLE' } };
      }
      const now = this.clock.now();

      const resend = await this.throttle.resendDecision(userId, type, em);
      if (!resend.allowed) {
        return {
          kind: 'refused',
          result: {
            issued: false,
            reason: 'RESEND_TOO_SOON',
            retryAfterSeconds: resend.retryAfterSeconds,
          },
        };
      }
      const recent = await em
        .createQueryBuilder(EmailToken, 'token')
        .where('token.userId = :userId AND token.type = :type AND token.createdAt > :since', {
          userId,
          type,
          since: dailyWindowStart(now),
        })
        .getCount();
      if (recent >= EMAIL_CODE_DAILY_CAP) {
        return { kind: 'refused', result: { issued: false, reason: 'DAILY_CAP' } };
      }

      // One live link per user and type: the old one is superseded first (partial unique index).
      await em
        .createQueryBuilder()
        .update(EmailToken)
        .set({ usedAt: now })
        .where('user_id = :userId AND type = :type AND used_at IS NULL', { userId, type })
        .updateEntity(false)
        .execute();

      const token = generateLinkToken();
      await em
        .createQueryBuilder()
        .insert()
        .into(EmailToken)
        .values({
          userId,
          type,
          channel: 'LINK',
          tokenHash: hashLinkToken(token),
          targetEmail: user.email,
          attempts: 0,
          maxAttempts: LINK_MAX_ATTEMPTS,
          // From the `Clock`, so the 60 s rule and the daily cap read the same time line.
          createdAt: now,
          expiresAt: staffLinkExpiresAt(type, now),
        })
        .updateEntity(false)
        .execute();
      if (auditRequest) {
        await this.audit.write(
          {
            // A public route: the person asking may not be the account holder.
            actorUserId: null,
            action: STAFF_LINK_AUDIT.resetRequested,
            entityType: 'USER',
            entityId: userId,
            diff: { linkType: type },
          },
          em,
        );
      }
      return { kind: 'issued', token, to: user.email };
    });

    if (outcome.kind === 'refused') {
      if (outcome.result.reason === 'DAILY_CAP') {
        this.logger.warn(
          { event: STAFF_LINK_EVENTS.dailyCapReached, userId, type },
          'staff link daily cap reached; nothing sent',
        );
      }
      return outcome.result;
    }

    const link = staffLinkUrl(origin, type, outcome.token);
    const rendered: RenderedMail =
      type === 'INVITE'
        ? renderStaffInvite({ link, expiresInHours: STAFF_INVITE_TTL_HOURS })
        : renderStaffPasswordReset({ link, expiresInMinutes: STAFF_RESET_TTL_MINUTES });
    // Not awaited: the response never waits for the mail transport (decision 0008 section 5).
    void this.deliver(userId, type, { ...rendered, to: outcome.to });
    return { issued: true };
  }

  /** The first `ADMIN_ORIGINS` entry is the base of staff links (decision 0008 section 10). */
  private adminOrigin(): string {
    const origin = this.config.adminOrigins[0];
    if (origin === undefined) {
      // `loadConfig` always yields at least one origin; this guards a hand-built config.
      throw new Error('ADMIN_ORIGINS has no entry to build staff links from.');
    }
    return origin;
  }

  /** Sends one message; a failure is logged with the template and error code only. */
  private async deliver(userId: string, type: StaffLinkType, message: MailMessage): Promise<void> {
    try {
      await this.mail.send(message);
    } catch (error) {
      this.logger.warn(
        {
          event: STAFF_LINK_EVENTS.sendFailed,
          userId,
          type,
          templateKey: message.templateKey,
          errorCode: error instanceof MailDeliveryError ? error.code : undefined,
        },
        'staff link not delivered',
      );
    }
  }
}
