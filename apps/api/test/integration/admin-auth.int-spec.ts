import { decodeProtectedHeader } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import {
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_ENROLMENT_TOKEN_TYPE,
} from '../../src/modules/auth/admin-auth.service.js';
import { REFRESH_GRACE_WINDOW_MS } from '../../src/modules/auth/refresh-grace.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service.js';
import { LOCKOUT_BASE_MS, LOCKOUT_THRESHOLD } from '../../src/modules/users/lockout.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A3-T1, testing-strategy "Auth and sessions" (lockout, identical response, rotation, reuse, grace)
// and "Staff accounts" (an INVITED user cannot sign in): the staff cookie transport end to end, as
// `kd_app`, against real PostgreSQL. Each test boots its own app, so the in-process throttle
// counters (staff login: 10 per 5 minutes per IP) and the grace map start empty. The `test` tier
// allows the default `ADMIN_ORIGINS` (`http://localhost:4200`) and sets no `Secure` flag.
// Fictional data only.

const NOW = '2026-11-07T03:00:00.000Z';
const SECOND = 1000;
const DAY_SECONDS = 24 * 60 * 60;

const ADMIN_ORIGIN = 'http://localhost:4200';
const ADMIN_HEADERS = { 'X-Client': 'admin-web', Origin: ADMIN_ORIGIN } as const;
const COOKIE_PATH = '/api/v1/admin/auth';

const STAFF_ID = '01930000-0000-7000-8000-000000000f01';
const MANAGER_ID = '01930000-0000-7000-8000-000000000f02';
const ADMIN_ID = '01930000-0000-7000-8000-000000000f03';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000000f04';
const INVITED_ID = '01930000-0000-7000-8000-000000000f05';
const LOCKED_ID = '01930000-0000-7000-8000-000000000f06';
const SUSPENDED_ID = '01930000-0000-7000-8000-000000000f07';

const STAFF_EMAIL = 'fixture-staff@kd.example';

/** Fictional fixture text, at least 12 characters (staff policy); never a real credential. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';
const WRONG_PASSPHRASE = 'kd-fixture-wrong-passphrase';

/** A value of the `mfa_credentials_secret_layout` shape; fictional, decrypts to nothing. */
const FAKE_SECRET = `v1.0123456789abcdef.${'A'.repeat(16)}.AAAA.${'A'.repeat(22)}`;

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Nhân viên mẫu', 'vi', $4, $5)`;

interface AdminSessionBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; displayName: string; role: string };
}

interface TokenRow {
  family_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
}

describe('staff auth endpoints, cookie transport (kd_app, real PostgreSQL)', () => {
  let currentHash: string;
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;

  beforeAll(async () => {
    currentHash = await new PasswordHasher().hash(PASSPHRASE);
  });

  beforeEach(async () => {
    await truncateAll();
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock });
    client = http(testApp.baseUrl);
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
    passwordHash: string | null,
    role = 'STAFF',
    status = 'ACTIVE',
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, passwordHash, role, status]);
  }

  function login(
    email: string,
    password: string,
    headers: Record<string, string> = ADMIN_HEADERS,
  ): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/login', { email, password }, { headers });
  }

  function refresh(
    cookie: string | undefined,
    headers: Record<string, string> = ADMIN_HEADERS,
  ): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/refresh', undefined, {
      headers: cookie === undefined ? headers : { ...headers, Cookie: cookie },
    });
  }

  function logout(
    cookie: string | undefined,
    headers: Record<string, string> = ADMIN_HEADERS,
  ): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/logout', undefined, {
      headers: cookie === undefined ? headers : { ...headers, Cookie: cookie },
    });
  }

  /** The single `Set-Cookie` of a response, or `undefined`. */
  function setCookieOf(response: TestResponse): string | undefined {
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeLessThanOrEqual(1);
    return cookies[0];
  }

  /** `kd_refresh=<value>` from a `Set-Cookie`, as a browser sends it back in `Cookie`. */
  function cookiePairOf(response: TestResponse): string {
    const pair = setCookieOf(response)?.split('; ')[0];
    expect(pair).toMatch(/^kd_refresh=[A-Za-z0-9_-]{43}$/);
    return pair as string;
  }

  async function signedIn(): Promise<{ cookie: string; body: AdminSessionBody }> {
    const response = await login(STAFF_EMAIL, PASSPHRASE);
    expect(response.status).toBe(200);
    return { cookie: cookiePairOf(response), body: response.body as AdminSessionBody };
  }

  function tokenRows(): Promise<TokenRow[]> {
    return query<TokenRow>(
      'SELECT family_id, used_at, revoked_at FROM public.refresh_tokens ORDER BY id',
    );
  }

  function auditActions(): Promise<{ action: string; actor_user_id: string | null }[]> {
    return query('SELECT action, actor_user_id FROM public.audit_logs ORDER BY created_at, id');
  }

  /** Status and body: everything a client can compare between two answers. */
  function answer(response: TestResponse): unknown {
    return { status: response.status, body: response.body };
  }

  function expectCleared(response: TestResponse): void {
    expect(setCookieOf(response)).toBe(
      `kd_refresh=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    );
  }

  describe('POST /admin/auth/login', () => {
    it('signs a STAFF account in: body without the refresh token, cookie flags and path, audit', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, currentHash);
      await query('UPDATE public.users SET failed_login_count = 2 WHERE id = $1', [STAFF_ID]);

      const response = await login(STAFF_EMAIL, PASSPHRASE);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 900,
        user: { id: STAFF_ID, displayName: 'Nhân viên mẫu', role: 'STAFF' },
      });
      const cookie = setCookieOf(response);
      expect(cookie).toMatch(
        new RegExp(
          `^kd_refresh=[A-Za-z0-9_-]{43}; Path=${COOKIE_PATH}; Max-Age=${DAY_SECONDS}; HttpOnly; SameSite=Strict$`,
        ),
      );
      // The test tier sets no Secure flag (decision 0008 section 10; `demo` and `prod` do, unit spec).
      expect(cookie).not.toContain('Secure');
      expect(cookie?.toLowerCase()).not.toContain('domain=');
      // The refresh token never appears in a body.
      expect(JSON.stringify(response.body)).not.toContain(cookiePairOf(response).slice(11));

      const [user] = await query<Record<string, unknown>>(
        'SELECT failed_login_count, locked_until, last_login_at FROM public.users',
      );
      expect(user).toEqual({
        failed_login_count: 0,
        locked_until: null,
        last_login_at: new Date(NOW),
      });
      const tokens = await query<{ device_label: string }>(
        'SELECT device_label FROM public.refresh_tokens',
      );
      expect(tokens).toEqual([{ device_label: 'admin-web' }]);
      expect(await auditActions()).toEqual([
        { action: 'auth.login_succeeded', actor_user_id: STAFF_ID },
      ]);
    });

    it('answers unknown email, wrong password, locked, INVITED, customer and deleted alike', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, currentHash);
      await insertUser(LOCKED_ID, 'fixture-locked@kd.example', currentHash);
      await query(
        `UPDATE public.users SET locked_until = $1::timestamptz + interval '15 minutes'
          WHERE id = $2`,
        [NOW, LOCKED_ID],
      );
      await insertUser(INVITED_ID, 'fixture-invited@kd.example', null, 'STAFF', 'INVITED');
      await insertUser(CUSTOMER_ID, 'fixture-customer@kd.example', currentHash, 'CUSTOMER');
      await insertUser(
        '01930000-0000-7000-8000-000000000f08',
        'fixture-deleted@kd.example',
        currentHash,
        'STAFF',
        'DELETED',
      );

      const wrongPassword = answer(await login(STAFF_EMAIL, WRONG_PASSPHRASE));
      expect(wrongPassword).toMatchObject({ status: 401, body: { code: 'INVALID_CREDENTIALS' } });
      for (const email of [
        'fixture-unknown@kd.example',
        'fixture-locked@kd.example',
        'fixture-invited@kd.example',
        'fixture-customer@kd.example',
        'fixture-deleted@kd.example',
      ]) {
        const response = await login(email, PASSPHRASE);
        expect(answer(response), email).toEqual(wrongPassword);
        expect(setCookieOf(response), email).toBeUndefined();
      }

      // Only the real wrong password was counted; a locked account is not counted further.
      const counts = await query<{ id: string; failed_login_count: number }>(
        'SELECT id, failed_login_count FROM public.users ORDER BY id',
      );
      expect(counts.filter((row) => row.failed_login_count > 0)).toEqual([
        { id: STAFF_ID, failed_login_count: 1 },
      ]);
      expect(await tokenRows()).toEqual([]);
      // Staff emails are audited without a password or the email typed; unknown and customer are not.
      const audits = await query<{ entity_id: string; diff: unknown; actor_user_id: unknown }>(
        `SELECT entity_id, diff, actor_user_id FROM public.audit_logs
          WHERE action = 'auth.login_failed' ORDER BY entity_id`,
      );
      expect(audits).toEqual([
        {
          entity_id: STAFF_ID,
          diff: { reason: 'WRONG_PASSWORD', failedLoginCount: 1 },
          actor_user_id: null,
        },
        { entity_id: INVITED_ID, diff: { reason: 'NOT_ACTIVE' }, actor_user_id: null },
        { entity_id: LOCKED_ID, diff: { reason: 'LOCKED' }, actor_user_id: null },
        {
          entity_id: '01930000-0000-7000-8000-000000000f08',
          diff: { reason: 'NOT_ACTIVE' },
          actor_user_id: null,
        },
      ]);
      const allAudit = JSON.stringify(await query('SELECT * FROM public.audit_logs'));
      expect(allAudit).not.toContain(PASSPHRASE);
      expect(allAudit).not.toContain(WRONG_PASSPHRASE);
      expect(allAudit).not.toContain('@kd.example');
    });

    it('answers ACCOUNT_SUSPENDED only with the right password', async () => {
      await insertUser(SUSPENDED_ID, STAFF_EMAIL, currentHash, 'STAFF', 'SUSPENDED');

      const wrong = await login(STAFF_EMAIL, WRONG_PASSPHRASE);
      expect(wrong.status).toBe(401);
      expect(wrong.problem?.code).toBe('INVALID_CREDENTIALS');

      const right = await login(STAFF_EMAIL, PASSPHRASE);
      expect(right.status).toBe(403);
      expect(right.problem?.code).toBe('ACCOUNT_SUSPENDED');
      expect(setCookieOf(right)).toBeUndefined();
      expect(await tokenRows()).toEqual([]);
    });

    it('locks after five failures, refuses the right password while locked, then recovers', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, currentHash);
      const threshold = LOCKOUT_THRESHOLD.staff;
      expect(threshold).toBe(5);

      const answers: unknown[] = [];
      for (let attempt = 1; attempt <= threshold; attempt += 1) {
        answers.push(answer(await login(STAFF_EMAIL, WRONG_PASSPHRASE)));
      }
      // The locking failure answers exactly like the others: no unlock time, no attempts left.
      expect(new Set(answers.map((value) => JSON.stringify(value))).size).toBe(1);

      const [locked] = await query<{ failed_login_count: number; locked_until: Date | null }>(
        'SELECT failed_login_count, locked_until FROM public.users',
      );
      expect(locked).toEqual({
        failed_login_count: threshold,
        locked_until: new Date(new Date(NOW).getTime() + LOCKOUT_BASE_MS),
      });
      const lockAudit = await query<Record<string, unknown>>(
        `SELECT actor_user_id, entity_id, diff FROM public.audit_logs
          WHERE action = 'auth.account_locked'`,
      );
      expect(lockAudit).toEqual([
        {
          actor_user_id: null,
          entity_id: STAFF_ID,
          diff: {
            failedLoginCount: threshold,
            lockedUntil: new Date(new Date(NOW).getTime() + LOCKOUT_BASE_MS).toISOString(),
          },
        },
      ]);

      const whileLocked = await login(STAFF_EMAIL, PASSPHRASE);
      expect(answer(whileLocked)).toEqual(answers[0]);

      clock.advance(LOCKOUT_BASE_MS + SECOND);
      const after = await login(STAFF_EMAIL, PASSPHRASE);
      expect(after.status).toBe(200);
      const [cleared] = await query<{ failed_login_count: number; locked_until: Date | null }>(
        'SELECT failed_login_count, locked_until FROM public.users',
      );
      expect(cleared).toEqual({ failed_login_count: 0, locked_until: null });
    });

    it.each([
      ['an enrolled MANAGER', MANAGER_ID, 'MANAGER', true, MFA_CHALLENGE_TOKEN_TYPE],
      ['an ADMIN who never enrolled', ADMIN_ID, 'ADMIN', false, MFA_ENROLMENT_TOKEN_TYPE],
    ] as const)(
      'answers MFA_REQUIRED and sets no cookie for %s',
      async (_case, id, role, enrolled, type) => {
        await insertUser(id, STAFF_EMAIL, currentHash, role);
        if (enrolled) {
          await query(
            `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, enabled_at)
             VALUES ($1, $2, $3)`,
            [id, FAKE_SECRET, '2026-10-01T00:00:00Z'],
          );
        }

        const response = await login(STAFF_EMAIL, PASSPHRASE);

        expect(response.status).toBe(403);
        expect(response.problem?.code).toBe('MFA_REQUIRED');
        expect(response.body).toMatchObject({
          mfaToken: expect.any(String),
          mfaEnrolled: enrolled,
        });
        const mfaToken = (response.body as { mfaToken: string }).mfaToken;
        expect(decodeProtectedHeader(mfaToken).typ).toBe(type);
        expect(setCookieOf(response)).toBeUndefined();
        expect(await tokenRows()).toEqual([]);

        // The MFA token is not an access token.
        const asBearer = await client.get('/api/v1/me', {
          headers: { Authorization: `Bearer ${mfaToken}` },
        });
        expect(asBearer.status).toBe(401);

        // last_login_at and the counters wait for the second factor (A3-T2).
        const [user] = await query<{ last_login_at: Date | null }>(
          'SELECT last_login_at FROM public.users',
        );
        expect(user?.last_login_at).toBeNull();
      },
    );

    it.each([
      ['no X-Client', { Origin: ADMIN_ORIGIN }],
      ['no Origin', { 'X-Client': 'admin-web' }],
      ['a foreign Origin', { 'X-Client': 'admin-web', Origin: 'https://evil.example' }],
    ])(
      'answers FORBIDDEN to a login with %s, before any credential check',
      async (_case, headers) => {
        await insertUser(STAFF_ID, STAFF_EMAIL, currentHash);

        const response = await login(STAFF_EMAIL, WRONG_PASSPHRASE, headers);
        expect(response.status).toBe(403);
        expect(response.problem?.code).toBe('FORBIDDEN');

        const [user] = await query<{ failed_login_count: number }>(
          'SELECT failed_login_count FROM public.users',
        );
        expect(user?.failed_login_count).toBe(0);
      },
    );
  });

  describe('POST /admin/auth/refresh', () => {
    beforeEach(async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, currentHash);
    });

    it.each([
      ['without X-Client', { Origin: ADMIN_ORIGIN }],
      ['without Origin', { 'X-Client': 'admin-web' }],
      ['with a foreign Origin', { 'X-Client': 'admin-web', Origin: 'https://evil.example' }],
      ['with Origin null', { 'X-Client': 'admin-web', Origin: 'null' }],
    ])('answers FORBIDDEN %s and does not consume the token', async (_case, headers) => {
      const { cookie } = await signedIn();

      const response = await refresh(cookie, headers);
      expect(response.status).toBe(403);
      expect(response.problem?.code).toBe('FORBIDDEN');
      expect(await tokenRows()).toEqual([
        expect.objectContaining({ used_at: null, revoked_at: null }),
      ]);
    });

    it('rotates: a new cookie in the same family, the old token used', async () => {
      const { cookie, body } = await signedIn();

      const response = await refresh(cookie);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 900,
        user: body.user,
      });
      const next = cookiePairOf(response);
      expect(next).not.toBe(cookie);
      expect(setCookieOf(response)).toContain(`Path=${COOKIE_PATH}; Max-Age=${DAY_SECONDS};`);

      const rows = await tokenRows();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.family_id)).size).toBe(1);
      expect(rows[0]?.used_at).toEqual(new Date(NOW));
      expect(rows[1]?.used_at).toBeNull();
    });

    it('returns the same successor inside the grace window', async () => {
      const { cookie } = await signedIn();
      const first = await refresh(cookie);

      clock.advance(REFRESH_GRACE_WINDOW_MS / 2);
      const again = await refresh(cookie);

      expect(again.status).toBe(200);
      expect(cookiePairOf(again)).toBe(cookiePairOf(first));
      expect((await tokenRows()).every((row) => row.revoked_at === null)).toBe(true);
    });

    it('treats a re-presentation after the window as reuse: family revoked, audited, cookie cleared', async () => {
      const { cookie } = await signedIn();
      const first = await refresh(cookie);

      clock.advance(REFRESH_GRACE_WINDOW_MS + SECOND);
      const reused = await refresh(cookie);
      expect(reused.status).toBe(401);
      expect(reused.problem?.code).toBe('UNAUTHENTICATED');
      expectCleared(reused);

      const successor = await refresh(cookiePairOf(first));
      expect(successor.status).toBe(401);
      expect((await tokenRows()).every((row) => row.revoked_at !== null)).toBe(true);
      expect(await auditActions()).toContainEqual({
        action: 'auth.refresh_reuse',
        actor_user_id: null,
      });
    });

    it('answers UNAUTHENTICATED and clears the cookie without one, or with an unknown token', async () => {
      for (const cookie of [undefined, 'kd_refresh=kdFixtureUnknownToken', 'theme=dark']) {
        const response = await refresh(cookie);
        expect(response.status, cookie).toBe(401);
        expect(response.problem?.code).toBe('UNAUTHENTICATED');
        expectCleared(response);
      }
    });

    it('refuses a customer token without consuming it', async () => {
      await insertUser(CUSTOMER_ID, 'fixture-customer@kd.example', currentHash, 'CUSTOMER');
      const customer = await testApp.app.get(RefreshTokenService).issue(CUSTOMER_ID);

      const response = await refresh(`kd_refresh=${customer.refreshToken}`);
      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      const rows = await query<TokenRow>(
        'SELECT family_id, used_at, revoked_at FROM public.refresh_tokens WHERE user_id = $1',
        [CUSTOMER_ID],
      );
      expect(rows).toEqual([expect.objectContaining({ used_at: null, revoked_at: null })]);
    });

    it('refuses a suspended staff member', async () => {
      const { cookie } = await signedIn();
      await query(`UPDATE public.users SET status = 'SUSPENDED' WHERE id = $1`, [STAFF_ID]);

      const response = await refresh(cookie);
      expect(response.status).toBe(401);
      expectCleared(response);
    });
  });

  describe('POST /admin/auth/logout', () => {
    beforeEach(async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, currentHash);
    });

    it('revokes the family, clears the cookie with the same path and audits it', async () => {
      const { cookie } = await signedIn();
      const other = await signedIn();

      const response = await logout(cookie);
      expect(response.status).toBe(204);
      expectCleared(response);

      expect((await refresh(cookie)).status).toBe(401);
      expect((await refresh(other.cookie)).status).toBe(200);
      const actions = await auditActions();
      expect(actions.filter((row) => row.action === 'auth.logout')).toEqual([
        { action: 'auth.logout', actor_user_id: STAFF_ID },
      ]);
    });

    it('answers 204 and clears the cookie without one, or with an unknown token', async () => {
      for (const cookie of [undefined, 'kd_refresh=kdFixtureUnknownToken']) {
        const response = await logout(cookie);
        expect(response.status).toBe(204);
        expectCleared(response);
      }
      expect(await auditActions()).toEqual([]);
    });

    it('answers FORBIDDEN without the CSRF headers and keeps the session', async () => {
      const { cookie } = await signedIn();

      const response = await logout(cookie, { Origin: ADMIN_ORIGIN });
      expect(response.status).toBe(403);
      expect(response.problem?.code).toBe('FORBIDDEN');
      expect((await refresh(cookie)).status).toBe(200);
    });
  });
});
