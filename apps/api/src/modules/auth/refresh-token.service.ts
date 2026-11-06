import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import { Clock } from '../../common/time/clock.js';
import { AuditService } from '../audit/audit.service.js';
import { User } from '../users/entities/user.entity.js';
import type { UserRole } from '../users/entities/user.entity.js';
import { UserSessionRevoker } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { REFRESH_GRACE_WINDOW_MS, RefreshGrace } from './refresh-grace.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Idle (sliding) and absolute session lifetimes (decision 0008 section 1). */
export const SESSION_PROFILES = {
  customer: { idleMs: 30 * DAY_MS, absoluteMs: 90 * DAY_MS },
  staff: { idleMs: 24 * HOUR_MS, absoluteMs: 7 * DAY_MS },
} as const;

export type SessionProfile = (typeof SESSION_PROFILES)[keyof typeof SESSION_PROFILES];

/** The role at issue time selects the profile (decision 0008 section 1). */
export function sessionProfileOf(role: UserRole): SessionProfile {
  return role === 'CUSTOMER' ? SESSION_PROFILES.customer : SESSION_PROFILES.staff;
}

/**
 * Live families per user (decision 0008 section 1): a new sign-in beyond the limit silently revokes
 * the least recently used family; the sign-in itself never fails because of it.
 */
export const LIVE_FAMILY_LIMITS = { customer: 10, staff: 5 } as const;

/** The role at issue time selects the limit, like the session profile. */
export function liveFamilyLimitOf(role: UserRole): number {
  return role === 'CUSTOMER' ? LIVE_FAMILY_LIMITS.customer : LIVE_FAMILY_LIMITS.staff;
}

export const DEVICE_LABEL_MAX_LENGTH = 60;
export const DEVICE_LABEL_FALLBACK = 'unknown';

/**
 * Decision 0008 section 1: NFC, control characters removed, whitespace collapsed and trimmed, cut
 * (not refused) at 60 code points; `unknown` when nothing is left. Display only.
 */
export function normalizeDeviceLabel(label: string | null | undefined): string {
  if (label === null || label === undefined) {
    return DEVICE_LABEL_FALLBACK;
  }
  const cleaned = label
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const cut = Array.from(cleaned).slice(0, DEVICE_LABEL_MAX_LENGTH).join('').trimEnd();
  return cut === '' ? DEVICE_LABEL_FALLBACK : cut;
}

/** 256 bits from the CSPRNG, base64url (43 characters). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of the raw token: the only form stored (`refresh_tokens.token_hash`). */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** What a sign-in or a refresh hands to the transport (A2-T1, A3-T1). */
export interface SessionTokens {
  readonly userId: string;
  readonly role: UserRole;
  /** The family id: `sid` claim and the id of `/me/sessions/{id}`. */
  readonly sessionId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  /** Idle end of this refresh token, never after the family's absolute end. */
  readonly refreshTokenExpiresAt: Date;
}

interface CachedRotation {
  readonly familyId: string;
  readonly successorId: string;
  readonly tokens: SessionTokens;
}

type RotationOutcome =
  | { readonly kind: 'refused' }
  | { readonly kind: 'reuse'; readonly familyId: string }
  | {
      readonly kind: 'rotated';
      readonly userId: string;
      readonly role: UserRole;
      readonly familyId: string;
      readonly successorId: string;
      readonly refreshToken: string;
      readonly expiresAt: Date;
    };

function unauthenticated(): ApiError {
  // No detail: unknown, expired, revoked and reused tokens look the same to the client.
  return new ApiError('UNAUTHENTICATED');
}

/**
 * Refresh tokens (ADR-0003; decision 0008 sections 1 and 2): opaque, single use, stored as SHA-256
 * only, rotated in a family with reuse detection and the 10-second grace window. Also the
 * `UserSessionRevoker` of A1-T5. No token, hash or family id is logged or put in an error.
 */
@Injectable()
export class RefreshTokenService extends UserSessionRevoker {
  private readonly grace = new RefreshGrace<CachedRotation>();

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {
    super();
  }

  /**
   * Opens a new family for `userId` (sign-in, registration): idle and absolute expiry from the
   * user's role. Then applies the live-family limit of decision 0008 section 1 in the same
   * transaction: the families beyond it, least recently used first, are revoked. The user row is
   * locked first, so two parallel sign-ins of one user count each other. Joins the caller's
   * transaction when given (it must be a transactional manager: the row lock needs one), otherwise
   * opens one.
   */
  async issue(
    userId: string,
    options: { readonly deviceLabel?: string | null } = {},
    manager?: EntityManager,
  ): Promise<SessionTokens> {
    const issued = await (manager === undefined
      ? this.dataSource.transaction((em) => this.issueInTransaction(em, userId, options))
      : this.issueInTransaction(manager, userId, options));
    for (const familyId of issued.revokedFamilyIds) {
      this.grace.forgetFamily(familyId);
    }
    return this.tokensFor(issued);
  }

  private async issueInTransaction(
    em: EntityManager,
    userId: string,
    options: { readonly deviceLabel?: string | null },
  ): Promise<{
    readonly userId: string;
    readonly role: UserRole;
    readonly familyId: string;
    readonly refreshToken: string;
    readonly expiresAt: Date;
    readonly revokedFamilyIds: readonly string[];
  }> {
    const user = await em.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (user === null) {
      throw new ApiError('NOT_FOUND');
    }
    const now = this.clock.now();
    const profile = sessionProfileOf(user.role);
    const familyExpiresAt = new Date(now.getTime() + profile.absoluteMs);
    const expiresAt = new Date(Math.min(now.getTime() + profile.idleMs, familyExpiresAt.getTime()));
    const refreshToken = generateRefreshToken();

    const result = await em
      .createQueryBuilder()
      .insert()
      .into(RefreshToken)
      .values({
        userId,
        // A new family id from the database, like every id (decision 0007 section 8).
        familyId: () => 'uuidv7()',
        tokenHash: hashRefreshToken(refreshToken),
        deviceLabel: normalizeDeviceLabel(options.deviceLabel),
        createdAt: now,
        expiresAt,
        familyExpiresAt,
        lastUsedAt: now,
      })
      .returning('family_id')
      .updateEntity(false)
      .execute();
    const familyId = (result.raw as { family_id: string }[])[0]?.family_id;
    if (familyId === undefined) {
      throw new Error('The refresh token insert returned no family id.');
    }
    const revokedFamilyIds = await this.revokeFamiliesBeyondLimit(
      em,
      userId,
      liveFamilyLimitOf(user.role),
      now,
    );
    return { userId, role: user.role, familyId, refreshToken, expiresAt, revokedFamilyIds };
  }

  /**
   * A live family has one head row: unused, not revoked, inside both its idle and absolute expiry.
   * Heads are ranked by `last_used_at`, then `created_at` and the time-ordered `id` (UUIDv7), newest
   * first; the families past `limit` are revoked. The family just issued is the newest, so it is
   * always kept.
   */
  private async revokeFamiliesBeyondLimit(
    em: EntityManager,
    userId: string,
    limit: number,
    now: Date,
  ): Promise<string[]> {
    const surplus = await em
      .createQueryBuilder(RefreshToken, 'token')
      .select('token.familyId', 'familyId')
      .where('token.userId = :userId', { userId })
      .andWhere('token.usedAt IS NULL AND token.revokedAt IS NULL')
      .andWhere('token.expiresAt > :now AND token.familyExpiresAt > :now', { now })
      .orderBy('token.lastUsedAt', 'DESC')
      .addOrderBy('token.createdAt', 'DESC')
      .addOrderBy('token.id', 'DESC')
      .offset(limit)
      .getRawMany<{ familyId: string }>();
    const familyIds = surplus.map((row) => row.familyId);
    if (familyIds.length > 0) {
      await em
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revokedAt: now })
        .where('family_id IN (:...familyIds) AND revoked_at IS NULL', { familyIds })
        .updateEntity(false)
        .execute();
    }
    return familyIds;
  }

  /**
   * Rotates a presented token (decision 0008 section 2). Unknown, revoked or expired (idle or
   * absolute): `UNAUTHENTICATED`. Valid and unused: marked used and replaced by a successor of the
   * same family (idle expiry moves, absolute does not). Used within the grace window: the same
   * successor, nothing revoked. Used outside it: reuse, the whole family is revoked and audited,
   * and the revocation commits before `UNAUTHENTICATED` is thrown.
   */
  async rotate(presentedToken: string): Promise<SessionTokens> {
    const hash = hashRefreshToken(presentedToken);
    const key = hash.toString('hex');
    const nowMs = (): number => this.clock.now().getTime();

    const earlier = this.grace.get(key, nowMs());
    if (earlier !== undefined) {
      return this.confirmGrace(await earlier);
    }
    const rotation = await this.grace.start(key, () => this.rotateOnce(hash), nowMs);
    return rotation.tokens;
  }

  /** Revokes one family (logout, `DELETE /me/sessions/{id}`). */
  async revokeFamily(familyId: string, manager?: EntityManager): Promise<void> {
    await (manager ?? this.dataSource.manager)
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: this.clock.now() })
      .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
      .updateEntity(false)
      .execute();
    this.grace.forgetFamily(familyId);
  }

  /**
   * Revokes every family of the user: logout everywhere, password change or reset, suspension,
   * role change (brief E6), MFA reset. Joins the caller's transaction when given.
   */
  async revokeAllForUser(userId: string, manager?: EntityManager): Promise<void> {
    const result = await (manager ?? this.dataSource.manager)
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: this.clock.now() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .returning('family_id')
      .updateEntity(false)
      .execute();
    const families = new Set((result.raw as { family_id: string }[]).map((row) => row.family_id));
    for (const familyId of families) {
      this.grace.forgetFamily(familyId);
    }
  }

  /** The hook of A1-T5 (`UsersService.transition`, later the role change). */
  revokeAllSessions(manager: EntityManager, userId: string): Promise<void> {
    return this.revokeAllForUser(userId, manager);
  }

  /** Revokes the family of a presented token (logout); an unknown token changes nothing. */
  async revokeByToken(presentedToken: string, manager?: EntityManager): Promise<void> {
    const em = manager ?? this.dataSource.manager;
    const row = await em
      .createQueryBuilder(RefreshToken, 'token')
      .where('token.tokenHash = :hash', { hash: hashRefreshToken(presentedToken) })
      .getOne();
    if (row !== null) {
      await this.revokeFamily(row.familyId, em);
    }
  }

  /** One rotation in one transaction; throws only after the transaction has committed. */
  private async rotateOnce(hash: Buffer): Promise<CachedRotation> {
    const outcome = await this.dataSource.transaction((em) => this.rotateInTransaction(em, hash));
    if (outcome.kind === 'reuse') {
      this.grace.forgetFamily(outcome.familyId);
      throw unauthenticated();
    }
    if (outcome.kind === 'refused') {
      throw unauthenticated();
    }
    const tokens = await this.tokensFor(outcome);
    return { familyId: outcome.familyId, successorId: outcome.successorId, tokens };
  }

  private async rotateInTransaction(em: EntityManager, hash: Buffer): Promise<RotationOutcome> {
    const row = await em
      .createQueryBuilder(RefreshToken, 'token')
      .where('token.tokenHash = :hash', { hash })
      .setLock('pessimistic_write')
      .getOne();
    if (row === null || row.revokedAt !== null) {
      return { kind: 'refused' };
    }
    const now = this.clock.now();

    if (row.usedAt !== null) {
      // No grace entry was found for this hash (rotate checked it first).
      if (now.getTime() - row.usedAt.getTime() <= REFRESH_GRACE_WINDOW_MS) {
        // Restart rule (decision 0008 section 2): inside the window with no entry, the process
        // restarted; refuse without revoking.
        return { kind: 'refused' };
      }
      await this.revokeForReuse(em, row, now);
      return { kind: 'reuse', familyId: row.familyId };
    }

    if (
      row.expiresAt.getTime() <= now.getTime() ||
      row.familyExpiresAt.getTime() <= now.getTime()
    ) {
      return { kind: 'refused' };
    }

    const user = await em.findOne(User, { where: { id: row.userId } });
    if (user === null) {
      return { kind: 'refused' };
    }
    const profile = sessionProfileOf(user.role);
    const expiresAt = new Date(
      Math.min(now.getTime() + profile.idleMs, row.familyExpiresAt.getTime()),
    );
    const refreshToken = generateRefreshToken();

    // The successor first: replaced_by_id is an immediate foreign key (api-divergences D-031).
    const inserted = await em
      .createQueryBuilder()
      .insert()
      .into(RefreshToken)
      .values({
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: hashRefreshToken(refreshToken),
        deviceLabel: row.deviceLabel,
        createdAt: now,
        expiresAt,
        familyExpiresAt: row.familyExpiresAt,
        lastUsedAt: now,
      })
      .returning('id')
      .updateEntity(false)
      .execute();
    const successorId = (inserted.raw as { id: string }[])[0]?.id;
    if (successorId === undefined) {
      throw new Error('The refresh token insert returned no id.');
    }
    await em
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ usedAt: now, replacedById: successorId })
      .where('id = :id', { id: row.id })
      .updateEntity(false)
      .execute();

    return {
      kind: 'rotated',
      userId: row.userId,
      role: user.role,
      familyId: row.familyId,
      successorId,
      refreshToken,
      expiresAt,
    };
  }

  /**
   * A presentation that found a grace entry: the same successor, provided it is still unused and
   * not revoked (decision 0008 section 2); a used successor makes it reuse.
   */
  private async confirmGrace(rotation: CachedRotation): Promise<SessionTokens> {
    const outcome = await this.dataSource.transaction(async (em) => {
      const successor = await em.findOne(RefreshToken, {
        where: { id: rotation.successorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (successor === null || successor.revokedAt !== null) {
        return 'refused' as const;
      }
      if (successor.usedAt !== null) {
        await this.revokeForReuse(em, successor, this.clock.now());
        return 'reuse' as const;
      }
      return 'grace' as const;
    });
    if (outcome === 'grace') {
      return rotation.tokens;
    }
    if (outcome === 'reuse') {
      this.grace.forgetFamily(rotation.familyId);
    }
    throw unauthenticated();
  }

  /** Revokes every row of the family and writes `auth.refresh_reuse`, never the token. */
  private async revokeForReuse(
    em: EntityManager,
    row: Pick<RefreshToken, 'userId' | 'familyId'>,
    now: Date,
  ): Promise<void> {
    await em
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: now })
      .where('family_id = :familyId AND revoked_at IS NULL', { familyId: row.familyId })
      .updateEntity(false)
      .execute();
    await this.audit.write(
      {
        // Detected by the system: the presenter may be the user or an attacker.
        actorUserId: null,
        action: 'auth.refresh_reuse',
        entityType: 'USER',
        entityId: row.userId,
      },
      em,
    );
  }

  private async tokensFor(input: {
    readonly userId: string;
    readonly role: UserRole;
    readonly familyId: string;
    readonly refreshToken: string;
    readonly expiresAt: Date;
  }): Promise<SessionTokens> {
    const access = await this.accessTokens.sign({
      userId: input.userId,
      role: input.role,
      sessionId: input.familyId,
    });
    return {
      userId: input.userId,
      role: input.role,
      sessionId: input.familyId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: input.refreshToken,
      refreshTokenExpiresAt: input.expiresAt,
    };
  }
}
