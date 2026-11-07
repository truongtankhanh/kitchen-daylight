import { randomBytes } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { SecretCipher } from '../../src/modules/auth/mfa/secret-cipher.js';
import { REFRESH_GRACE_WINDOW_MS } from '../../src/modules/auth/refresh-grace.js';
import { MailService } from '../../src/modules/mail/mail.service.js';
import type { MailMessage } from '../../src/modules/mail/ports/mail.port.js';
import { LOCKOUT_THRESHOLD } from '../../src/modules/users/lockout.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A3-T6, brief E17 (login audit events) and testing-strategy "Auth and sessions": each staff auth
// path runs once and leaves exactly its `audit_logs` rows, no duplicate, and no `diff` or
// `entity_label` holds a password, code, token, secret or the email typed (an unknown email leaves
// no row at all). As `kd_app`, against real PostgreSQL; mail is recorded, not sent. Each test boots
// its own app, so the throttle counters start empty. Fictional data only; secrets are random.

const NOW = '2026-11-07T03:00:10.000Z';
const SECOND = 1000;
const STEP_MS = 30 * SECOND;

const ADMIN_ORIGIN = 'http://localhost:4200';
const ADMIN_HEADERS = { 'X-Client': 'admin-web', Origin: ADMIN_ORIGIN } as const;

const STAFF_ID = '01930000-0000-7000-8000-000000001701';
const MANAGER_ID = '01930000-0000-7000-8000-000000001702';
const ADMIN_ID = '01930000-0000-7000-8000-000000001703';
const SUSPENDED_ID = '01930000-0000-7000-8000-000000001704';
const INVITED_ID = '01930000-0000-7000-8000-000000001705';
const SESSION_ID = '01930000-0000-7000-8000-0000000017a1';

const STAFF_EMAIL = 'fixture-audit-staff@kd.example';
const MANAGER_EMAIL = 'fixture-audit-manager@kd.example';
const ADMIN_EMAIL = 'fixture-audit-admin@kd.example';
const SUSPENDED_EMAIL = 'fixture-audit-suspended@kd.example';
const INVITED_EMAIL = 'fixture-audit-invited@kd.example';
const UNKNOWN_EMAIL = 'fixture-audit-unknown@kd.example';

/** Fictional fixture texts, at least 12 characters; never real credentials. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';
const WRONG_PASSPHRASE = 'kd-fixture-wrong-passphrase';
const NEW_PASSPHRASE = 'kd-fixture-new-staff-passphrase';

const TOKEN_IN_MAIL = /#token=([A-Za-z0-9_-]{43})$/mu;

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Nhân viên Mẫu', 'vi', $4, $5)`;

interface AuditRow {
  action: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  diff: Record<string, unknown>;
}

describe('staff login audit events (kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;
  let sent: MailMessage[];
  const secrets = new Map<string, Buffer>();
  /** Every value typed or received during a test; none may reach an audit row. */
  let sensitive: string[];

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
    secrets.clear();
    sensitive = [
      PASSPHRASE,
      WRONG_PASSPHRASE,
      NEW_PASSPHRASE,
      STAFF_EMAIL,
      MANAGER_EMAIL,
      ADMIN_EMAIL,
      SUSPENDED_EMAIL,
      INVITED_EMAIL,
      UNKNOWN_EMAIL,
    ];
    await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
    await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER');
    await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
    await insertUser(SUSPENDED_ID, SUSPENDED_EMAIL, 'STAFF', 'SUSPENDED');
    await insertUser(INVITED_ID, INVITED_EMAIL, 'STAFF', 'INVITED', null);
    await enrol(MANAGER_ID);
    await enrol(ADMIN_ID);
  });

  afterEach(async () => {
    // Checked after every path: no secret in any row the path wrote.
    const rows = await auditRows();
    const written = JSON.stringify(
      rows.map((row) => ({ diff: row.diff, label: row.entity_label })),
    );
    for (const value of sensitive) {
      expect(written, 'an audit row holds a secret or a typed email').not.toContain(value);
    }
    expect(rows.every((row) => row.entity_label === null || !row.entity_label.includes('@'))).toBe(
      true,
    );
    vi.restoreAllMocks();
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(
    id: string,
    email: string,
    role: string,
    status = 'ACTIVE',
    hash: string | null = passwordHash,
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, hash, role, status]);
  }

  async function enrol(id: string): Promise<void> {
    const secret = randomBytes(20);
    const encrypted = testApp.app.get(SecretCipher).encrypt(secret, id);
    await query(
      `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, enabled_at)
       VALUES ($1, $2, $3)`,
      [id, encrypted, '2026-10-01T00:00:00Z'],
    );
    secrets.set(id, secret);
    sensitive.push(encrypted, secret.toString('hex'), secret.toString('base64'));
  }

  function codeOf(id: string): string {
    const secret = secrets.get(id);
    if (secret === undefined) {
      throw new Error('No secret for this user.');
    }
    const code = TOTP.generate({
      secret: new Secret({ buffer: Uint8Array.from(secret).buffer }),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      timestamp: clock.now().getTime(),
    });
    sensitive.push(code);
    return code;
  }

  function auditRows(): Promise<AuditRow[]> {
    return query<AuditRow>(
      `SELECT action, actor_user_id, entity_type::text AS entity_type, entity_id, entity_label, diff
         FROM public.audit_logs ORDER BY created_at, id`,
    );
  }

  /** The rows as `[action, entity_id, actor_user_id]`, in order. */
  async function trail(): Promise<[string, string, string | null][]> {
    return (await auditRows()).map((row) => [row.action, row.entity_id, row.actor_user_id]);
  }

  function login(email: string, password: string): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/login', { email, password }, { headers: ADMIN_HEADERS });
  }

  /** `kd_refresh=<value>` from the `Set-Cookie` of a response; remembered as sensitive. */
  function cookieOf(response: TestResponse): string {
    const pair = response.headers.getSetCookie()[0]?.split('; ')[0] ?? '';
    expect(pair).toMatch(/^kd_refresh=[A-Za-z0-9_-]{43}$/);
    sensitive.push(pair.slice('kd_refresh='.length));
    return pair;
  }

  async function staffSignedIn(): Promise<string> {
    const response = await login(STAFF_EMAIL, PASSPHRASE);
    expect(response.status).toBe(200);
    sensitive.push((response.body as { accessToken: string }).accessToken);
    return cookieOf(response);
  }

  function withCookie(path: string, cookie: string): Promise<TestResponse> {
    return client.post(path, undefined, { headers: { ...ADMIN_HEADERS, Cookie: cookie } });
  }

  async function mfaChallenge(email: string): Promise<string> {
    const response = await login(email, PASSPHRASE);
    expect(response.problem?.code).toBe('MFA_REQUIRED');
    const challenge = (response.body as { mfaToken: string }).mfaToken;
    sensitive.push(challenge);
    return challenge;
  }

  async function linkFor(email: string): Promise<string> {
    const response = await client.post(
      '/api/v1/admin/auth/password/forgot',
      { email },
      { headers: ADMIN_HEADERS },
    );
    expect(response.status).toBe(202);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    const token = TOKEN_IN_MAIL.exec(sent[0]?.text ?? '')?.[1] ?? '';
    expect(token).toHaveLength(43);
    sensitive.push(token);
    return token;
  }

  describe('sign-in', () => {
    it('success: auth.login_succeeded, actor the user', async () => {
      await staffSignedIn();

      expect(await trail()).toEqual([['auth.login_succeeded', STAFF_ID, STAFF_ID]]);
    });

    it('failure of a staff email: auth.login_failed, no actor, reason and count only', async () => {
      expect((await login(STAFF_EMAIL, WRONG_PASSPHRASE)).status).toBe(401);

      const rows = await auditRows();
      expect(rows.map((row) => [row.action, row.entity_id, row.actor_user_id])).toEqual([
        ['auth.login_failed', STAFF_ID, null],
      ]);
      expect(rows[0]?.diff).toEqual({ reason: 'WRONG_PASSWORD', failedLoginCount: 1 });
      expect(rows[0]?.entity_label).toBeNull();
    });

    it('an unknown email typed: no row at all', async () => {
      expect((await login(UNKNOWN_EMAIL, PASSPHRASE)).status).toBe(401);

      expect(await auditRows()).toEqual([]);
    });

    it('the right password of a suspended account: auth.login_failed, reason SUSPENDED', async () => {
      expect((await login(SUSPENDED_EMAIL, PASSPHRASE)).problem?.code).toBe('ACCOUNT_SUSPENDED');

      const rows = await auditRows();
      expect(rows.map((row) => [row.action, row.entity_id, row.actor_user_id])).toEqual([
        ['auth.login_failed', SUSPENDED_ID, null],
      ]);
      expect(rows[0]?.diff).toEqual({ reason: 'SUSPENDED' });
    });

    it('temporary lock: one auth.account_locked with the failure that caused it', async () => {
      for (let attempt = 1; attempt <= LOCKOUT_THRESHOLD.staff; attempt += 1) {
        expect((await login(STAFF_EMAIL, WRONG_PASSPHRASE)).status).toBe(401);
      }

      const actions = (await trail()).map(([action]) => action);
      expect(actions).toEqual([
        ...Array<string>(LOCKOUT_THRESHOLD.staff).fill('auth.login_failed'),
        'auth.account_locked',
      ]);
      const locked = (await auditRows()).at(-1);
      expect(Object.keys(locked?.diff ?? {}).sort()).toEqual(['failedLoginCount', 'lockedUntil']);
    });
  });

  describe('second step', () => {
    it('requested: auth.mfa_requested after the right password, no actor', async () => {
      await mfaChallenge(MANAGER_EMAIL);

      const rows = await auditRows();
      expect(rows.map((row) => [row.action, row.entity_id, row.actor_user_id])).toEqual([
        ['auth.mfa_requested', MANAGER_ID, null],
      ]);
      expect(rows[0]?.diff).toEqual({ enrolled: true });
    });

    it('code success: auth.mfa_succeeded then auth.login_succeeded, once each', async () => {
      const challenge = await mfaChallenge(MANAGER_EMAIL);
      const response = await client.post(
        '/api/v1/admin/auth/mfa/verify',
        { challenge, code: codeOf(MANAGER_ID) },
        { headers: ADMIN_HEADERS },
      );
      expect(response.status).toBe(200);
      cookieOf(response);
      sensitive.push((response.body as { accessToken: string }).accessToken);

      expect(await trail()).toEqual([
        ['auth.mfa_requested', MANAGER_ID, null],
        ['auth.mfa_succeeded', MANAGER_ID, MANAGER_ID],
        ['auth.login_succeeded', MANAGER_ID, MANAGER_ID],
      ]);
    });

    it('code failure: auth.mfa_failed, counted', async () => {
      const challenge = await mfaChallenge(MANAGER_EMAIL);
      const response = await client.post(
        '/api/v1/admin/auth/mfa/verify',
        { challenge, code: '000000' },
        { headers: ADMIN_HEADERS },
      );
      expect(response.problem?.code).toBe('CODE_INVALID');

      const rows = await auditRows();
      expect(rows.map((row) => [row.action, row.entity_id, row.actor_user_id])).toEqual([
        ['auth.mfa_requested', MANAGER_ID, null],
        ['auth.mfa_failed', MANAGER_ID, null],
      ]);
      expect(rows[1]?.diff).toEqual({ method: 'TOTP', reason: 'WRONG_CODE', failedLoginCount: 1 });
    });
  });

  describe('password set', () => {
    it('invitation: auth.password_reset_requested, then auth.password_set by the user', async () => {
      const token = await linkFor(INVITED_EMAIL);
      const set = await client.post(
        '/api/v1/admin/auth/password/set',
        { token, password: NEW_PASSPHRASE },
        { headers: ADMIN_HEADERS },
      );
      expect(set.status).toBe(204);

      expect(await trail()).toEqual([
        ['auth.password_reset_requested', INVITED_ID, null],
        ['auth.password_set', INVITED_ID, INVITED_ID],
      ]);
    });

    it('reset: auth.password_reset_requested, then auth.password_reset_completed', async () => {
      const token = await linkFor(STAFF_EMAIL);
      const set = await client.post(
        '/api/v1/admin/auth/password/set',
        { token, password: NEW_PASSPHRASE },
        { headers: ADMIN_HEADERS },
      );
      expect(set.status).toBe(204);

      expect(await trail()).toEqual([
        ['auth.password_reset_requested', STAFF_ID, null],
        ['auth.password_reset_completed', STAFF_ID, STAFF_ID],
      ]);
    });

    it('an unknown email asking for a link: no row', async () => {
      const response = await client.post(
        '/api/v1/admin/auth/password/forgot',
        { email: UNKNOWN_EMAIL },
        { headers: ADMIN_HEADERS },
      );
      expect(response.status).toBe(202);

      expect(await auditRows()).toEqual([]);
    });
  });

  describe('session', () => {
    it('logout: auth.logout, actor the token owner', async () => {
      const cookie = await staffSignedIn();
      expect((await withCookie('/api/v1/admin/auth/logout', cookie)).status).toBe(204);

      expect(await trail()).toEqual([
        ['auth.login_succeeded', STAFF_ID, STAFF_ID],
        ['auth.logout', STAFF_ID, STAFF_ID],
      ]);
    });

    it('refresh-token reuse: one auth.refresh_reuse; a normal refresh writes nothing', async () => {
      const first = await staffSignedIn();
      const rotated = await withCookie('/api/v1/admin/auth/refresh', first);
      expect(rotated.status).toBe(200);
      cookieOf(rotated);

      clock.advance(REFRESH_GRACE_WINDOW_MS + SECOND);
      expect((await withCookie('/api/v1/admin/auth/refresh', first)).status).toBe(401);

      expect((await trail()).map(([action, entityId]) => [action, entityId])).toEqual([
        ['auth.login_succeeded', STAFF_ID],
        ['auth.refresh_reuse', STAFF_ID],
      ]);
    });
  });

  describe('step-up', () => {
    async function stepUp(code: string): Promise<TestResponse> {
      const { token } = await testApp.app
        .get(AccessTokenService)
        .sign({ userId: ADMIN_ID, role: 'ADMIN', sessionId: SESSION_ID });
      sensitive.push(token);
      return client.post(
        '/api/v1/admin/auth/step-up',
        { code, purpose: 'settings.payment' },
        { headers: { ...ADMIN_HEADERS, authorization: `Bearer ${token}` } },
      );
    }

    it('success: auth.step_up_succeeded, actor the admin', async () => {
      const response = await stepUp(codeOf(ADMIN_ID));
      expect(response.status).toBe(200);
      sensitive.push((response.body as { stepUpToken: string }).stepUpToken);

      expect(await trail()).toEqual([['auth.step_up_succeeded', ADMIN_ID, ADMIN_ID]]);
    });

    it('failure: auth.step_up_failed, actor the admin, counted', async () => {
      expect((await stepUp('000000')).problem?.code).toBe('CODE_INVALID');

      const rows = await auditRows();
      expect(rows.map((row) => [row.action, row.entity_id, row.actor_user_id])).toEqual([
        ['auth.step_up_failed', ADMIN_ID, ADMIN_ID],
      ]);
      expect(rows[0]?.diff).toEqual({
        purpose: 'settings.payment',
        method: 'TOTP',
        reason: 'WRONG_CODE',
        failedLoginCount: 1,
      });
    });

    it('the next code after a step-up is accepted (one step per code)', async () => {
      expect((await stepUp(codeOf(ADMIN_ID))).status).toBe(200);
      clock.advance(STEP_MS);
      expect((await stepUp(codeOf(ADMIN_ID))).status).toBe(200);

      expect((await trail()).map(([action]) => action)).toEqual([
        'auth.step_up_succeeded',
        'auth.step_up_succeeded',
      ]);
    });
  });
});
