import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../../common/auth/request-user.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { Clock } from '../../../common/time/clock.js';
import { DEFAULT_CONSENT_LOCALE, LegalService } from '../../legal/legal.service.js';
import { User } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/email.js';
import { UsersService } from '../../users/users.service.js';
import {
  acceptsCurrentDocuments,
  appVersionOf,
  consentClientOf,
  deviceLabelOf,
  REGISTRATION_LOCALE,
} from '../auth.service.js';
import type { AuthSession, ClientHeaders } from '../auth.service.js';
import { AuthIdentity } from '../entities/auth-identity.entity.js';
import type { AuthProvider } from '../entities/auth-identity.entity.js';
import { RefreshTokenService } from '../refresh-token.service.js';
import type { SessionTokens } from '../refresh-token.service.js';
import { DISPLAY_NAME_MAX_LENGTH } from '../dto/register.dto.js';
import { NonceService } from './nonce.service.js';
import { SOCIAL_IDENTITY_VERIFIER, SocialTokenRejectedError } from './social-identity-verifier.js';
import type { SocialIdentityVerifier, VerifiedSocialIdentity } from './social-identity-verifier.js';

/**
 * The `event` field of the social log lines. Each line carries the event, the provider, the user id
 * and a reason or outcome only: never the ID token, the nonce, a claim or the email.
 */
export const SOCIAL_EVENTS = {
  refused: 'auth.social_refused',
  signedIn: 'auth.social_signed_in',
  linked: 'auth.social_linked',
  unlinked: 'auth.social_unlinked',
} as const;

/** How a sign-in found its account. */
export type SocialSignInOutcome = 'existing' | 'auto_linked' | 'created';

export interface SocialSignInInput {
  readonly idToken: string;
  readonly nonce: string;
  readonly acceptedDocumentIds?: readonly string[] | undefined;
  readonly displayName?: string | null | undefined;
  readonly deviceLabel?: string | null | undefined;
}

export interface LinkIdentityInput {
  readonly idToken: string;
  readonly nonce: string;
}

/** The first `max` Unicode code points of `value`. */
function firstCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

/**
 * The display name of an account created by social sign-in: the body's (Apple gives the name to
 * the app only, on the first authorization), else the token's `name` (Google), else the local part
 * of the email; at most 60 code points (api-divergences D-071).
 */
export function socialDisplayName(
  bodyName: string | null | undefined,
  identity: Pick<VerifiedSocialIdentity, 'name' | 'email'>,
): string {
  const candidates = [bodyName?.trim(), identity.name?.trim(), identity.email?.split('@')[0]];
  const chosen = candidates.find((candidate) => candidate !== undefined && candidate !== '') ?? '';
  return firstCodePoints(chosen, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * Social sign-in and account linking for customers (A2-T6; ADR-0003 "Social sign-in"; decision 0008
 * section 11). Accounts link on (`provider`, `subject`) only, never on email alone; an existing local
 * account is linked automatically only when the provider says the email is verified and the
 * account's own email is verified, which stops pre-registration account takeover. The acting user of
 * the `/me/identities` methods comes from the access token.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(SOCIAL_IDENTITY_VERIFIER) private readonly verifier: SocialIdentityVerifier,
    @Inject(NonceService) private readonly nonces: NonceService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(LegalService) private readonly legal: LegalService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** `POST /auth/social/nonce`. */
  issueNonce(): { nonce: string; expiresAt: string } {
    const issued = this.nonces.issue();
    return { nonce: issued.nonce, expiresAt: issued.expiresAt.toISOString() };
  }

  /**
   * `POST /auth/social/google` and `/auth/social/apple`. The account, any link or new account and
   * the first session are written in one transaction.
   */
  async signIn(
    provider: AuthProvider,
    input: SocialSignInInput,
    headers: ClientHeaders,
  ): Promise<AuthSession> {
    const identity = await this.verifiedIdentity(provider, input.idToken, input.nonce);
    const { user, tokens, outcome } = await this.dataSource.transaction(async (em) => {
      const found = await this.accountFor(em, identity, input, headers);
      await this.users.recordSuccessfulLogin(found.user.id, em);
      const issued = await this.tokens.issue(
        found.user.id,
        { deviceLabel: deviceLabelOf(input.deviceLabel, headers.client) },
        em,
      );
      return { ...found, tokens: issued };
    });
    this.logger.log(
      { event: SOCIAL_EVENTS.signedIn, userId: user.id, provider, outcome },
      'social sign-in',
    );
    return this.sessionOf(tokens, user);
  }

  /**
   * `POST /me/identities/{provider}`: links the token's account to the signed-in customer. Linking
   * the subject already linked to this user is a no-op; a subject linked to another user, or a
   * second account of the same provider, is `ALREADY_EXISTS`.
   */
  async linkIdentity(
    actor: RequestUser,
    provider: AuthProvider,
    input: LinkIdentityInput,
  ): Promise<void> {
    if (actor.role !== 'CUSTOMER') {
      // Staff never use social sign-in (ADR-0003); refused before the nonce is spent.
      throw new ApiError('FORBIDDEN');
    }
    const identity = await this.verifiedIdentity(provider, input.idToken, input.nonce);
    const linked = await this.dataSource.transaction(async (em) => {
      await this.lockUser(em, actor.id);
      const bySubject = await em.findOne(AuthIdentity, {
        where: { provider, providerSubject: identity.subject },
      });
      if (bySubject !== null) {
        if (bySubject.userId === actor.id) {
          return false;
        }
        throw new ApiError('ALREADY_EXISTS');
      }
      if (!(await this.insertIdentity(em, actor.id, identity))) {
        // The user already has another account of this provider, or a parallel link won.
        throw new ApiError('ALREADY_EXISTS');
      }
      return true;
    });
    if (linked) {
      this.logger.log({ event: SOCIAL_EVENTS.linked, userId: actor.id, provider }, 'social link');
    }
  }

  /**
   * `DELETE /me/identities/{provider}`. Refused with `INVALID_STATE` when the account would be left
   * with no password and no identity; `NOT_FOUND` when nothing of this provider is linked.
   */
  async unlinkIdentity(actor: RequestUser, provider: AuthProvider): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const user = await this.lockUser(em, actor.id);
      const identities = await em.find(AuthIdentity, { where: { userId: actor.id } });
      const target = identities.find((identity) => identity.provider === provider);
      if (target === undefined) {
        throw new ApiError('NOT_FOUND');
      }
      if (user.passwordHash === null && identities.length === 1) {
        throw new ApiError('INVALID_STATE', {
          detail: 'The account would be left with no way to sign in.',
        });
      }
      await em.delete(AuthIdentity, { id: target.id });
    });
    this.logger.log({ event: SOCIAL_EVENTS.unlinked, userId: actor.id, provider }, 'social unlink');
  }

  /**
   * `NOT_FOUND` for a provider without a client id (nothing verified, nonce untouched); then the
   * nonce is consumed (a reused, expired or forged one is `UNAUTHENTICATED`) and the token verified
   * against it (any failure is `UNAUTHENTICATED`). A failed token still spends the nonce.
   */
  private async verifiedIdentity(
    provider: AuthProvider,
    idToken: string,
    nonce: string,
  ): Promise<VerifiedSocialIdentity> {
    if (!this.verifier.isEnabled(provider)) {
      throw new ApiError('NOT_FOUND');
    }
    const consumption = this.nonces.consume(nonce);
    if (!consumption.ok) {
      this.logger.warn(
        { event: SOCIAL_EVENTS.refused, provider, reason: `nonce_${consumption.reason}` },
        'social token refused',
      );
      throw new ApiError('UNAUTHENTICATED');
    }
    try {
      return await this.verifier.verify(provider, idToken, nonce);
    } catch (error) {
      if (error instanceof SocialTokenRejectedError) {
        this.logger.warn(
          { event: SOCIAL_EVENTS.refused, provider, reason: error.reason },
          'social token refused',
        );
        throw new ApiError('UNAUTHENTICATED');
      }
      throw error;
    }
  }

  /** The link rules of ADR-0003, in the caller's transaction. */
  private async accountFor(
    em: EntityManager,
    identity: VerifiedSocialIdentity,
    input: SocialSignInInput,
    headers: ClientHeaders,
  ): Promise<{ readonly user: User; readonly outcome: SocialSignInOutcome }> {
    const linked = await em.findOne(AuthIdentity, {
      where: { provider: identity.provider, providerSubject: identity.subject },
    });
    if (linked !== null) {
      const user = await em.findOne(User, { where: { id: linked.userId } });
      return { user: assertCanSignIn(user), outcome: 'existing' };
    }

    if (identity.email === null) {
      // Without an email the account can be neither created nor matched (api-divergences D-072).
      throw new ApiError('EMAIL_NOT_VERIFIED');
    }
    const local = await this.users.findByEmail(identity.email, em);
    if (local !== null) {
      if (local.role !== 'CUSTOMER') {
        throw new ApiError('INVALID_CREDENTIALS');
      }
      if (!identity.emailVerified || local.emailVerifiedAt === null) {
        // Sign in to the existing account first, then link (ADR-0003). No link is written.
        throw new ApiError('ALREADY_EXISTS');
      }
      const user = assertCanSignIn(local);
      if (!(await this.insertIdentity(em, user.id, identity))) {
        // The account already has another subject of this provider.
        throw new ApiError('ALREADY_EXISTS');
      }
      return { user, outcome: 'auto_linked' };
    }

    if (!identity.emailVerified) {
      throw new ApiError('EMAIL_NOT_VERIFIED');
    }
    const withEmail = { ...identity, email: identity.email };
    return { user: await this.createAccount(em, withEmail, input, headers), outcome: 'created' };
  }

  /** A verified `CUSTOMER` with no password, its consent rows and its identity. */
  private async createAccount(
    em: EntityManager,
    identity: VerifiedSocialIdentity & { readonly email: string },
    input: SocialSignInInput,
    headers: ClientHeaders,
  ): Promise<User> {
    const acceptedIds = input.acceptedDocumentIds ?? [];
    if (acceptedIds.length === 0) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [
          {
            field: 'acceptedDocumentIds',
            code: 'REQUIRED',
            message: 'is required to create an account',
          },
        ],
      });
    }
    const documents = await this.legal.currentDocuments(DEFAULT_CONSENT_LOCALE, em);
    if (!acceptsCurrentDocuments(acceptedIds, documents)) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [
          {
            field: 'acceptedDocumentIds',
            // The same field code as register (api-divergences D-001).
            code: 'INVALID',
            message: 'must be the ids of the current Terms of Service and Privacy Policy',
          },
        ],
      });
    }

    const result = await em
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        // Lower-cased like every stored email; a private-relay address is kept, not replaced.
        email: normalizeEmail(identity.email),
        passwordHash: null,
        displayName: socialDisplayName(input.displayName, identity),
        locale: REGISTRATION_LOCALE,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerifiedAt: this.clock.now(),
      })
      .orIgnore()
      .returning('id')
      .updateEntity(false)
      .execute();
    const userId = (result.raw as { id: string }[])[0]?.id;
    if (userId === undefined) {
      // The email was taken by a parallel request since the lookup.
      throw new ApiError('ALREADY_EXISTS');
    }
    await this.legal.recordConsents(
      {
        userId,
        documentIds: documents.map((document) => document.id),
        action: 'GRANTED',
        client: consentClientOf(headers.client),
        appVersion: appVersionOf(headers.appVersion),
      },
      em,
    );
    if (!(await this.insertIdentity(em, userId, identity))) {
      // A parallel sign-in with the same subject won; this transaction rolls back.
      throw new ApiError('ALREADY_EXISTS');
    }
    return em.findOneOrFail(User, { where: { id: userId } });
  }

  /** Inserts the link; `false` when a unique constraint already holds it (nothing written). */
  private async insertIdentity(
    em: EntityManager,
    userId: string,
    identity: Pick<VerifiedSocialIdentity, 'provider' | 'subject'>,
  ): Promise<boolean> {
    const result = await em
      .createQueryBuilder()
      .insert()
      .into(AuthIdentity)
      .values({ userId, provider: identity.provider, providerSubject: identity.subject })
      .orIgnore()
      .returning('id')
      .updateEntity(false)
      .execute();
    return (result.raw as { id: string }[]).length > 0;
  }

  /** Serializes link and unlink of one user, so the last way to sign in cannot be removed twice. */
  private async lockUser(em: EntityManager, userId: string): Promise<User> {
    const user = await em.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (user === null) {
      throw new ApiError('UNAUTHENTICATED');
    }
    return user;
  }

  private sessionOf(
    tokens: SessionTokens,
    user: Pick<User, 'id' | 'email' | 'displayName' | 'emailVerifiedAt'>,
  ): AuthSession {
    // The shape of `AuthService` (api-divergences D-044); kept in step with it.
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

/**
 * The account of a found link may sign in only as an `ACTIVE` customer: `ACCOUNT_SUSPENDED` for a
 * suspended one, `INVALID_CREDENTIALS` for any non-`CUSTOMER` and any other status (A2-T6).
 */
export function assertCanSignIn(user: User | null): User {
  if (user?.role !== 'CUSTOMER') {
    throw new ApiError('INVALID_CREDENTIALS');
  }
  if (user.status === 'SUSPENDED') {
    throw new ApiError('ACCOUNT_SUSPENDED');
  }
  if (user.status !== 'ACTIVE') {
    throw new ApiError('INVALID_CREDENTIALS');
  }
  return user;
}
