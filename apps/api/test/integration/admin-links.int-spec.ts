import { randomBytes } from 'node:crypto';

import { ERROR_STATUS } from '@kd/contracts';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import {
  STAFF_LINK_EVENTS,
  STAFF_LINK_TTL_MS,
  StaffLinkService,
} from '../../src/modules/auth/staff-link.service.js';
import { MailService } from '../../src/modules/mail/mail.service.js';
import { MailDeliveryError } from '../../src/modules/mail/ports/mail.port.js';
import type { MailMessage } from '../../src/modules/mail/ports/mail.port.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A3-T3, testing-strategy "Auth and sessions" (staff invitation 48 hours and reset link 30 minutes:
// single use, hashed, expiry, session revocation on reset, staff password length 12) and "Staff
// accounts" (an INVITED user cannot sign in; a new link expires the old): the two public link
// routes end to end, as `kd_app`, against real PostgreSQL. `MailService.send` is replaced by a
// recording double, so the specs read the token from the rendered mail and nothing leaves the
// process. Each test boots its own app, so the in-process per-IP counters (forgot: 5, set: 10 per
// 15 minutes) start empty. The `test` tier uses the default `ADMIN_ORIGINS`
// (`http://localhost:4200`), which is also the base of the links. Fictional data only.

const NOW = '2026-11-07T03:00:00.000Z';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const ADMIN_ORIGIN = 'http://localhost:4200';
const ADMIN_HEADERS = { 'X-Client': 'admin-web', Origin: ADMIN_ORIGIN } as const;

const STAFF_ID = '01930000-0000-7000-8000-000000001101';
const INVITED_ID = '01930000-0000-7000-8000-000000001102';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000001103';
const SUSPENDED_ID = '01930000-0000-7000-8000-000000001104';
const DELETED_ID = '01930000-0000-7000-8000-000000001105';

const STAFF_EMAIL = 'fixture-link-staff@kd.example';
const INVITED_EMAIL = 'fixture-link-invited@kd.example';
const CUSTOMER_EMAIL = 'fixture-link-customer@kd.example';
const SUSPENDED_EMAIL = 'fixture-link-suspended@kd.example';
const DELETED_EMAIL = 'fixture-link-deleted@kd.example';
const UNKNOWN_EMAIL = 'fixture-link-unknown@kd.example';

/** Fictional fixture text, at least 12 characters (staff policy); never a real credential. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';
const NEW_PASSPHRASE = 'kd-fixture-new-staff-passphrase';

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Nhân viên mẫu', 'vi', $4, $5)`;

const INSERT_LINK_SQL = `INSERT INTO public.email_tokens
  (user_id, type, channel, token_hash, target_email, max_attempts, created_at, expires_at, used_at)
  VALUES ($1, $2, 'LINK', $3, $4, 1, $5, $5::timestamptz + interval '30 minutes', $5)`;

/** Every column of `email_tokens`: none of them can hold the plaintext token. */
const EMAIL_TOKEN_COLUMNS = [
  'attempts',
  'channel',
  'created_at',
  'expires_at',
  'id',
  'max_attempts',
  'target_email',
  'token_hash',
  'type',
  'used_at',
  'user_id',
];

interface LinkRow {
  id: string;
  type: string;
  channel: string;
  token_hash: Buffer;
  target_email: string;
  max_attempts: number;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

interface UserRow {
  status: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
}

const TOKEN_IN_MAIL = /#token=([A-Za-z0-9_-]{43})$/mu;

describe('staff links (kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;
  let sent: MailMessage[];

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSPHRASE);
  });

  beforeEach(async () => {
    await truncateAll();
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock });
    client = http(testApp.baseUrl);
    sent = [];
    vi.spyOn(testApp.app.get(MailService), 'send').mockImplementation((message) => {
      sent.push(message);
      return Promise.resolve('fixture-message-id');
    });
    await insertUser(STAFF_ID, STAFF_EMAIL, passwordHash);
    await insertUser(INVITED_ID, INVITED_EMAIL, null, 'STAFF', 'INVITED');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(
    id: string,
    email: string,
    hash: string | null,
    role = 'STAFF',
    status = 'ACTIVE',
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, hash, role, status]);
  }

  function forgot(
    email: string,
    headers: Record<string, string> = ADMIN_HEADERS,
  ): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/password/forgot', { email }, { headers });
  }

  function setPassword(
    token: string,
    password = NEW_PASSPHRASE,
    headers: Record<string, string> = ADMIN_HEADERS,
  ): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/password/set', { token, password }, { headers });
  }

  function login(email: string, password: string): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/login', { email, password }, { headers: ADMIN_HEADERS });
  }

  /** `kd_refresh=<value>` from the `Set-Cookie` of a sign-in. */
  function cookiePairOf(response: TestResponse): string {
    const pair = response.headers.getSetCookie()[0]?.split('; ')[0];
    expect(pair).toMatch(/^kd_refresh=[A-Za-z0-9_-]{43}$/);
    return pair as string;
  }

  function refresh(cookie: string): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/refresh', undefined, {
      headers: { ...ADMIN_HEADERS, Cookie: cookie },
    });
  }

  /** The link of the last recorded mail. */
  function lastLink(): URL {
    const text = sent.at(-1)?.text ?? '';
    const line = text.split('\n').find((part) => part.startsWith(ADMIN_ORIGIN));
    expect(line, 'a link in the last mail').toBeDefined();
    return new URL(line ?? '');
  }

  /** The token of the last recorded mail. */
  function lastToken(): string {
    const match = TOKEN_IN_MAIL.exec(sent.at(-1)?.text ?? '');
    expect(match, 'a token in the last mail').not.toBeNull();
    return match?.[1] ?? '';
  }

  function linkRows(userId: string, type: string): Promise<LinkRow[]> {
    return query<LinkRow>(
      `SELECT id, type, channel, token_hash, target_email, max_attempts, created_at, expires_at,
              used_at
         FROM public.email_tokens WHERE user_id = $1 AND type = $2 ORDER BY created_at, id`,
      [userId, type],
    );
  }

  async function userRow(id: string): Promise<UserRow> {
    const rows = await query<UserRow>(
      `SELECT status, password_hash, email_verified_at, failed_login_count, locked_until
         FROM public.users WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture user missing');
    }
    return row;
  }

  function auditRows(): Promise<{ action: string; actor_user_id: string | null; diff: object }[]> {
    return query(
      'SELECT action, actor_user_id, diff FROM public.audit_logs ORDER BY created_at, id',
    );
  }

  /** Rows of past links, all spent, created `agesMs` before now. */
  async function seedPastLinks(userId: string, email: string, agesMs: readonly number[]) {
    for (const age of agesMs) {
      const createdAt = new Date(clock.now().getTime() - age);
      await query(INSERT_LINK_SQL, [
        userId,
        'RESET_PASSWORD',
        randomBytes(32),
        email,
        createdAt.toISOString(),
      ]);
    }
  }

  function expectAccepted(response: TestResponse): void {
    expect(response.status).toBe(202);
    expect(response.body).toBeNull();
  }

  function expectCodeInvalid(response: TestResponse): void {
    expect(response.status).toBe(ERROR_STATUS.CODE_INVALID);
    expect(response.problem?.code).toBe('CODE_INVALID');
  }

  function answer(response: TestResponse): unknown {
    return { status: response.status, body: response.body };
  }

  describe('invitation', () => {
    it('an INVITED account gets an invitation, hashed at rest, and signs in only after set', async () => {
      expect((await login(INVITED_EMAIL, NEW_PASSPHRASE)).status).toBe(401);

      expectAccepted(await forgot(INVITED_EMAIL));

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ templateKey: 'STAFF_INVITE', to: INVITED_EMAIL });
      const link = lastLink();
      expect(link.origin).toBe(ADMIN_ORIGIN);
      expect(link.pathname).toBe('/auth/set-password');
      expect(link.search).toBe('');
      const token = lastToken();
      expect(link.hash).toBe(`#token=${token}`);
      expect(sent[0]?.subject).not.toContain(token);

      // An invitation, not a reset.
      expect(await linkRows(INVITED_ID, 'RESET_PASSWORD')).toHaveLength(0);
      const [row] = await linkRows(INVITED_ID, 'INVITE');
      expect(row).toMatchObject({
        channel: 'LINK',
        target_email: INVITED_EMAIL,
        max_attempts: 1,
        used_at: null,
      });
      expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + 48 * HOUR);
      expect((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)).toBe(
        STAFF_LINK_TTL_MS.INVITE,
      );

      // Hashed at rest: 32 bytes, and no column holds the token.
      expect(row?.token_hash).toHaveLength(32);
      const columns = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'email_tokens' ORDER BY column_name`,
      );
      expect(columns.map(({ column_name }) => column_name)).toEqual(EMAIL_TOKEN_COLUMNS);
      const everything = await query('SELECT * FROM public.email_tokens');
      expect(JSON.stringify(everything)).not.toContain(token);
      expect(row?.token_hash.toString('utf8')).not.toContain(token);

      // Still no sign-in before the link is used.
      expect((await login(INVITED_EMAIL, NEW_PASSPHRASE)).status).toBe(401);

      const set = await setPassword(token);
      expect(set.status).toBe(204);
      expect(set.headers.getSetCookie()).toEqual([]);

      const user = await userRow(INVITED_ID);
      expect(user.status).toBe('ACTIVE');
      expect(user.password_hash).not.toBeNull();
      expect(user.email_verified_at?.toISOString()).toBe(NOW);
      expect((await linkRows(INVITED_ID, 'INVITE'))[0]?.used_at).not.toBeNull();

      expect((await login(INVITED_EMAIL, NEW_PASSPHRASE)).status).toBe(200);

      const audit = await auditRows();
      expect(audit).toEqual(
        expect.arrayContaining([
          {
            action: 'auth.password_reset_requested',
            actor_user_id: null,
            diff: { linkType: 'INVITE' },
          },
          { action: 'auth.password_set', actor_user_id: INVITED_ID, diff: {} },
        ]),
      );
      expect(JSON.stringify(audit)).not.toContain(token);
    });

    it('is single use', async () => {
      await forgot(INVITED_EMAIL);
      const token = lastToken();

      expect((await setPassword(token)).status).toBe(204);
      expectCodeInvalid(await setPassword(token, 'kd-fixture-third-passphrase'));
    });

    it('expires after 48 hours', async () => {
      await forgot(INVITED_EMAIL);
      const token = lastToken();

      clock.advance(48 * HOUR);

      expectCodeInvalid(await setPassword(token));
      expect((await userRow(INVITED_ID)).status).toBe('INVITED');
    });

    it('is still usable just before 48 hours', async () => {
      await forgot(INVITED_EMAIL);
      const token = lastToken();

      clock.advance(48 * HOUR - SECOND);

      expect((await setPassword(token)).status).toBe(204);
    });

    it('a new link expires the old one', async () => {
      await forgot(INVITED_EMAIL);
      const oldToken = lastToken();

      clock.advance(61 * SECOND);
      expectAccepted(await forgot(INVITED_EMAIL));
      expect(sent).toHaveLength(2);
      const newToken = lastToken();
      expect(newToken).not.toBe(oldToken);

      const rows = await linkRows(INVITED_ID, 'INVITE');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.used_at).not.toBeNull();
      expect(rows[1]?.used_at).toBeNull();

      expectCodeInvalid(await setPassword(oldToken));
      expect((await setPassword(newToken)).status).toBe(204);
    });

    it('issueInvite (used by A3-T4) supersedes the live link and refuses an active account', async () => {
      const links = testApp.app.get(StaffLinkService);

      expect(await links.issueInvite(INVITED_ID)).toEqual({ issued: true });
      const oldToken = lastToken();
      expect(await links.issueInvite(INVITED_ID)).toEqual({
        issued: false,
        reason: 'RESEND_TOO_SOON',
        retryAfterSeconds: 60,
      });
      clock.advance(60 * SECOND);
      expect(await links.issueInvite(INVITED_ID)).toEqual({ issued: true });
      expectCodeInvalid(await setPassword(oldToken));

      expect(await links.issueInvite(STAFF_ID)).toEqual({ issued: false, reason: 'NOT_ELIGIBLE' });
      expect(await links.issueReset(INVITED_ID)).toEqual({
        issued: false,
        reason: 'NOT_ELIGIBLE',
      });
      // The admin actions write their own audit entry (A3-T4).
      expect(await auditRows()).toEqual([]);
    });
  });

  describe('password reset', () => {
    it('sends a 30-minute reset link to an ACTIVE account', async () => {
      expectAccepted(await forgot(STAFF_EMAIL));

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ templateKey: 'STAFF_PASSWORD_RESET', to: STAFF_EMAIL });
      expect(lastLink().pathname).toBe('/auth/reset-password');
      const [row] = await linkRows(STAFF_ID, 'RESET_PASSWORD');
      expect(row?.channel).toBe('LINK');
      expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + 30 * MINUTE);
      expect(await auditRows()).toEqual([
        {
          action: 'auth.password_reset_requested',
          actor_user_id: null,
          diff: { linkType: 'RESET_PASSWORD' },
        },
      ]);
    });

    it('expires after 30 minutes', async () => {
      await forgot(STAFF_EMAIL);
      const token = lastToken();

      clock.advance(30 * MINUTE);

      expectCodeInvalid(await setPassword(token));
      expect((await login(STAFF_EMAIL, PASSPHRASE)).status).toBe(200);
    });

    it('revokes every session, clears the lockout, and does not sign in', async () => {
      const signIn = await login(STAFF_EMAIL, PASSPHRASE);
      expect(signIn.status).toBe(200);
      const cookie = cookiePairOf(signIn);
      await query(
        `UPDATE public.users SET failed_login_count = 7, locked_until = $2 WHERE id = $1`,
        [STAFF_ID, new Date(clock.now().getTime() + HOUR).toISOString()],
      );

      await forgot(STAFF_EMAIL);
      const set = await setPassword(lastToken());

      expect(set.status).toBe(204);
      expect(set.headers.getSetCookie()).toEqual([]);
      const tokens = await query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM public.refresh_tokens WHERE user_id = $1',
        [STAFF_ID],
      );
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(({ revoked_at }) => revoked_at !== null)).toBe(true);
      expect((await refresh(cookie)).status).toBe(401);

      const user = await userRow(STAFF_ID);
      expect(user).toMatchObject({ status: 'ACTIVE', failed_login_count: 0, locked_until: null });
      expect((await login(STAFF_EMAIL, PASSPHRASE)).status).toBe(401);
      expect((await login(STAFF_EMAIL, NEW_PASSPHRASE)).status).toBe(200);
      expect((await auditRows()).map(({ action }) => action)).toContain(
        'auth.password_reset_completed',
      );
    });

    it('refuses a link of an account suspended since it was sent', async () => {
      await forgot(STAFF_EMAIL);
      const token = lastToken();
      await query(`UPDATE public.users SET status = 'SUSPENDED' WHERE id = $1`, [STAFF_ID]);

      expectCodeInvalid(await setPassword(token));
      expect((await linkRows(STAFF_ID, 'RESET_PASSWORD'))[0]?.used_at).not.toBeNull();
    });
  });

  describe('set', () => {
    it('refuses a password under 12 characters with VALIDATION_FAILED and keeps the link', async () => {
      await forgot(INVITED_EMAIL);
      const token = lastToken();

      const short = await setPassword(token, 'kd-11-chars');

      expect(short.status).toBe(400);
      expect(short.problem?.code).toBe('VALIDATION_FAILED');
      expect(short.problem?.errors).toEqual([
        expect.objectContaining({ field: 'password', code: 'TOO_SHORT' }),
      ]);
      expect((await linkRows(INVITED_ID, 'INVITE'))[0]?.used_at).toBeNull();
      expect((await setPassword(token)).status).toBe(204);
    });

    it('refuses a password over 128 characters', async () => {
      await forgot(INVITED_EMAIL);

      const long = await setPassword(lastToken(), 'k'.repeat(129));

      expect(long.status).toBe(400);
      expect(long.problem?.code).toBe('VALIDATION_FAILED');
    });

    it('refuses the account email as password and rolls the link back', async () => {
      await forgot(INVITED_EMAIL);
      const token = lastToken();

      const same = await setPassword(token, INVITED_EMAIL);

      expect(same.status).toBe(400);
      expect(same.problem?.code).toBe('VALIDATION_FAILED');
      expect(await userRow(INVITED_ID)).toMatchObject({ status: 'INVITED', password_hash: null });
      expect((await setPassword(token)).status).toBe(204);
    });

    it('answers an unknown, a malformed and a code-like token the same CODE_INVALID', async () => {
      const unknown = await setPassword(randomBytes(32).toString('base64url'));
      const malformed = await setPassword('not-a-token');
      const digits = await setPassword('123456');

      expectCodeInvalid(unknown);
      expect(answer(malformed)).toEqual(answer(unknown));
      expect(answer(digits)).toEqual(answer(unknown));
    });

    it('needs the admin web headers', async () => {
      await forgot(INVITED_EMAIL);

      const response = await setPassword(lastToken(), NEW_PASSPHRASE, { Origin: ADMIN_ORIGIN });

      expect(response.status).toBe(403);
      expect(response.problem?.code).toBe('FORBIDDEN');
      expect((await userRow(INVITED_ID)).status).toBe('INVITED');
    });
  });

  describe('forgot', () => {
    it('answers known and unknown emails identically, mailing only staff accounts', async () => {
      await insertUser(CUSTOMER_ID, CUSTOMER_EMAIL, passwordHash, 'CUSTOMER');
      await insertUser(SUSPENDED_ID, SUSPENDED_EMAIL, passwordHash, 'STAFF', 'SUSPENDED');
      await insertUser(DELETED_ID, DELETED_EMAIL, null, 'STAFF', 'DELETED');

      const known = await forgot(STAFF_EMAIL);
      const responses = [
        await forgot(UNKNOWN_EMAIL),
        await forgot(CUSTOMER_EMAIL),
        await forgot(SUSPENDED_EMAIL),
        await forgot(DELETED_EMAIL),
      ];

      expectAccepted(known);
      for (const response of responses) {
        expect(answer(response)).toEqual(answer(known));
      }
      expect(sent.map(({ to }) => to)).toEqual([STAFF_EMAIL]);
      const rows = await query<{ user_id: string }>('SELECT user_id FROM public.email_tokens');
      expect(rows.map(({ user_id }) => user_id)).toEqual([STAFF_ID]);
    });

    it('sends at most one message per 60 seconds', async () => {
      await forgot(STAFF_EMAIL);

      clock.advance(59 * SECOND);
      expectAccepted(await forgot(STAFF_EMAIL));
      expect(sent).toHaveLength(1);
      expect(await linkRows(STAFF_ID, 'RESET_PASSWORD')).toHaveLength(1);

      clock.advance(SECOND);
      expectAccepted(await forgot(STAFF_EMAIL));
      expect(sent).toHaveLength(2);
    });

    it('sends nothing beyond 5 messages in 24 hours and logs it', async () => {
      await seedPastLinks(STAFF_ID, STAFF_EMAIL, [
        23 * HOUR,
        12 * HOUR,
        6 * HOUR,
        HOUR,
        2 * MINUTE,
      ]);
      const warn = vi.spyOn(Logger.prototype, 'warn');

      expectAccepted(await forgot(STAFF_EMAIL));

      expect(sent).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        { event: STAFF_LINK_EVENTS.dailyCapReached, userId: STAFF_ID, type: 'RESET_PASSWORD' },
        expect.any(String),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(STAFF_EMAIL);
    });

    it('answers 202 when the mail transport fails and logs no address, token or link', async () => {
      const captured: MailMessage[] = [];
      vi.mocked(testApp.app.get(MailService).send).mockImplementation((message) => {
        captured.push(message);
        return Promise.reject(new MailDeliveryError('STAFF_PASSWORD_RESET', 'ECONNREFUSED'));
      });
      const calls = [
        vi.spyOn(Logger.prototype, 'log'),
        vi.spyOn(Logger.prototype, 'warn'),
        vi.spyOn(Logger.prototype, 'error'),
      ];

      expectAccepted(await forgot(STAFF_EMAIL));

      await vi.waitFor(() => {
        expect(calls[1]).toHaveBeenCalledWith(
          expect.objectContaining({ event: STAFF_LINK_EVENTS.sendFailed, userId: STAFF_ID }),
          expect.any(String),
        );
      });
      const token = TOKEN_IN_MAIL.exec(captured[0]?.text ?? '')?.[1];
      expect(token).toBeDefined();
      const logged = JSON.stringify(calls.map((spy) => spy.mock.calls));
      expect(logged).not.toContain(STAFF_EMAIL);
      expect(logged).not.toContain(token);
      expect(logged).not.toContain('#token=');
    });

    it('needs the admin web headers', async () => {
      const response = await forgot(STAFF_EMAIL, { 'X-Client': 'admin-web' });

      expect(response.status).toBe(403);
      expect(response.problem?.code).toBe('FORBIDDEN');
      expect(sent).toHaveLength(0);
    });
  });
});
