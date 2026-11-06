import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { REFRESH_GRACE_WINDOW_MS } from '../../src/modules/auth/refresh-grace.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service.js';
import { LegalService } from '../../src/modules/legal/legal.service.js';
import { LOCKOUT_BASE_MS, LOCKOUT_THRESHOLD } from '../../src/modules/users/lockout.js';
import {
  PASSWORD_HASH_PARAMETERS,
  PasswordHasher,
} from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A2-T1, testing-strategy "Auth and sessions": the customer transport end to end, as `kd_app`,
// against real PostgreSQL. Each test boots its own app, so the in-process throttle counters
// (register: 10 per hour per IP) and the grace map start empty. Fictional data only.

const NOW = '2026-11-06T03:00:00.000Z';
const SECOND = 1000;

const OLD_TERMS_ID = '01930000-0000-7000-8000-000000000c01';
const TERMS_ID = '01930000-0000-7000-8000-000000000c02';
const PRIVACY_ID = '01930000-0000-7000-8000-000000000c03';
const EN_TERMS_ID = '01930000-0000-7000-8000-000000000c04';
const FUTURE_PRIVACY_ID = '01930000-0000-7000-8000-000000000c05';

const STAFF_ID = '01930000-0000-7000-8000-000000000b01';
const SEEDED_CUSTOMER_ID = '01930000-0000-7000-8000-000000000b02';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';
const WRONG_PASSPHRASE = 'kd-wrong-passphrase';

const SEED_DOCUMENTS_SQL = `INSERT INTO public.consent_documents
  (id, type, version, locale, content_sha256, published_at) VALUES
  ($1, 'TERMS_OF_SERVICE', '1', 'vi', repeat('a', 64), '2026-01-01T00:00:00Z'),
  ($2, 'TERMS_OF_SERVICE', '2', 'vi', repeat('b', 64), '2026-10-01T00:00:00Z'),
  ($3, 'PRIVACY_POLICY',   '1', 'vi', repeat('c', 64), '2026-10-01T00:00:00Z'),
  ($4, 'TERMS_OF_SERVICE', '3', 'en', repeat('d', 64), '2026-10-15T00:00:00Z'),
  ($5, 'PRIVACY_POLICY',   '2', 'vi', repeat('e', 64), '2027-01-01T00:00:00Z')`;

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Người dùng mẫu', 'vi', $4, $5)`;

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; displayName: string; emailVerifiedAt: string | null };
}

interface TokenRow {
  family_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
  device_label: string;
}

describe('customer auth endpoints (kd_app, real PostgreSQL)', () => {
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
    await testApp.dataSource.query(SEED_DOCUMENTS_SQL, [
      OLD_TERMS_ID,
      TERMS_ID,
      PRIVACY_ID,
      EN_TERMS_ID,
      FUTURE_PRIVACY_ID,
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function register(
    overrides: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return client.post(
      '/api/v1/auth/register',
      {
        email: 'fixture-a@kd.example',
        password: PASSPHRASE,
        displayName: 'Người dùng mẫu',
        acceptedDocumentIds: [TERMS_ID, PRIVACY_ID],
        ...overrides,
      },
      { headers },
    );
  }

  function login(email: string, password: string): Promise<TestResponse> {
    return client.post('/api/v1/auth/login', { email, password });
  }

  function refresh(refreshToken: string): Promise<TestResponse> {
    return client.post('/api/v1/auth/refresh', { refreshToken });
  }

  async function registered(): Promise<Session> {
    const response = await register();
    expect(response.status).toBe(201);
    return response.body as Session;
  }

  function insertUser(
    id: string,
    email: string,
    passwordHash: string | null,
    role = 'CUSTOMER',
    status = 'ACTIVE',
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, passwordHash, role, status]);
  }

  function tokenRows(): Promise<TokenRow[]> {
    return query<TokenRow>(
      'SELECT family_id, used_at, revoked_at, device_label FROM public.refresh_tokens ORDER BY id',
    );
  }

  /** Status and body: everything a client can compare between two answers. */
  function answer(response: TestResponse): unknown {
    return { status: response.status, body: response.body };
  }

  describe('POST /auth/register', () => {
    it('writes the user, one consent row per current document and the first session', async () => {
      const response = await register(
        { email: '  Fixture-A@KD.example ', phone: '090 123 4567', deviceLabel: 'Điện thoại mẫu' },
        { 'X-Client': 'mobile-ios', 'X-App-Version': '1.4.0' },
      );

      expect(response.status).toBe(201);
      const session = response.body as Session;
      expect(session).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 900,
        user: {
          id: expect.any(String),
          email: 'fixture-a@kd.example',
          displayName: 'Người dùng mẫu',
          emailVerifiedAt: null,
        },
      });

      const users = await query<Record<string, unknown>>(
        'SELECT id, email, role, status, phone, locale, email_verified_at FROM public.users',
      );
      expect(users).toEqual([
        {
          id: session.user.id,
          email: 'fixture-a@kd.example',
          role: 'CUSTOMER',
          status: 'ACTIVE',
          phone: '+84901234567',
          locale: 'vi',
          email_verified_at: null,
        },
      ]);

      const consents = await query<Record<string, unknown>>(
        `SELECT user_id, document_id, action, client, app_version, occurred_at
           FROM public.user_consents ORDER BY document_id`,
      );
      expect(consents).toEqual(
        [TERMS_ID, PRIVACY_ID].sort().map((documentId) => ({
          user_id: session.user.id,
          document_id: documentId,
          action: 'GRANTED',
          client: 'MOBILE',
          app_version: '1.4.0',
          occurred_at: new Date(NOW),
        })),
      );

      const tokens = await tokenRows();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.device_label).toBe('Điện thoại mẫu');

      // The access token is valid at once.
      const logoutAll = await client.post('/api/v1/auth/logout-all', undefined, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      expect(logoutAll.status).toBe(204);
    });

    it('records client API and no app version without the client headers', async () => {
      await registered();
      const consents = await query<{ client: string; app_version: string | null }>(
        'SELECT client, app_version FROM public.user_consents',
      );
      expect(consents).toEqual([
        { client: 'API', app_version: null },
        { client: 'API', app_version: null },
      ]);
      expect((await tokenRows())[0]?.device_label).toBe('unknown');
    });

    it('rolls the user back when a later step of the transaction fails', async () => {
      vi.spyOn(testApp.app.get(LegalService), 'recordConsents').mockRejectedValueOnce(
        new Error('fixture failure'),
      );
      const response = await register();
      expect(response.status).toBe(500);
      expect(await query('SELECT id FROM public.users')).toEqual([]);
      expect(await query('SELECT id FROM public.refresh_tokens')).toEqual([]);
    });

    it.each([
      ['a missing document', [TERMS_ID]],
      ['a stale document', [OLD_TERMS_ID, PRIVACY_ID]],
      ['a document of another locale', [EN_TERMS_ID, PRIVACY_ID]],
      ['a document not yet published', [TERMS_ID, FUTURE_PRIVACY_ID]],
      ['an unknown id', [TERMS_ID, '01930000-0000-7000-8000-0000000000ff']],
    ])('refuses %s on acceptedDocumentIds and writes nothing', async (_case, ids) => {
      const response = await register({ acceptedDocumentIds: ids });
      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
      expect(response.problem?.errors).toEqual([
        expect.objectContaining({ field: 'acceptedDocumentIds', code: 'INVALID' }),
      ]);
      expect(await query('SELECT id FROM public.users')).toEqual([]);
      expect(await query('SELECT id FROM public.user_consents')).toEqual([]);
    });

    it('answers 409 ALREADY_EXISTS with no detail for a taken email, in any case', async () => {
      await registered();
      const response = await register({ email: 'FIXTURE-A@kd.example' });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        type: 'about:blank',
        title: expect.any(String),
        status: 409,
        code: 'ALREADY_EXISTS',
      });
      expect(await query('SELECT id FROM public.users')).toHaveLength(1);
      expect(await query('SELECT id FROM public.user_consents')).toHaveLength(2);
      expect(await query('SELECT id FROM public.refresh_tokens')).toHaveLength(1);
    });

    it('refuses a landline with INVALID_PHONE', async () => {
      const response = await register({ phone: '028 1234 5678' });
      expect(response.status).toBe(400);
      expect(response.problem?.errors).toEqual([
        expect.objectContaining({ field: 'phone', code: 'INVALID_PHONE' }),
      ]);
    });

    it('validates the body: display name over 60, short password, unknown property', async () => {
      const response = await register({
        displayName: 'a'.repeat(61),
        password: 'short',
        role: 'ADMIN',
      });
      expect(response.status).toBe(400);
      const fields = response.problem?.errors?.map((error) => [error.field, error.code]);
      expect(fields).toEqual(
        expect.arrayContaining([
          ['displayName', 'TOO_LONG'],
          ['role', 'INVALID'],
        ]),
      );
      expect(await query('SELECT id FROM public.users')).toEqual([]);
    });
  });

  describe('POST /auth/login', () => {
    it('signs in an unverified customer and opens a new family', async () => {
      const first = await registered();
      const response = await login('Fixture-A@KD.example', PASSPHRASE);

      expect(response.status).toBe(200);
      const session = response.body as Session;
      expect(session.user).toEqual(first.user);
      expect(session.refreshToken).not.toBe(first.refreshToken);
      const families = new Set((await tokenRows()).map((row) => row.family_id));
      expect(families.size).toBe(2);
      const [user] = await query<{ last_login_at: Date | null }>(
        'SELECT last_login_at FROM public.users',
      );
      expect(user?.last_login_at).toEqual(new Date(NOW));
    });

    it('answers unknown email, wrong password, locked, staff, social-only and deleted alike', async () => {
      await insertUser(SEEDED_CUSTOMER_ID, 'fixture-b@kd.example', currentHash);
      await insertUser(STAFF_ID, 'fixture-staff@kd.example', currentHash, 'STAFF');
      await insertUser(
        '01930000-0000-7000-8000-000000000b03',
        'fixture-locked@kd.example',
        currentHash,
      );
      await query(
        `UPDATE public.users SET locked_until = $1::timestamptz + interval '15 minutes'
          WHERE email = 'fixture-locked@kd.example'`,
        [NOW],
      );
      await insertUser('01930000-0000-7000-8000-000000000b04', 'fixture-social@kd.example', null);
      await insertUser(
        '01930000-0000-7000-8000-000000000b05',
        'fixture-deleted@kd.example',
        currentHash,
        'CUSTOMER',
        'DELETED',
      );

      const wrongPassword = answer(await login('fixture-b@kd.example', WRONG_PASSPHRASE));
      expect(wrongPassword).toMatchObject({
        status: 401,
        body: { code: 'INVALID_CREDENTIALS' },
      });
      for (const email of [
        'fixture-unknown@kd.example',
        'fixture-locked@kd.example',
        'fixture-staff@kd.example',
        'fixture-social@kd.example',
        'fixture-deleted@kd.example',
      ]) {
        expect(answer(await login(email, PASSPHRASE)), email).toEqual(wrongPassword);
      }

      // Only the real wrong password was counted; a locked account is not counted further.
      const counts = await query<{ email: string; failed_login_count: number }>(
        'SELECT email, failed_login_count FROM public.users ORDER BY email',
      );
      expect(counts).toEqual(
        expect.arrayContaining([
          { email: 'fixture-b@kd.example', failed_login_count: 1 },
          { email: 'fixture-locked@kd.example', failed_login_count: 0 },
          { email: 'fixture-staff@kd.example', failed_login_count: 0 },
        ]),
      );
      expect(await tokenRows()).toEqual([]);
      // No failure here locked an account: no audit row.
      expect(await query('SELECT id FROM public.audit_logs')).toEqual([]);
    });

    it('answers ACCOUNT_SUSPENDED only with the right password', async () => {
      await insertUser(
        SEEDED_CUSTOMER_ID,
        'fixture-b@kd.example',
        currentHash,
        'CUSTOMER',
        'SUSPENDED',
      );

      const wrong = await login('fixture-b@kd.example', WRONG_PASSPHRASE);
      expect(wrong.status).toBe(401);
      expect(wrong.problem?.code).toBe('INVALID_CREDENTIALS');

      const right = await login('fixture-b@kd.example', PASSPHRASE);
      expect(right.status).toBe(403);
      expect(right.problem?.code).toBe('ACCOUNT_SUSPENDED');
      expect(await tokenRows()).toEqual([]);
    });

    it('locks after the configured failures, refuses the right password while locked, then recovers', async () => {
      await insertUser(SEEDED_CUSTOMER_ID, 'fixture-b@kd.example', currentHash);
      const threshold = LOCKOUT_THRESHOLD.customer;

      for (let attempt = 1; attempt <= threshold; attempt += 1) {
        const response = await login('fixture-b@kd.example', WRONG_PASSPHRASE);
        expect(response.status).toBe(401);
      }
      const [locked] = await query<{ failed_login_count: number; locked_until: Date | null }>(
        'SELECT failed_login_count, locked_until FROM public.users',
      );
      expect(locked).toEqual({
        failed_login_count: threshold,
        locked_until: new Date(new Date(NOW).getTime() + LOCKOUT_BASE_MS),
      });

      // The failure that locked the account is audited once, without an actor, password or email.
      const audits = await query<Record<string, unknown>>(
        `SELECT actor_user_id, action, entity_type, entity_id, entity_label, diff
           FROM public.audit_logs`,
      );
      expect(audits).toEqual([
        {
          actor_user_id: null,
          action: 'auth.account_locked',
          entity_type: 'USER',
          entity_id: SEEDED_CUSTOMER_ID,
          entity_label: null,
          diff: {
            failedLoginCount: threshold,
            lockedUntil: new Date(new Date(NOW).getTime() + LOCKOUT_BASE_MS).toISOString(),
          },
        },
      ]);

      const whileLocked = await login('fixture-b@kd.example', PASSPHRASE);
      expect(whileLocked.status).toBe(401);
      expect(whileLocked.problem?.code).toBe('INVALID_CREDENTIALS');

      clock.advance(LOCKOUT_BASE_MS + SECOND);
      const after = await login('fixture-b@kd.example', PASSPHRASE);
      expect(after.status).toBe(200);
      const [cleared] = await query<{ failed_login_count: number; locked_until: Date | null }>(
        'SELECT failed_login_count, locked_until FROM public.users',
      );
      expect(cleared).toEqual({ failed_login_count: 0, locked_until: null });
      // A locked attempt is not counted or audited again.
      expect(await query('SELECT id FROM public.audit_logs')).toHaveLength(1);
    });

    it('rehashes a password stored with older parameters', async () => {
      const weaker = new PasswordHasher({
        ...PASSWORD_HASH_PARAMETERS,
        memory: 8192,
        passes: 1,
      });
      await insertUser(SEEDED_CUSTOMER_ID, 'fixture-b@kd.example', await weaker.hash(PASSPHRASE));

      expect((await login('fixture-b@kd.example', PASSPHRASE)).status).toBe(200);

      const [row] = await query<{ password_hash: string }>(
        'SELECT password_hash FROM public.users',
      );
      const current = new PasswordHasher();
      expect(current.needsRehash(row?.password_hash ?? '')).toBe(false);
      expect(await current.verify(row?.password_hash ?? '', PASSPHRASE)).toBe(true);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates: a new token in the same family, the old one used', async () => {
      const session = await registered();
      const response = await refresh(session.refreshToken);

      expect(response.status).toBe(200);
      const next = response.body as Session;
      expect(next.refreshToken).not.toBe(session.refreshToken);
      expect(next.user).toEqual(session.user);
      const rows = await tokenRows();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.family_id)).size).toBe(1);
      expect(rows[0]?.used_at).toEqual(new Date(NOW));
      expect(rows[1]?.used_at).toBeNull();
    });

    it('returns the same successor to a re-presentation inside the grace window', async () => {
      const session = await registered();
      const first = await refresh(session.refreshToken);

      clock.advance(REFRESH_GRACE_WINDOW_MS / 2);
      const again = await refresh(session.refreshToken);

      expect(again.status).toBe(200);
      expect((again.body as Session).refreshToken).toBe((first.body as Session).refreshToken);
      expect((await tokenRows()).every((row) => row.revoked_at === null)).toBe(true);
    });

    it('treats a re-presentation after the window as reuse and revokes the family', async () => {
      const session = await registered();
      const first = await refresh(session.refreshToken);

      clock.advance(REFRESH_GRACE_WINDOW_MS + SECOND);
      const reused = await refresh(session.refreshToken);
      expect(reused.status).toBe(401);
      expect(reused.problem?.code).toBe('UNAUTHENTICATED');

      const successor = await refresh((first.body as Session).refreshToken);
      expect(successor.status).toBe(401);
      expect((await tokenRows()).every((row) => row.revoked_at !== null)).toBe(true);
    });

    it('does not revoke on concurrent refreshes of one token', async () => {
      const session = await registered();
      const [a, b] = await Promise.all([
        refresh(session.refreshToken),
        refresh(session.refreshToken),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const successor = (a.body as Session).refreshToken;
      expect((b.body as Session).refreshToken).toBe(successor);
      expect((await refresh(successor)).status).toBe(200);
      expect((await tokenRows()).every((row) => row.revoked_at === null)).toBe(true);
    });

    it('refuses a staff token without consuming it', async () => {
      await insertUser(STAFF_ID, 'fixture-staff@kd.example', currentHash, 'STAFF');
      const staff = await testApp.app.get(RefreshTokenService).issue(STAFF_ID);

      const response = await refresh(staff.refreshToken);
      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      expect(await tokenRows()).toEqual([
        expect.objectContaining({ used_at: null, revoked_at: null }),
      ]);
    });

    it('refuses an unknown token', async () => {
      const response = await refresh('kd-fixture-unknown-token');
      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('POST /auth/logout and /auth/logout-all', () => {
    it('logout revokes the presented family only, without an access token', async () => {
      const first = await registered();
      const second = (await login('fixture-a@kd.example', PASSPHRASE)).body as Session;

      const response = await client.post('/api/v1/auth/logout', {
        refreshToken: first.refreshToken,
      });
      expect(response.status).toBe(204);

      expect((await refresh(first.refreshToken)).status).toBe(401);
      expect((await refresh(second.refreshToken)).status).toBe(200);
    });

    it('logout answers 204 for an unknown token', async () => {
      const response = await client.post('/api/v1/auth/logout', {
        refreshToken: 'kd-fixture-unknown-token',
      });
      expect(response.status).toBe(204);
    });

    it('logout-all revokes every family of the caller', async () => {
      const first = await registered();
      const second = (await login('fixture-a@kd.example', PASSPHRASE)).body as Session;

      const response = await client.post('/api/v1/auth/logout-all', undefined, {
        headers: { Authorization: `Bearer ${second.accessToken}` },
      });
      expect(response.status).toBe(204);

      expect((await refresh(first.refreshToken)).status).toBe(401);
      expect((await refresh(second.refreshToken)).status).toBe(401);
      expect((await tokenRows()).every((row) => row.revoked_at !== null)).toBe(true);
    });

    it('logout-all needs an access token', async () => {
      const response = await client.post('/api/v1/auth/logout-all');
      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });
  });
});
