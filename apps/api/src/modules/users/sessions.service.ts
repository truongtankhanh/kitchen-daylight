import { Inject, Injectable } from '@nestjs/common';
import type { Paged } from '@kd/contracts';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import { toOffset } from '../../common/pagination/page-query.dto.js';
import { Clock } from '../../common/time/clock.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';

/** One signed-in device of `GET /me/sessions` (api-divergences D-058). */
export interface MySession {
  /** The refresh-token family id. */
  readonly id: string;
  readonly deviceLabel: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly isCurrent: boolean;
}

export type MySessionPage = Paged<MySession>;

/** A live family as the list query returns it. */
export interface LiveFamilyRow {
  readonly family_id: string;
  readonly device_label: string;
  readonly created_at: Date;
  readonly last_used_at: Date;
}

/** Projects one live family; `isCurrent` compares with the `sid` of the caller's access token. */
export function toMySession(row: LiveFamilyRow, currentSessionId: string): MySession {
  return {
    id: row.family_id,
    deviceLabel: row.device_label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
    isCurrent: row.family_id === currentSessionId,
  };
}

/**
 * A live family has one head row: unused, not revoked, inside its idle and absolute expiry (the
 * definition of `RefreshTokenService`, decision 0008 section 1). `$1` is the user, `$2` now.
 */
const LIVE_HEADS = `FROM public.refresh_tokens head
 WHERE head.user_id = $1
   AND head.used_at IS NULL AND head.revoked_at IS NULL
   AND head.expires_at > $2 AND head.family_expires_at > $2`;

/**
 * `created_at` of a family is that of its first row; the head row is the latest rotation. Accurate
 * while the rows of a live family are kept: the purge of data-model "Retention" (30 days after
 * expiry or revocation) must keep the first row of a live family, or this moves forward.
 */
export const LIST_LIVE_FAMILIES_SQL = `SELECT head.family_id, head.device_label, head.last_used_at,
       (SELECT min(first.created_at) FROM public.refresh_tokens first
         WHERE first.family_id = head.family_id AND first.user_id = head.user_id) AS created_at
  ${LIVE_HEADS}
 ORDER BY head.last_used_at DESC, head.id DESC
 OFFSET $3 LIMIT $4`;

export const COUNT_LIVE_FAMILIES_SQL = `SELECT count(*)::int AS total ${LIVE_HEADS}`;

/**
 * The signed-in devices of the acting user (`/me/sessions`, A2-T4; ADR-0003 "logout everywhere").
 * Every query is filtered by the user id from the access token; a family id of another user is
 * `NOT_FOUND`, never revoked. Revocation goes through `RefreshTokenService.revokeFamily`, so the
 * grace cache of the refresh rotation forgets the family too.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** One page of live families, most recently used first. A page past the end has no items. */
  async list(
    actor: { readonly id: string; readonly sessionId: string },
    query: { readonly page: number; readonly pageSize: number },
  ): Promise<MySessionPage> {
    const now = this.clock.now();
    const { offset, limit } = toOffset(query);
    const rows: LiveFamilyRow[] = await this.dataSource.query(LIST_LIVE_FAMILIES_SQL, [
      actor.id,
      now,
      offset,
      limit,
    ]);
    const counted: { total: number }[] = await this.dataSource.query(COUNT_LIVE_FAMILIES_SQL, [
      actor.id,
      now,
    ]);
    return {
      items: rows.map((row) => toMySession(row, actor.sessionId)),
      page: query.page,
      pageSize: query.pageSize,
      total: counted[0]?.total ?? 0,
    };
  }

  /**
   * Revokes one family of the acting user. Idempotent: an already revoked or expired family of the
   * user answers the same. A family the user does not own, or no family, is `NOT_FOUND`.
   */
  async revoke(userId: string, familyId: string): Promise<void> {
    const owned: unknown[] = await this.dataSource.query(
      'SELECT 1 FROM public.refresh_tokens WHERE family_id = $1 AND user_id = $2 LIMIT 1',
      [familyId, userId],
    );
    if (owned.length === 0) {
      throw new ApiError('NOT_FOUND');
    }
    await this.tokens.revokeFamily(familyId);
  }

  /**
   * Revokes every family of the user except `keepFamilyId` (the current session of a password
   * change), in the caller's transaction. Returns how many families were revoked.
   */
  async revokeAllExcept(
    userId: string,
    keepFamilyId: string,
    manager: EntityManager,
  ): Promise<number> {
    const rows: { family_id: string }[] = await manager.query(
      `SELECT DISTINCT family_id FROM public.refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL AND family_id <> $2`,
      [userId, keepFamilyId],
    );
    for (const { family_id: familyId } of rows) {
      await this.tokens.revokeFamily(familyId, manager);
    }
    return rows.length;
  }
}
