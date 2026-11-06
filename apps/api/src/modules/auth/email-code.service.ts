import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, IsNull, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { AccountThrottleService } from '../../common/throttling/account-throttle.service.js';
import { Clock } from '../../common/time/clock.js';
import { MailService } from '../mail/mail.service.js';
import { MailDeliveryError } from '../mail/ports/mail.port.js';
import type { MailMessage } from '../mail/ports/mail.port.js';
import { renderPasswordResetCode } from '../mail/templates/password-reset-code.template.js';
import type { RenderedMail } from '../mail/templates/verify-email-code.template.js';
import { renderVerifyEmailCode } from '../mail/templates/verify-email-code.template.js';
import { User } from '../users/entities/user.entity.js';
import { normalizeEmail } from '../users/email.js';
import { checkPasswordPolicy } from '../users/password-policy.js';
import { UsersService } from '../users/users.service.js';
import { EmailToken } from './entities/email-token.entity.js';
import type { EmailTokenType } from './entities/email-token.entity.js';
import { RefreshTokenService } from './refresh-token.service.js';

/** The two customer code purposes (ADR-0008 #1); `INVITE` and staff resets are links (A3-T3). */
export type EmailCodeType = Extract<EmailTokenType, 'VERIFY_EMAIL' | 'RESET_PASSWORD'>;

/** Lifetime of a code (ADR-0003, decision 0008 section 6). */
export const EMAIL_CODE_TTL_MINUTES = 10;
export const EMAIL_CODE_TTL_MS = EMAIL_CODE_TTL_MINUTES * 60 * 1000;
/** Wrong guesses after which a code is dead (`email_tokens.max_attempts`). */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** At most 5 messages per user and type in a rolling 24 hours (decision 0008 section 6, row 11). */
export const EMAIL_CODE_DAILY_CAP = 5;
export const EMAIL_CODE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Exclusive upper bound of `crypto.randomInt`: six decimal digits. */
const CODE_SPACE = 1_000_000;
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[0-9]{6}$/;
/** Versioned HMAC input prefix (decision 0008 section 6). */
const HMAC_PREFIX = 'kd.email-code.v1';
/** Compared against when no live code exists, so every refusal does the same work. */
const DUMMY_HASH = Buffer.alloc(32);
const DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000';

/** Injection token of the HMAC key: the bytes decoded from `OTP_HMAC_SECRET` (at least 32). */
export const EMAIL_CODE_HMAC_KEY = Symbol('EMAIL_CODE_HMAC_KEY');

/**
 * The `event` field of the log lines of this flow (api-divergences D-050 style): user id and type
 * only, never the code, its hash or an address.
 */
export const EMAIL_CODE_EVENTS = {
  dailyCapReached: 'auth.email_code_daily_cap',
  sendFailed: 'auth.email_code_send_failed',
  emailVerified: 'auth.email_verified',
  passwordReset: 'auth.password_reset',
} as const;

/** A six-digit code from the CSPRNG, leading zeros kept (decision 0008 section 6). */
export function generateEmailCode(draw: (min: number, max: number) => number = randomInt): string {
  return String(draw(0, CODE_SPACE)).padStart(CODE_LENGTH, '0');
}

/** The typed code with whitespace removed, or `null` unless exactly six ASCII digits remain. */
export function normalizeEmailCode(input: string): string | null {
  const code = input.replace(/\s+/gu, '');
  return CODE_PATTERN.test(code) ? code : null;
}

/** HMAC-SHA-256 over `kd.email-code.v1\n<userId>\n<type>\n<code>` (decision 0008 section 6). */
export function emailCodeHmac(
  key: Buffer,
  userId: string,
  type: EmailCodeType,
  code: string,
): Buffer {
  return createHmac('sha256', key)
    .update(`${HMAC_PREFIX}\n${userId}\n${type}\n${code}`, 'utf8')
    .digest();
}

/** Constant-time comparison of a stored hash with the HMAC of the typed code. */
export function emailCodeMatches(
  key: Buffer,
  storedHash: Buffer,
  userId: string,
  type: EmailCodeType,
  code: string,
): boolean {
  const computed = emailCodeHmac(key, userId, type, code);
  return storedHash.length === computed.length && timingSafeEqual(storedHash, computed);
}

/** Expiry of a code issued at `now`. */
export function emailCodeExpiresAt(now: Date): Date {
  return new Date(now.getTime() + EMAIL_CODE_TTL_MS);
}

/** Live: not used or superseded, not expired (`expires_at` is exclusive), attempts left. */
export function isEmailCodeLive(
  row: Pick<EmailToken, 'usedAt' | 'expiresAt' | 'attempts' | 'maxAttempts'>,
  now: Date,
): boolean {
  return (
    row.usedAt === null && row.expiresAt.getTime() > now.getTime() && row.attempts < row.maxAttempts
  );
}

/** Start of the rolling daily window ending at `now` (rows created after it count). */
export function dailyWindowStart(now: Date): Date {
  return new Date(now.getTime() - EMAIL_CODE_DAILY_WINDOW_MS);
}

/** Outcome of one send request; only `issued` carries a code, and only to build the mail. */
type IssueOutcome =
  | { readonly kind: 'issued'; readonly code: string; readonly to: string }
  | { readonly kind: 'resend-too-soon' | 'daily-cap' | 'target-taken' };

type ConsumeOutcome = { readonly ok: true; readonly targetEmail: string } | { readonly ok: false };

function codeInvalid(): ApiError {
  // One body for wrong, expired, used, dead and unknown (decision 0008 section 5).
  return new ApiError('CODE_INVALID');
}

function codeFormatError(): ApiFieldError {
  // The generic field code (api-divergences D-001); the message never repeats the value.
  return { field: 'code', code: 'INVALID', message: 'must be 6 digits' };
}

function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

/** The unique violation of `users.email` (`users_email_unique`), from the error or its driver error. */
function isUsersEmailConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const failure = error as QueryFailedError & {
    readonly constraint?: unknown;
    readonly driverError?: { readonly constraint?: unknown };
  };
  return (failure.constraint ?? failure.driverError?.constraint) === 'users_email_unique';
}

/** Customers only, and only accounts that can sign in with a password set by the reset. */
function canResetByCode(user: Pick<User, 'role' | 'status'>): boolean {
  return user.role === 'CUSTOMER' && user.status === 'ACTIVE';
}

/**
 * Six-digit email codes of customers (A2-T2; ADR-0003 "Email flows", ADR-0008 #1; decision 0008
 * sections 5 to 7): email verification and password reset. Codes are stored only as an HMAC,
 * compared in constant time, live 10 minutes, die after 5 wrong attempts, and one live code per
 * user and type is kept by expiring the previous one in the issuing transaction.
 *
 * Send requests answer the same way whatever happens (unknown email, resend within 60 s, daily cap,
 * taken target): the caller returns its generic `202`. The mail goes out after the commit and the
 * response never waits for it; a failed send is logged without the address. No code, hash or
 * address is ever logged, audited, returned or put in an error.
 */
@Injectable()
export class EmailCodeService {
  // Nest's logger, routed to pino (decision 0005 section 11), as in `AuthService`.
  private readonly logger = new Logger(EmailCodeService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(AccountThrottleService) private readonly throttle: AccountThrottleService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(EMAIL_CODE_HMAC_KEY) private readonly key: Buffer,
  ) {}

  /**
   * `POST /auth/email/send-code` for the acting user (from the access token). A verified account
   * is `INVALID_STATE`: changing the email of a verified account is not designed (ADR-0003 open
   * item 4). `targetEmail` other than the account email is the "another email" path: when another
   * account holds it, nothing is sent and the answer is the same.
   */
  async sendVerificationCode(userId: string, targetEmail?: string | null): Promise<void> {
    const user = await this.users.findById(userId);
    if (user === null || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE') {
      return;
    }
    if (user.emailVerifiedAt !== null) {
      throw new ApiError('INVALID_STATE', { detail: 'The email of this account is verified.' });
    }
    const to =
      typeof targetEmail === 'string' && targetEmail.trim() !== ''
        ? normalizeEmail(targetEmail)
        : user.email;
    await this.issueAndSend(user.id, 'VERIFY_EMAIL', to, !sameEmail(to, user.email));
  }

  /**
   * `POST /auth/email/verify`. A right code sets `email_verified_at`; a code sent to another email
   * also makes it `users.email`, unless another account took it meanwhile (the code is then spent
   * and the answer is `CODE_INVALID`).
   */
  async verifyEmail(userId: string, typedCode: string): Promise<void> {
    const code = normalizeEmailCode(typedCode);
    if (code === null) {
      throw new ApiError('VALIDATION_FAILED', { errors: [codeFormatError()] });
    }

    let verified: boolean;
    try {
      verified = await this.dataSource.transaction(async (em) => {
        const user = await em.findOne(User, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (user === null || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE') {
          this.dummyCompare('VERIFY_EMAIL', code);
          return false;
        }
        const consumed = await this.consume(em, user.id, 'VERIFY_EMAIL', code);
        if (!consumed.ok) {
          return false;
        }
        const now = this.clock.now();
        if (sameEmail(consumed.targetEmail, user.email)) {
          await this.users.markEmailVerified(user.id, em);
          return true;
        }
        // The "another email" path: only while unverified, only if no other account has it.
        if (
          user.emailVerifiedAt !== null ||
          (await this.emailTakenByOther(em, consumed.targetEmail, user.id))
        ) {
          return false;
        }
        await em
          .createQueryBuilder()
          .update(User)
          .set({ email: normalizeEmail(consumed.targetEmail), emailVerifiedAt: now })
          .where('id = :id', { id: user.id })
          .updateEntity(false)
          .execute();
        return true;
      });
    } catch (error) {
      // Another account took the address between the check and the update: rolled back.
      if (isUsersEmailConflict(error)) {
        throw codeInvalid();
      }
      throw error;
    }

    if (!verified) {
      throw codeInvalid();
    }
    this.logger.log({ event: EMAIL_CODE_EVENTS.emailVerified, userId }, 'email verified');
  }

  /**
   * `POST /auth/password/forgot`. Only an `ACTIVE` `CUSTOMER` gets a code; an unknown email, staff
   * (links, A3-T3), suspended and deleted accounts get nothing and the same answer.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (user === null || !canResetByCode(user)) {
      return;
    }
    await this.issueAndSend(user.id, 'RESET_PASSWORD', user.email, false);
  }

  /**
   * `POST /auth/password/reset`. Field problems first (`VALIDATION_FAILED`, the code not counted),
   * judged on the input alone so they reveal nothing about the account. Then any account that
   * cannot reset by code answers `CODE_INVALID` after a dummy comparison. Success sets the password
   * (policy of `UsersService`, which also clears `failed_login_count` and `locked_until`) and
   * revokes every refresh-token family of the user, in the transaction that spends the code.
   */
  async resetPassword(email: string, typedCode: string, newPassword: string): Promise<void> {
    const code = normalizeEmailCode(typedCode);
    const errors: ApiFieldError[] = code === null ? [codeFormatError()] : [];
    errors.push(
      ...checkPasswordPolicy(newPassword, 'customer', normalizeEmail(email)).map((error) => ({
        ...error,
        field: 'newPassword',
      })),
    );
    if (code === null || errors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors });
    }

    const user = await this.users.findByEmail(email);
    if (user === null || !canResetByCode(user)) {
      this.dummyCompare('RESET_PASSWORD', code);
      throw codeInvalid();
    }

    const reset = await this.dataSource.transaction(async (em) => {
      const consumed = await this.consume(em, user.id, 'RESET_PASSWORD', code);
      if (!consumed.ok) {
        return false;
      }
      await this.users.setPassword(user.id, newPassword, em);
      await this.tokens.revokeAllForUser(user.id, em);
      return true;
    });
    if (!reset) {
      throw codeInvalid();
    }
    this.logger.log(
      {
        event: EMAIL_CODE_EVENTS.passwordReset,
        userId: user.id,
        // The failures this reset cleared, as on a completed sign-in (api-divergences D-050).
        failedLoginCountCleared: user.failedLoginCount,
      },
      'password reset by code',
    );
  }

  /**
   * Issues a code under a row lock on the user, so the resend rule, the daily cap and the
   * one-live-code rule hold for parallel requests; then sends it after the commit.
   */
  private async issueAndSend(
    userId: string,
    type: EmailCodeType,
    to: string,
    anotherEmail: boolean,
  ): Promise<void> {
    const outcome = await this.dataSource.transaction(async (em): Promise<IssueOutcome> => {
      await em.findOne(User, {
        select: { id: true },
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = this.clock.now();

      const resend = await this.throttle.resendDecision(userId, type, em);
      if (!resend.allowed) {
        return { kind: 'resend-too-soon' };
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
        return { kind: 'daily-cap' };
      }

      // A new request ends the live code in every case, so a taken target looks like a free one.
      await em
        .createQueryBuilder()
        .update(EmailToken)
        .set({ usedAt: now })
        .where('user_id = :userId AND type = :type AND used_at IS NULL', { userId, type })
        .updateEntity(false)
        .execute();
      if (anotherEmail && (await this.emailTakenByOther(em, to, userId))) {
        return { kind: 'target-taken' };
      }

      const code = generateEmailCode();
      await em
        .createQueryBuilder()
        .insert()
        .into(EmailToken)
        .values({
          userId,
          type,
          channel: 'CODE',
          tokenHash: emailCodeHmac(this.key, userId, type, code),
          targetEmail: to,
          attempts: 0,
          maxAttempts: EMAIL_CODE_MAX_ATTEMPTS,
          // From the `Clock`, so the 60 s rule and the daily cap read the same time line.
          createdAt: now,
          expiresAt: emailCodeExpiresAt(now),
        })
        .updateEntity(false)
        .execute();
      return { kind: 'issued', code, to };
    });

    if (outcome.kind === 'daily-cap') {
      this.logger.warn(
        { event: EMAIL_CODE_EVENTS.dailyCapReached, userId, type },
        'email code daily cap reached; nothing sent',
      );
    }
    if (outcome.kind !== 'issued') {
      return;
    }
    const rendered: RenderedMail =
      type === 'VERIFY_EMAIL'
        ? renderVerifyEmailCode({ code: outcome.code, expiresInMinutes: EMAIL_CODE_TTL_MINUTES })
        : renderPasswordResetCode({ code: outcome.code, expiresInMinutes: EMAIL_CODE_TTL_MINUTES });
    // Not awaited: the response never waits for the mail transport (decision 0008 section 5).
    void this.deliver(userId, type, { ...rendered, to: outcome.to });
  }

  /** Sends one message; a failure is logged with the template and error code only. */
  private async deliver(userId: string, type: EmailCodeType, message: MailMessage): Promise<void> {
    try {
      await this.mail.send(message);
    } catch (error) {
      this.logger.warn(
        {
          event: EMAIL_CODE_EVENTS.sendFailed,
          userId,
          type,
          templateKey: message.templateKey,
          errorCode: error instanceof MailDeliveryError ? error.code : undefined,
        },
        'email code not delivered',
      );
    }
  }

  /**
   * Checks `code` against the live row of the user and type, under a row lock. A wrong code adds
   * one attempt (the row dies at `max_attempts`); a right one sets `used_at`. Both are written in
   * the caller's transaction, which must commit even when the outcome is a refusal.
   */
  private async consume(
    em: EntityManager,
    userId: string,
    type: EmailCodeType,
    code: string,
  ): Promise<ConsumeOutcome> {
    const row = await em.findOne(EmailToken, {
      where: { userId, type, usedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    const now = this.clock.now();
    if (row === null || row.channel !== 'CODE' || !isEmailCodeLive(row, now)) {
      this.dummyCompare(type, code);
      return { ok: false };
    }
    if (!emailCodeMatches(this.key, row.tokenHash, userId, type, code)) {
      await em
        .createQueryBuilder()
        .update(EmailToken)
        .set({ attempts: () => 'attempts + 1' })
        .where('id = :id AND attempts < max_attempts', { id: row.id })
        .updateEntity(false)
        .execute();
      return { ok: false };
    }
    await em
      .createQueryBuilder()
      .update(EmailToken)
      .set({ usedAt: now })
      .where('id = :id', { id: row.id })
      .updateEntity(false)
      .execute();
    return { ok: true, targetEmail: row.targetEmail };
  }

  /** The same HMAC and comparison as a real check, for the paths that have no live code. */
  private dummyCompare(type: EmailCodeType, code: string): void {
    emailCodeMatches(this.key, DUMMY_HASH, DUMMY_USER_ID, type, code);
  }

  private async emailTakenByOther(
    em: EntityManager,
    email: string,
    userId: string,
  ): Promise<boolean> {
    const count = await em
      .createQueryBuilder(User, 'user')
      .where('user.email = :email AND user.id <> :userId', { email: normalizeEmail(email), userId })
      .getCount();
    return count > 0;
  }
}
