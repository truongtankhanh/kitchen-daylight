import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { normalizeVietnamMobile } from '../../common/phone/vietnam-phone.js';
import { Clock } from '../../common/time/clock.js';
import { AuditService } from '../audit/audit.service.js';
import { DEFAULT_CONSENT_LOCALE, LegalService } from '../legal/legal.service.js';
import { CONSENT_DOCUMENT_TYPES } from '../users/entities/consent-document.entity.js';
import type { ConsentDocument } from '../users/entities/consent-document.entity.js';
import type { ConsentClient } from '../users/entities/user-consent.entity.js';
import { User } from '../users/entities/user.entity.js';
import type { UserRole, UserStatus } from '../users/entities/user.entity.js';
import { normalizeEmail } from '../users/email.js';
import { PasswordHasher } from '../users/password-hasher.js';
import { checkPasswordPolicy } from '../users/password-policy.js';
import { EmailTakenError, UsersService } from '../users/users.service.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { hashRefreshToken, RefreshTokenService } from './refresh-token.service.js';
import type { SessionTokens } from './refresh-token.service.js';

/**
 * The `event` field of the auth log lines (ADR-0003 "Abuse protection"; decision 0008 section 4;
 * api-divergences D-050). Each line carries the event and the user id only: never the password,
 * the email typed or a token. An unknown email writes nothing.
 */
export const AUTH_EVENTS = {
  loginFailed: 'auth.login_failed',
  loginSucceeded: 'auth.login_succeeded',
  accountLocked: 'auth.account_locked',
} as const;

/** Locale of a self-registered account until the profile slice lets the user change it. */
export const REGISTRATION_LOCALE = 'vi';

/**
 * `X-App-Version` as stored in `user_consents.app_version`: 1 to 32 characters of letters, digits,
 * `.`, `+` and `-`, starting with a letter or digit (api-divergences D-047). Anything else is
 * stored as `null`; the header is informational and never refused.
 */
export const APP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/u;

/** The client headers of a request (api-outline, Conventions "Client headers"). */
export interface ClientHeaders {
  /** `X-Client`, raw; `undefined` when absent. */
  readonly client?: string | undefined;
  /** `X-App-Version`, raw; `undefined` when absent. */
  readonly appVersion?: string | undefined;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly phone?: string | null | undefined;
  readonly acceptedDocumentIds: readonly string[];
  readonly deviceLabel?: string | null | undefined;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly deviceLabel?: string | null | undefined;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  /** ISO 8601, or `null` while the email is not verified. */
  readonly emailVerifiedAt: string | null;
}

/** The body of register, login and refresh (api-divergences D-044). */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
  readonly user: AuthUser;
}

/** `user_consents.client` from `X-Client`: `mobile-*` → `MOBILE`, `admin-web` → `ADMIN_WEB`, else `API`. */
export function consentClientOf(client: string | undefined): ConsentClient {
  const value = client?.trim().toLowerCase();
  if (value === undefined || value === '') {
    return 'API';
  }
  if (value.startsWith('mobile-')) {
    return 'MOBILE';
  }
  return value === 'admin-web' ? 'ADMIN_WEB' : 'API';
}

/** `X-App-Version` when it matches `APP_VERSION_PATTERN` after trimming, else `null`. */
export function appVersionOf(appVersion: string | undefined): string | null {
  const value = appVersion?.trim();
  return value !== undefined && APP_VERSION_PATTERN.test(value) ? value : null;
}

/** Decision 0008 section 1: the body's `deviceLabel`, else `X-Client`, else `unknown` (later). */
export function deviceLabelOf(
  deviceLabel: string | null | undefined,
  client: string | undefined,
): string | undefined {
  return typeof deviceLabel === 'string' && deviceLabel.trim() !== '' ? deviceLabel : client;
}

/**
 * True when `acceptedIds` names exactly the current document of every consent type: one id per
 * type, no other id, no repeat. Ids compare without regard to case.
 */
export function acceptsCurrentDocuments(
  acceptedIds: readonly string[],
  current: readonly Pick<ConsentDocument, 'id' | 'type'>[],
): boolean {
  const currentTypes = new Set(current.map((document) => document.type));
  if (CONSENT_DOCUMENT_TYPES.some((type) => !currentTypes.has(type))) {
    return false;
  }
  const accepted = new Set(acceptedIds.map((id) => id.toLowerCase()));
  return (
    accepted.size === acceptedIds.length &&
    accepted.size === current.length &&
    current.every((document) => accepted.has(document.id.toLowerCase()))
  );
}

function invalidCredentials(): ApiError {
  // One body for every refusal of a sign-in (decision 0008 section 5): no detail.
  return new ApiError('INVALID_CREDENTIALS');
}

function unauthenticated(): ApiError {
  return new ApiError('UNAUTHENTICATED');
}

/**
 * Customer authentication, tokens in the body (A2-T1; ADR-0003; decision 0008 sections 1, 4, 5).
 * The acting user of `logoutAll` comes from the access token; every other method is public and
 * identifies the account by its credentials or refresh token only. No password, hash or token is
 * logged or put in an error.
 */
@Injectable()
export class AuthService {
  // Nest's logger, routed to pino by `app.useLogger` (decision 0005 section 11), as in
  // `RefreshTokenService`; no constructor dependency.
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(LegalService) private readonly legal: LegalService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * A new `CUSTOMER` (`ACTIVE`, email not verified), its consent rows and its first session, in one
   * transaction. Field problems are collected into one `VALIDATION_FAILED`; an email already used
   * is `409 ALREADY_EXISTS` with no detail (decision 0008 section 5, header row 21).
   */
  async register(input: RegisterInput, headers: ClientHeaders): Promise<AuthSession> {
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    const errors: ApiFieldError[] = [];

    if (displayName === '') {
      errors.push({ field: 'displayName', code: 'REQUIRED', message: 'is required' });
    }
    errors.push(...checkPasswordPolicy(input.password, 'customer', email));

    let phone: string | null = null;
    if (typeof input.phone === 'string' && input.phone.trim() !== '') {
      phone = normalizeVietnamMobile(input.phone);
      if (phone === null) {
        errors.push({
          field: 'phone',
          code: 'INVALID_PHONE',
          message: 'must be a Vietnamese mobile number',
        });
      }
    }

    const documents = await this.legal.currentDocuments(DEFAULT_CONSENT_LOCALE);
    if (!acceptsCurrentDocuments(input.acceptedDocumentIds, documents)) {
      errors.push({
        field: 'acceptedDocumentIds',
        // The generic field code (api-divergences D-001): the catalogue has none for this rule.
        code: 'INVALID',
        message: 'must be the ids of the current Terms of Service and Privacy Policy',
      });
    }

    if (errors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors });
    }

    try {
      return await this.dataSource.transaction(async (em) => {
        const user = await this.users.createCustomer(
          { email, password: input.password, displayName, locale: REGISTRATION_LOCALE },
          em,
        );
        if (phone !== null) {
          await em.update(User, { id: user.id }, { phone });
        }
        await this.legal.recordConsents(
          {
            userId: user.id,
            documentIds: documents.map((document) => document.id),
            action: 'GRANTED',
            client: consentClientOf(headers.client),
            appVersion: appVersionOf(headers.appVersion),
          },
          em,
        );
        const tokens = await this.tokens.issue(
          user.id,
          { deviceLabel: deviceLabelOf(input.deviceLabel, headers.client) },
          em,
        );
        return this.sessionOf(tokens, user);
      });
    } catch (error) {
      if (error instanceof EmailTakenError) {
        throw new ApiError('ALREADY_EXISTS');
      }
      throw error;
    }
  }

  /**
   * Customer sign-in (decision 0008 sections 4 and 5). An unknown email, a non-customer, a
   * `DELETED` or `INVITED` account, an account without a password and a locked account all run
   * one dummy verification and answer `INVALID_CREDENTIALS`, like a wrong password; only a wrong
   * password counts toward the lockout. `ACCOUNT_SUSPENDED` only after the right password. An
   * unverified email can sign in.
   */
  async login(input: LoginInput, headers: ClientHeaders): Promise<AuthSession> {
    const user = await this.users.findByEmail(input.email);
    const passwordHash = user === null ? null : this.signInHashOf(user);
    if (user === null || passwordHash === null) {
      await this.hasher.verifyOrDummy(null, input.password);
      throw invalidCredentials();
    }

    if (!(await this.hasher.verify(passwordHash, input.password))) {
      await this.recordWrongPassword(user.id);
      throw invalidCredentials();
    }
    if (user.status === 'SUSPENDED') {
      throw new ApiError('ACCOUNT_SUSPENDED');
    }

    // Hashed before the transaction, so no row lock waits on argon2.
    const rehashed = this.hasher.needsRehash(passwordHash)
      ? await this.hasher.hash(input.password)
      : null;
    const tokens = await this.dataSource.transaction(async (em) => {
      if (rehashed !== null) {
        // Only if the hash is still the one verified: a concurrent password change wins.
        await em.update(User, { id: user.id, passwordHash }, { passwordHash: rehashed });
      }
      await this.users.recordSuccessfulLogin(user.id, em);
      return this.tokens.issue(
        user.id,
        { deviceLabel: deviceLabelOf(input.deviceLabel, headers.client) },
        em,
      );
    });
    this.logger.log(
      {
        event: AUTH_EVENTS.loginSucceeded,
        userId: user.id,
        // The failures this sign-in cleared: a value above 0 ends a run of failures or a lock.
        failedLoginCountCleared: user.failedLoginCount,
      },
      'customer sign-in',
    );
    return this.sessionOf(tokens, user);
  }

  /**
   * Rotates a customer refresh token (decision 0008 section 2). The owner is checked before the
   * rotation, so a refused token is never consumed: a staff token (cookie transport), a suspended
   * or deleted account and an unknown token are `UNAUTHENTICATED`, as is every rotation failure.
   */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const owner = await this.ownerOf(refreshToken);
    if (owner === null || owner.role !== 'CUSTOMER' || owner.status !== 'ACTIVE') {
      throw unauthenticated();
    }
    const tokens = await this.tokens.rotate(refreshToken);
    if (tokens.role !== 'CUSTOMER') {
      throw unauthenticated();
    }
    const user = await this.users.findById(tokens.userId);
    if (user === null) {
      throw unauthenticated();
    }
    return this.sessionOf(tokens, user);
  }

  /** Revokes the family of the presented token; an unknown token changes nothing. */
  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByToken(refreshToken);
  }

  /** Revokes every family of the acting user (from the access token). */
  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  /**
   * Counts a wrong password (decision 0008 section 4). When the failure locks the account, the
   * `auth.account_locked` audit row is written in the same transaction as the lock. The log lines
   * follow the commit.
   */
  private async recordWrongPassword(userId: string): Promise<void> {
    const result = await this.dataSource.transaction(async (em) => {
      const failure = await this.users.recordFailedLogin(userId, em);
      if (failure.counted && failure.lockedUntil !== null) {
        await this.audit.write(
          {
            // Detected by the system: the person typing may be the user or an attacker.
            actorUserId: null,
            action: AUTH_EVENTS.accountLocked,
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
      { event: AUTH_EVENTS.loginFailed, userId, failedLoginCount: result.failedLoginCount },
      'customer sign-in failed',
    );
    if (result.counted && result.lockedUntil !== null) {
      this.logger.warn({ event: AUTH_EVENTS.accountLocked, userId }, 'account locked');
    }
  }

  /**
   * The hash to verify for a customer sign-in, or `null` when the account must take the dummy
   * path: not a customer, not `ACTIVE` or `SUSPENDED`, no password (social only) or locked now.
   */
  private signInHashOf(user: User): string | null {
    if (
      user.role !== 'CUSTOMER' ||
      (user.status !== 'ACTIVE' && user.status !== 'SUSPENDED') ||
      user.passwordHash === null ||
      this.users.isLocked(user)
    ) {
      return null;
    }
    return user.passwordHash;
  }

  /** Role and status of the account that holds `refreshToken`, or `null` for an unknown token. */
  private async ownerOf(
    refreshToken: string,
  ): Promise<{ readonly role: UserRole; readonly status: UserStatus } | null> {
    const row = await this.dataSource.manager
      .createQueryBuilder(RefreshToken, 'token')
      .innerJoin(User, 'owner', 'owner.id = token.userId')
      .select('owner.role', 'role')
      .addSelect('owner.status', 'status')
      .where('token.tokenHash = :hash', { hash: hashRefreshToken(refreshToken) })
      .getRawOne<{ role: UserRole; status: UserStatus }>();
    return row ?? null;
  }

  private sessionOf(
    tokens: SessionTokens,
    user: Pick<User, 'id' | 'email' | 'displayName' | 'emailVerifiedAt'>,
  ): AuthSession {
    const remainingMs = tokens.accessTokenExpiresAt.getTime() - this.clock.now().getTime();
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: Math.max(0, Math.floor(remainingMs / 1000)),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      },
    };
  }
}
