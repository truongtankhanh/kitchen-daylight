import { generateKeyPairSync } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { KeySet } from '../../src/modules/auth/key-set.js';
import { REFRESH_GRACE_WINDOW_MS } from '../../src/modules/auth/refresh-grace.js';
import {
  hashRefreshToken,
  LIVE_FAMILY_LIMITS,
  RefreshTokenService,
} from '../../src/modules/auth/refresh-token.service.js';
import type { SessionTokens } from '../../src/modules/auth/refresh-token.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { openAppDataSource } from '../support/app-role.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

const NOW = '2026-11-06T03:00:00.000Z';
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;

const CUSTOMER = '01930000-0000-7000-8000-000000000101';
const OTHER_CUSTOMER = '01930000-0000-7000-8000-000000000102';
const STAFF = '01930000-0000-7000-8000-000000000103';

interface TokenRow {
  id: string;
  family_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  expires_at: Date;
  family_expires_at: Date;
}

/** A P-256 pair generated at run time: no key literal in the repository. */
function ephemeralKeySet(): KeySet {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
  return new KeySet({
    keyId: 'kd-test-int',
    privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKey: base64(publicKey.export({ type: 'spki', format: 'pem' })),
    previousPublicKeys: [],
  });
}

describe('RefreshTokenService (kd_app, real PostgreSQL)', () => {
  let dataSource: DataSource;
  let keys: KeySet;
  let clock: FixedClock;
  let access: AccessTokenService;
  let audit: AuditService;
  let tokens: RefreshTokenService;

  beforeAll(async () => {
    dataSource = await openAppDataSource();
    keys = ephemeralKeySet();
    await keys.onModuleInit();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ userIds: [CUSTOMER, OTHER_CUSTOMER, STAFF] });
    await dataSource.query(`UPDATE public.users SET role = 'STAFF' WHERE id = $1`, [STAFF]);
    clock = new FixedClock(NOW);
    access = new AccessTokenService(keys, clock);
    audit = new AuditService(dataSource);
    tokens = new RefreshTokenService(dataSource, access, audit, clock);
  });

  /** A second process: same database, empty grace map (the restart case of decision 0008). */
  function restartedService(): RefreshTokenService {
    return new RefreshTokenService(dataSource, access, audit, clock);
  }

  async function rowOf(token: string): Promise<TokenRow> {
    const rows = await dataSource.query<TokenRow[]>(
      `SELECT id, family_id, used_at, revoked_at, replaced_by_id, expires_at, family_expires_at
         FROM public.refresh_tokens WHERE token_hash = $1`,
      [hashRefreshToken(token)],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture: no refresh token row');
    }
    return row;
  }

  async function familyRows(familyId: string): Promise<TokenRow[]> {
    return dataSource.query<TokenRow[]>(
      `SELECT id, family_id, used_at, revoked_at, replaced_by_id, expires_at, family_expires_at
         FROM public.refresh_tokens WHERE family_id = $1 ORDER BY created_at, id`,
      [familyId],
    );
  }

  async function reuseAuditRows(): Promise<{ entity_type: string; entity_id: string }[]> {
    return dataSource.query(
      `SELECT entity_type::text AS entity_type, entity_id, actor_user_id, diff
         FROM public.audit_logs WHERE action = 'auth.refresh_reuse'`,
    );
  }

  /** Families of the user with a live head row (unused, unrevoked, unexpired). */
  async function liveFamilies(userId: string): Promise<string[]> {
    const rows = await dataSource.query<{ family_id: string }[]>(
      `SELECT family_id FROM public.refresh_tokens
        WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL
          AND expires_at > $2 AND family_expires_at > $2
        ORDER BY family_id`,
      [userId, clock.now()],
    );
    return rows.map((row) => row.family_id);
  }

  /** One sign-in per second, so every family has its own `last_used_at`. */
  async function signInTimes(userId: string, count: number): Promise<SessionTokens[]> {
    const sessions: SessionTokens[] = [];
    for (let index = 0; index < count; index += 1) {
      sessions.push(await tokens.issue(userId));
      clock.advance(SECOND);
    }
    return sessions;
  }

  async function expectUnauthenticated(work: Promise<unknown>): Promise<void> {
    await expect(work).rejects.toMatchObject({ code: 'UNAUTHENTICATED', detail: undefined });
  }

  describe('issue', () => {
    it('opens a customer family: 30 days idle, 90 absolute, only the hash stored', async () => {
      const session = await tokens.issue(CUSTOMER, { deviceLabel: '  Fixture   Phone ' });

      const row = await rowOf(session.refreshToken);
      expect(row.family_id).toBe(session.sessionId);
      expect(row.expires_at.getTime()).toBe(clock.now().getTime() + 30 * DAY);
      expect(row.family_expires_at.getTime()).toBe(clock.now().getTime() + 90 * DAY);
      expect(session.refreshTokenExpiresAt).toEqual(row.expires_at);

      const stored = await dataSource.query<{ token_hash: Buffer; device_label: string }[]>(
        'SELECT token_hash, device_label FROM public.refresh_tokens',
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.device_label).toBe('Fixture Phone');
      expect(stored[0]?.token_hash.equals(hashRefreshToken(session.refreshToken))).toBe(true);

      await expect(access.verify(session.accessToken)).resolves.toMatchObject({
        userId: CUSTOMER,
        role: 'CUSTOMER',
        sessionId: session.sessionId,
      });
    });

    it('opens a staff family: 24 hours idle, 7 days absolute', async () => {
      const session = await tokens.issue(STAFF);

      const row = await rowOf(session.refreshToken);
      expect(row.expires_at.getTime()).toBe(clock.now().getTime() + DAY);
      expect(row.family_expires_at.getTime()).toBe(clock.now().getTime() + 7 * DAY);
      expect(session.role).toBe('STAFF');
    });

    it('starts a new family at each sign-in', async () => {
      const first = await tokens.issue(CUSTOMER);
      const second = await tokens.issue(CUSTOMER);

      expect(first.sessionId).not.toBe(second.sessionId);
    });
  });

  describe('live-family limit (decision 0008 section 1)', () => {
    it('keeps 10 customer families: the 11th sign-in revokes the least recently used one', async () => {
      const sessions = await signInTimes(CUSTOMER, LIVE_FAMILY_LIMITS.customer);
      const [oldest, secondOldest] = sessions;
      if (oldest === undefined || secondOldest === undefined) {
        throw new Error('fixture: sessions missing');
      }
      // Using the oldest family makes the second one the least recently used.
      await tokens.rotate(oldest.refreshToken);
      clock.advance(SECOND);

      const eleventh = await tokens.issue(CUSTOMER);

      const live = await liveFamilies(CUSTOMER);
      expect(live).toHaveLength(LIVE_FAMILY_LIMITS.customer);
      expect(live).toContain(eleventh.sessionId);
      expect(live).toContain(oldest.sessionId);
      expect(live).not.toContain(secondOldest.sessionId);
      const revoked = await familyRows(secondOldest.sessionId);
      expect(revoked.every((row) => row.revoked_at !== null)).toBe(true);
      await expectUnauthenticated(tokens.rotate(secondOldest.refreshToken));
      expect(await reuseAuditRows()).toEqual([]);
    });

    it('keeps 5 staff families: the 6th sign-in revokes the oldest one', async () => {
      const sessions = await signInTimes(STAFF, LIVE_FAMILY_LIMITS.staff);

      const sixth = await tokens.issue(STAFF);

      const live = await liveFamilies(STAFF);
      expect(live).toHaveLength(LIVE_FAMILY_LIMITS.staff);
      expect(live).toContain(sixth.sessionId);
      expect(live).not.toContain(sessions[0]?.sessionId);
    });

    it('does not count revoked families, nor the families of another user', async () => {
      const sessions = await signInTimes(CUSTOMER, LIVE_FAMILY_LIMITS.customer);
      await signInTimes(OTHER_CUSTOMER, 3);
      const loggedOut = sessions[4];
      if (loggedOut === undefined) {
        throw new Error('fixture: session missing');
      }
      await tokens.revokeFamily(loggedOut.sessionId);

      await tokens.issue(CUSTOMER);

      const live = await liveFamilies(CUSTOMER);
      expect(live).toHaveLength(LIVE_FAMILY_LIMITS.customer);
      for (const session of sessions) {
        if (session !== loggedOut) {
          expect(live).toContain(session.sessionId);
        }
      }
      expect(await liveFamilies(OTHER_CUSTOMER)).toHaveLength(3);
    });

    it('does not count families past their idle expiry', async () => {
      await signInTimes(STAFF, LIVE_FAMILY_LIMITS.staff);
      clock.advance(DAY);
      const fresh = await signInTimes(STAFF, LIVE_FAMILY_LIMITS.staff);

      expect((await liveFamilies(STAFF)).sort()).toEqual(
        fresh.map((session) => session.sessionId).sort(),
      );
      const expiredStillOpen = await dataSource.query<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM public.refresh_tokens
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at <= $2`,
        [STAFF, clock.now()],
      );
      // Expired families are left as they are: the limit revokes live families only.
      expect(expiredStillOpen[0]?.count).toBe(String(LIVE_FAMILY_LIMITS.staff));
    });
  });

  describe('rotate', () => {
    it('follows a rotation chain in one family: idle expiry moves, absolute does not', async () => {
      const first = await tokens.issue(CUSTOMER);
      clock.advance(HOUR);
      const second = await tokens.rotate(first.refreshToken);
      clock.advance(HOUR);
      const third = await tokens.rotate(second.refreshToken);

      expect(new Set([first.sessionId, second.sessionId, third.sessionId]).size).toBe(1);
      const [r1, r2, r3] = await familyRows(first.sessionId);
      expect(r1?.used_at).not.toBeNull();
      expect(r1?.replaced_by_id).toBe(r2?.id);
      expect(r2?.replaced_by_id).toBe(r3?.id);
      expect(r3?.used_at).toBeNull();
      expect(r3?.expires_at.getTime()).toBe(clock.now().getTime() + 30 * DAY);
      expect(r3?.family_expires_at).toEqual(r1?.family_expires_at);
      expect([r1, r2, r3].every((row) => row?.revoked_at === null)).toBe(true);
      await expect(access.verify(third.accessToken)).resolves.toMatchObject({
        sessionId: first.sessionId,
      });
    });

    it('treats a used token outside the window as reuse: revokes the whole family and audits', async () => {
      const first = await tokens.issue(CUSTOMER);
      const second = await tokens.rotate(first.refreshToken);
      const other = await tokens.issue(CUSTOMER);
      clock.advance(REFRESH_GRACE_WINDOW_MS + 1);

      await expectUnauthenticated(tokens.rotate(first.refreshToken));

      // The revocation committed although the call failed, including the successor.
      const family = await familyRows(first.sessionId);
      expect(family).toHaveLength(2);
      expect(family.every((row) => row.revoked_at !== null)).toBe(true);
      await expectUnauthenticated(tokens.rotate(second.refreshToken));
      // Another family of the same user is untouched.
      expect((await rowOf(other.refreshToken)).revoked_at).toBeNull();

      const audits = await reuseAuditRows();
      expect(audits).toEqual([
        { entity_type: 'USER', entity_id: CUSTOMER, actor_user_id: null, diff: {} },
      ]);
      const serialized = JSON.stringify(audits);
      for (const secret of [first.refreshToken, second.refreshToken, first.sessionId]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('returns the same successor within 10 s and revokes nothing', async () => {
      const first = await tokens.issue(CUSTOMER);
      const rotated = await tokens.rotate(first.refreshToken);
      clock.advance(5 * SECOND);

      const again = await tokens.rotate(first.refreshToken);
      clock.advance(5 * SECOND);
      const third = await tokens.rotate(first.refreshToken);

      expect(again).toEqual(rotated);
      expect(third).toEqual(rotated);
      const family = await familyRows(first.sessionId);
      expect(family).toHaveLength(2);
      expect(family.every((row) => row.revoked_at === null)).toBe(true);
      expect(await reuseAuditRows()).toEqual([]);
      // The successor still rotates normally.
      await expect(tokens.rotate(rotated.refreshToken)).resolves.toMatchObject({
        sessionId: first.sessionId,
      });
    });

    it('gives two concurrent rotations the same successor and keeps the family alive', async () => {
      const first = await tokens.issue(CUSTOMER);

      const [a, b] = await Promise.all([
        tokens.rotate(first.refreshToken),
        tokens.rotate(first.refreshToken),
      ]);

      expect(a.refreshToken).toBe(b.refreshToken);
      const family = await familyRows(first.sessionId);
      expect(family).toHaveLength(2);
      expect(family.every((row) => row.revoked_at === null)).toBe(true);
      await expect(tokens.rotate(a.refreshToken)).resolves.toMatchObject({
        sessionId: first.sessionId,
      });
    });

    it('treats the old token as reuse once its successor was used, even within the window', async () => {
      const first = await tokens.issue(CUSTOMER);
      const second = await tokens.rotate(first.refreshToken);
      await tokens.rotate(second.refreshToken);

      await expectUnauthenticated(tokens.rotate(first.refreshToken));

      expect((await familyRows(first.sessionId)).every((row) => row.revoked_at !== null)).toBe(
        true,
      );
      expect(await reuseAuditRows()).toHaveLength(1);
    });

    it('refuses without revoking a used token inside the window after a restart', async () => {
      const first = await tokens.issue(CUSTOMER);
      await tokens.rotate(first.refreshToken);
      clock.advance(3 * SECOND);

      await expectUnauthenticated(restartedService().rotate(first.refreshToken));

      expect((await familyRows(first.sessionId)).every((row) => row.revoked_at === null)).toBe(
        true,
      );
      expect(await reuseAuditRows()).toEqual([]);
    });

    it('refuses a token after its idle expiry, without revoking', async () => {
      const first = await tokens.issue(CUSTOMER);
      clock.advance(30 * DAY);

      await expectUnauthenticated(tokens.rotate(first.refreshToken));
      expect((await rowOf(first.refreshToken)).revoked_at).toBeNull();
    });

    it('refuses a family after its absolute expiry, however recently it rotated', async () => {
      let session: SessionTokens = await tokens.issue(CUSTOMER);
      for (let step = 0; step < 3; step += 1) {
        clock.advance(29 * DAY);
        session = await tokens.rotate(session.refreshToken);
      }
      // 87 days in: the successor's idle end is capped at the family end (day 90).
      const row = await rowOf(session.refreshToken);
      expect(row.expires_at).toEqual(row.family_expires_at);

      clock.advance(3 * DAY);
      await expectUnauthenticated(tokens.rotate(session.refreshToken));
    });

    it('refuses a revoked and an unknown token', async () => {
      const first = await tokens.issue(CUSTOMER);
      await tokens.revokeFamily(first.sessionId);

      await expectUnauthenticated(tokens.rotate(first.refreshToken));
      await expectUnauthenticated(tokens.rotate('fixture-unknown-token'));
      expect(await reuseAuditRows()).toEqual([]);
    });

    it('refuses a grace answer once the family was revoked', async () => {
      const first = await tokens.issue(CUSTOMER);
      await tokens.rotate(first.refreshToken);
      await tokens.revokeFamily(first.sessionId);

      await expectUnauthenticated(tokens.rotate(first.refreshToken));
    });
  });

  describe('revocation', () => {
    it('revokes every family of one user and nothing of another (revokeAllForUser)', async () => {
      const a = await tokens.issue(CUSTOMER);
      const b = await tokens.issue(CUSTOMER);
      const rotatedB = await tokens.rotate(b.refreshToken);
      const other = await tokens.issue(OTHER_CUSTOMER);

      await tokens.revokeAllForUser(CUSTOMER);

      await expectUnauthenticated(tokens.rotate(a.refreshToken));
      await expectUnauthenticated(tokens.rotate(rotatedB.refreshToken));
      // Within the window, the grace entry was dropped with the family.
      await expectUnauthenticated(tokens.rotate(b.refreshToken));
      await expect(tokens.rotate(other.refreshToken)).resolves.toMatchObject({
        userId: OTHER_CUSTOMER,
      });
    });

    it('revokes the family of a presented token, and ignores an unknown one (revokeByToken)', async () => {
      const first = await tokens.issue(CUSTOMER);
      const second = await tokens.rotate(first.refreshToken);

      await tokens.revokeByToken(second.refreshToken);
      await tokens.revokeByToken('fixture-unknown-token');

      expect((await familyRows(first.sessionId)).every((row) => row.revoked_at !== null)).toBe(
        true,
      );
    });

    it('fills the A1-T5 hook: a suspension revokes the sessions in the same transaction', async () => {
      const users = new UsersService(dataSource, new PasswordHasher(), clock, tokens);
      const session = await tokens.issue(STAFF);

      await users.transition(STAFF, 'SUSPENDED');

      await expectUnauthenticated(tokens.rotate(session.refreshToken));
    });
  });
});
