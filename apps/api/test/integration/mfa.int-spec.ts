import { randomBytes } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { KeySet } from '../../src/modules/auth/key-set.js';
import {
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_ENROLMENT_TOKEN_TYPE,
  signMfaToken,
} from '../../src/modules/auth/mfa/mfa-tokens.js';
import type { MfaTokenType } from '../../src/modules/auth/mfa/mfa-tokens.js';
import { SecretCipher } from '../../src/modules/auth/mfa/secret-cipher.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A3-T2, testing-strategy "MFA recovery" (a recovery code works once) and "Auth and sessions"
// (lockout, identical responses): TOTP enrolment, the second step and recovery codes end to end, as
// `kd_app`, against real PostgreSQL. Each test boots its own app, so the in-process throttle
// counters (`/admin/auth/mfa/verify` and `/me/mfa/*`: 10 per 5 minutes per IP) start empty. TOTP
// codes are computed from the fixed clock. Fictional data only; secrets are random per run.

const NOW = '2026-11-07T03:00:10.000Z';
const STEP_MS = 30_000;

const ADMIN_HEADERS = { 'X-Client': 'admin-web', Origin: 'http://localhost:4200' } as const;

const ADMIN_ID = '01930000-0000-7000-8000-000000000f31';
const MANAGER_ID = '01930000-0000-7000-8000-000000000f32';
const STAFF_ID = '01930000-0000-7000-8000-000000000f33';

const ADMIN_EMAIL = 'fixture-admin@kd.example';
const MANAGER_EMAIL = 'fixture-manager@kd.example';
const STAFF_EMAIL = 'fixture-staff@kd.example';

/** Fictional fixture text, at least 12 characters (staff policy); never a real credential. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';
const WRONG_PASSPHRASE = 'kd-fixture-wrong-passphrase';

/** Fictional recovery codes for a seeded credential (Crockford Base32). */
const RECOVERY_CODES = ['ABCDE-12345', 'FGHJK-67890'] as const;

/** The `mfa_credentials_secret_layout` CHECK of migration 0008. */
const STORED_LAYOUT = /^v1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Quản lý mẫu', 'vi', $4, $5)`;

interface AdminSessionBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; displayName: string; role: string };
}

interface MfaRequired {
  mfaToken: string;
  mfaEnrolled: boolean;
}

describe('staff second factor (kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let recoveryCodeHashes: string[];
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;

  beforeAll(async () => {
    const hasher = new PasswordHasher();
    passwordHash = await hasher.hash(PASSPHRASE);
    recoveryCodeHashes = await Promise.all(
      RECOVERY_CODES.map((code) => hasher.hash(code.replace('-', ''))),
    );
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
    role: string,
    status = 'ACTIVE',
    hash: string | null = passwordHash,
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, hash, role, status]);
  }

  /** An enrolled credential with a random secret and the two fixture recovery codes. */
  async function enrolled(id: string): Promise<Buffer> {
    const secret = randomBytes(20);
    const encrypted = testApp.app.get(SecretCipher).encrypt(secret, id);
    await query(
      `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, enabled_at, recovery_code_hashes)
       VALUES ($1, $2, $3, $4)`,
      [id, encrypted, '2026-10-01T00:00:00Z', recoveryCodeHashes],
    );
    return secret;
  }

  /** The code an authenticator app shows at the clock's time, `offsetSteps` away. */
  function totpCode(secret: Buffer | string, offsetSteps = 0): string {
    const key =
      typeof secret === 'string'
        ? Secret.fromBase32(secret)
        : new Secret({ buffer: Uint8Array.from(secret).buffer });
    return TOTP.generate({
      secret: key,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      timestamp: clock.now().getTime() + offsetSteps * STEP_MS,
    });
  }

  function login(email: string, password = PASSPHRASE): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/login', { email, password }, { headers: ADMIN_HEADERS });
  }

  async function mfaRequired(email: string): Promise<MfaRequired> {
    const response = await login(email);
    expect(response.status).toBe(403);
    expect(response.problem?.code).toBe('MFA_REQUIRED');
    return response.body as MfaRequired;
  }

  function verify(body: Record<string, string>): Promise<TestResponse> {
    return client.post('/api/v1/admin/auth/mfa/verify', body, { headers: ADMIN_HEADERS });
  }

  function me(path: string, token: string, body?: Record<string, string>): Promise<TestResponse> {
    return client.post(`/api/v1/me/mfa/${path}`, body, {
      headers: { 'X-Client': 'admin-web', Authorization: `Bearer ${token}` },
    });
  }

  async function tokenFor(type: MfaTokenType, userId: string): Promise<string> {
    return (await signMfaToken(testApp.app.get(KeySet), clock.now(), type, userId)).token;
  }

  function setCookieOf(response: TestResponse): string | undefined {
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeLessThanOrEqual(1);
    return cookies[0];
  }

  function auditActions(): Promise<string[]> {
    return query<{ action: string }>(
      'SELECT action FROM public.audit_logs ORDER BY created_at, id',
    ).then((rows) => rows.map((row) => row.action));
  }

  function auditDiffs(): Promise<string> {
    return query<{ diff: unknown }>('SELECT diff FROM public.audit_logs').then((rows) =>
      JSON.stringify(rows),
    );
  }

  async function userRow(id: string): Promise<{
    failed_login_count: number;
    locked_until: Date | null;
    last_login_at: Date | null;
  }> {
    const [row] = await query<{
      failed_login_count: number;
      locked_until: Date | null;
      last_login_at: Date | null;
    }>('SELECT failed_login_count, locked_until, last_login_at FROM public.users WHERE id = $1', [
      id,
    ]);
    if (row === undefined) {
      throw new Error('fixture user missing');
    }
    return row;
  }

  async function credentialRow(id: string): Promise<
    | {
        secret_encrypted: string;
        enabled_at: Date | null;
        last_used_step: number | null;
        recovery_code_hashes: string[];
      }
    | undefined
  > {
    const [row] = await query<{
      secret_encrypted: string;
      enabled_at: Date | null;
      last_used_step: number | null;
      recovery_code_hashes: string[];
    }>(
      `SELECT secret_encrypted, enabled_at, last_used_step, recovery_code_hashes
         FROM public.mfa_credentials WHERE user_id = $1`,
      [id],
    );
    return row;
  }

  describe('enrolment with the enrolment token (first ADMIN, decision 0008 section 8)', () => {
    it('sets up, confirms and completes the sign-in; the secret column holds ciphertext', async () => {
      await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
      const challenge = await mfaRequired(ADMIN_EMAIL);
      expect(challenge.mfaEnrolled).toBe(false);

      const setup = await me('setup', challenge.mfaToken);
      expect(setup.status).toBe(200);
      const { otpauthUri, secret } = setup.body as { otpauthUri: string; secret: string };
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/Kitchen%20Daylight%20\(test\):/);

      const pending = await credentialRow(ADMIN_ID);
      expect(pending?.enabled_at).toBeNull();
      expect(pending?.secret_encrypted).toMatch(STORED_LAYOUT);
      expect(pending?.secret_encrypted).not.toContain(secret);
      const plain = Buffer.from(Secret.fromBase32(secret).buffer);
      expect(pending?.secret_encrypted).not.toContain(plain.toString('base64url'));
      expect(pending?.secret_encrypted).not.toContain(plain.toString('hex'));
      // It is the AES-GCM value of decision 0008 section 8, bound to this user.
      const decrypted = testApp.app
        .get(SecretCipher)
        .decrypt(pending?.secret_encrypted ?? '', ADMIN_ID).plaintext;
      expect(decrypted.equals(plain)).toBe(true);

      const confirmed = await me('confirm', challenge.mfaToken, { code: totpCode(secret) });
      expect(confirmed.status).toBe(200);
      const body = confirmed.body as { recoveryCodes: string[]; session: AdminSessionBody };
      expect(body.recoveryCodes).toHaveLength(10);
      expect(new Set(body.recoveryCodes).size).toBe(10);
      expect(body.session.user).toEqual({
        id: ADMIN_ID,
        displayName: 'Quản lý mẫu',
        role: 'ADMIN',
      });
      expect(body.session).not.toHaveProperty('refreshToken');
      expect(setCookieOf(confirmed)).toMatch(
        /^kd_refresh=[A-Za-z0-9_-]{43}; Path=\/api\/v1\/admin\/auth;/,
      );

      const enabled = await credentialRow(ADMIN_ID);
      expect(enabled?.enabled_at).not.toBeNull();
      expect(enabled?.recovery_code_hashes).toHaveLength(10);
      for (const hash of enabled?.recovery_code_hashes ?? []) {
        expect(hash).toMatch(/^\$argon2id\$v=19\$/);
      }
      expect((await userRow(ADMIN_ID)).last_login_at).toEqual(clock.now());
      expect(await auditActions()).toEqual([
        'auth.mfa_requested',
        'auth.mfa_enrolled',
        'auth.login_succeeded',
      ]);
      const diffs = await auditDiffs();
      expect(diffs).not.toContain(secret);
      for (const code of body.recoveryCodes) {
        expect(diffs).not.toContain(code);
      }

      // The new session is a real one: the access token reaches /me.
      const profile = await client.get('/api/v1/me', {
        headers: { Authorization: `Bearer ${body.session.accessToken}` },
      });
      expect(profile.status).toBe(200);

      // Enrolled now: the next sign-in asks for the code, and setup no longer replaces it.
      const next = await mfaRequired(ADMIN_EMAIL);
      expect(next.mfaEnrolled).toBe(true);
      const again = await me('setup', body.session.accessToken);
      expect(again.status).toBe(409);
      expect(again.problem?.code).toBe('ALREADY_EXISTS');
    });

    it('refuses a wrong confirmation code (counted) and keeps the credential pending', async () => {
      await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
      const { mfaToken } = await mfaRequired(ADMIN_EMAIL);
      const { secret } = (await me('setup', mfaToken)).body as { secret: string };

      const wrong = await me('confirm', mfaToken, { code: totpCode(secret, 3) });

      expect(wrong.status).toBe(400);
      expect(wrong.problem?.code).toBe('CODE_INVALID');
      expect(setCookieOf(wrong)).toBeUndefined();
      expect((await credentialRow(ADMIN_ID))?.enabled_at).toBeNull();
      expect((await userRow(ADMIN_ID)).failed_login_count).toBe(1);
    });

    it('refuses the enrolment token everywhere else: /me, recovery codes, the second step', async () => {
      await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
      const { mfaToken } = await mfaRequired(ADMIN_EMAIL);

      expect(
        (
          await client.get('/api/v1/me', {
            headers: { Authorization: `Bearer ${mfaToken}` },
          })
        ).status,
      ).toBe(401);
      expect((await me('recovery-codes', mfaToken, { code: '123456' })).status).toBe(401);
      const asChallenge = await verify({ challenge: mfaToken, code: '123456' });
      expect(asChallenge.status).toBe(401);
      expect(asChallenge.problem?.code).toBe('UNAUTHENTICATED');
    });

    it.each([
      ['SUSPENDED', 'SUSPENDED'],
      ['INVITED', 'INVITED'],
    ])('refuses the enrolment token of a %s account', async (_case, status) => {
      await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN', status);
      const token = await tokenFor(MFA_ENROLMENT_TOKEN_TYPE, ADMIN_ID);

      const response = await me('setup', token);

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      expect(await credentialRow(ADMIN_ID)).toBeUndefined();
    });
  });

  describe('POST /admin/auth/mfa/verify', () => {
    it('completes the sign-in with a TOTP code: session, cookie, last_login_at, codes left', async () => {
      await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER');
      const secret = await enrolled(MANAGER_ID);
      await query('UPDATE public.users SET failed_login_count = 2 WHERE id = $1', [MANAGER_ID]);
      const { mfaToken, mfaEnrolled } = await mfaRequired(MANAGER_EMAIL);
      expect(mfaEnrolled).toBe(true);

      const response = await verify({ challenge: mfaToken, code: totpCode(secret) });

      expect(response.status).toBe(200);
      const body = response.body as AdminSessionBody & { recoveryCodesLeft: number };
      expect(body.user.role).toBe('MANAGER');
      expect(body.recoveryCodesLeft).toBe(2);
      expect(body).not.toHaveProperty('refreshToken');
      expect(setCookieOf(response)).toMatch(/^kd_refresh=/);
      expect(await userRow(MANAGER_ID)).toEqual({
        failed_login_count: 0,
        locked_until: null,
        last_login_at: clock.now(),
      });
      const [token] = await query<{ device_label: string }>(
        'SELECT device_label FROM public.refresh_tokens',
      );
      expect(token?.device_label).toBe('admin-web');
      expect(await auditActions()).toEqual([
        'auth.mfa_requested',
        'auth.mfa_succeeded',
        'auth.login_succeeded',
      ]);
    });

    it('refuses the same TOTP code twice (replay), even with a new challenge', async () => {
      await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER');
      const secret = await enrolled(MANAGER_ID);
      const code = totpCode(secret);

      const first = await verify({ challenge: (await mfaRequired(MANAGER_EMAIL)).mfaToken, code });
      expect(first.status).toBe(200);
      const replay = await verify({ challenge: (await mfaRequired(MANAGER_EMAIL)).mfaToken, code });

      expect(replay.status).toBe(400);
      expect(replay.problem?.code).toBe('CODE_INVALID');

      // The next step's code works.
      clock.advance(STEP_MS);
      const later = await verify({
        challenge: (await mfaRequired(MANAGER_EMAIL)).mfaToken,
        code: totpCode(secret),
      });
      expect(later.status).toBe(200);
    });

    it('accepts a recovery code once (testing-strategy "MFA recovery")', async () => {
      await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
      await enrolled(ADMIN_ID);
      const typed = 'abcde 12345';

      const first = await verify({
        challenge: (await mfaRequired(ADMIN_EMAIL)).mfaToken,
        recoveryCode: typed,
      });
      expect(first.status).toBe(200);
      expect((first.body as { recoveryCodesLeft: number }).recoveryCodesLeft).toBe(1);
      expect((await credentialRow(ADMIN_ID))?.recovery_code_hashes).toEqual([
        recoveryCodeHashes[1],
      ]);

      const second = await verify({
        challenge: (await mfaRequired(ADMIN_EMAIL)).mfaToken,
        recoveryCode: typed,
      });
      expect(second.status).toBe(400);
      expect(second.problem?.code).toBe('CODE_INVALID');
      expect(await auditActions()).toContain('auth.mfa_recovery_code_used');
      expect(await auditDiffs()).not.toContain('ABCDE');
    });

    it('counts a wrong code and a wrong password toward one lock, with identical answers', async () => {
      await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER');
      const secret = await enrolled(MANAGER_ID);

      const wrongPassword = await login(MANAGER_EMAIL, WRONG_PASSPHRASE);
      await login(MANAGER_EMAIL, WRONG_PASSPHRASE);
      const { mfaToken } = await mfaRequired(MANAGER_EMAIL);
      const wrongCode = await verify({ challenge: mfaToken, code: totpCode(secret, 4) });
      await verify({ challenge: mfaToken, recoveryCode: 'ZZZZZ-ZZZZZ' });
      // The fifth failure (2 passwords + 3 codes) locks the account (staff threshold 5).
      await verify({ challenge: mfaToken, code: totpCode(secret, -4) });

      const user = await userRow(MANAGER_ID);
      expect(user.failed_login_count).toBe(5);
      expect(user.locked_until).not.toBeNull();
      expect(
        (await auditActions()).filter((action) => action === 'auth.account_locked'),
      ).toHaveLength(1);

      // Locked: the right code and the right password get the same answers as wrong ones.
      const lockedCode = await verify({ challenge: mfaToken, code: totpCode(secret) });
      const lockedPassword = await login(MANAGER_EMAIL);
      expect({ status: lockedCode.status, body: lockedCode.body }).toEqual({
        status: wrongCode.status,
        body: wrongCode.body,
      });
      expect(lockedCode.problem?.code).toBe('CODE_INVALID');
      expect({ status: lockedPassword.status, body: lockedPassword.body }).toEqual({
        status: wrongPassword.status,
        body: wrongPassword.body,
      });
      expect(lockedPassword.problem?.code).toBe('INVALID_CREDENTIALS');
      // Nothing says which factor failed or when the lock ends.
      expect(JSON.stringify([lockedCode.body, lockedPassword.body])).not.toMatch(
        /lock|until|attempt|remaining/i,
      );
      expect(setCookieOf(lockedCode)).toBeUndefined();
      expect((await userRow(MANAGER_ID)).failed_login_count).toBe(5);
    });

    it.each([
      [
        'an expired challenge',
        async () => {
          const { mfaToken } = await mfaRequired(MANAGER_EMAIL);
          clock.advance(6 * 60 * 1000);
          return mfaToken;
        },
      ],
      [
        'a SUSPENDED account',
        async () => {
          await query(`UPDATE public.users SET status = 'SUSPENDED' WHERE id = $1`, [MANAGER_ID]);
          return tokenFor(MFA_CHALLENGE_TOKEN_TYPE, MANAGER_ID);
        },
      ],
      [
        'an INVITED account',
        async () => {
          await query(`UPDATE public.users SET status = 'INVITED' WHERE id = $1`, [MANAGER_ID]);
          return tokenFor(MFA_CHALLENGE_TOKEN_TYPE, MANAGER_ID);
        },
      ],
    ])('refuses %s with UNAUTHENTICATED and no session', async (_case, challengeOf) => {
      await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER');
      const secret = await enrolled(MANAGER_ID);
      const challenge = await challengeOf();

      const response = await verify({ challenge, code: totpCode(secret) });

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      expect(setCookieOf(response)).toBeUndefined();
      expect(await query('SELECT 1 FROM public.refresh_tokens')).toEqual([]);
      expect((await userRow(MANAGER_ID)).failed_login_count).toBe(0);
    });

    it('answers VALIDATION_FAILED to both codes or neither, and FORBIDDEN without CSRF headers', async () => {
      await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER');
      const secret = await enrolled(MANAGER_ID);
      const { mfaToken } = await mfaRequired(MANAGER_EMAIL);

      const neither = await verify({ challenge: mfaToken });
      const both = await verify({
        challenge: mfaToken,
        code: totpCode(secret),
        recoveryCode: RECOVERY_CODES[0],
      });
      const noCsrf = await client.post('/api/v1/admin/auth/mfa/verify', {
        challenge: mfaToken,
        code: totpCode(secret),
      });

      expect(neither.problem?.code).toBe('VALIDATION_FAILED');
      expect(both.problem?.code).toBe('VALIDATION_FAILED');
      expect(noCsrf.status).toBe(403);
      expect(noCsrf.problem?.code).toBe('FORBIDDEN');
      expect((await userRow(MANAGER_ID)).failed_login_count).toBe(0);
    });
  });

  describe('no session without the second step', () => {
    it('refuses the refresh of a STAFF account promoted to MANAGER with no second factor', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
      const signedIn = await login(STAFF_EMAIL);
      expect(signedIn.status).toBe(200);
      const cookie = setCookieOf(signedIn)?.split('; ')[0] ?? '';
      await query(`UPDATE public.users SET role = 'MANAGER' WHERE id = $1`, [STAFF_ID]);

      const refreshed = await client.post('/api/v1/admin/auth/refresh', undefined, {
        headers: { ...ADMIN_HEADERS, Cookie: cookie },
      });

      expect(refreshed.status).toBe(401);
      expect(setCookieOf(refreshed)).toMatch(/^kd_refresh=; /);
      // The next sign-in leads to enrolment.
      expect((await mfaRequired(STAFF_EMAIL)).mfaEnrolled).toBe(false);
    });

    it('does not ask STAFF for a second factor, and STAFF cannot enrol', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
      const signedIn = await login(STAFF_EMAIL);
      expect(signedIn.status).toBe(200);
      const { accessToken } = signedIn.body as AdminSessionBody;

      const setup = await me('setup', accessToken);

      expect(setup.status).toBe(403);
      expect(setup.problem?.code).toBe('FORBIDDEN');
      expect(await credentialRow(STAFF_ID)).toBeUndefined();
    });

    it('answers 401 with the Bearer challenge to /me/mfa/setup without a token', async () => {
      const response = await client.post('/api/v1/me/mfa/setup', {});

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    });
  });

  describe('POST /me/mfa/recovery-codes', () => {
    it('replaces the whole set after a current code; the old codes stop working', async () => {
      await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
      const secret = await enrolled(ADMIN_ID);
      const signedIn = await verify({
        challenge: (await mfaRequired(ADMIN_EMAIL)).mfaToken,
        code: totpCode(secret),
      });
      const { accessToken } = signedIn.body as AdminSessionBody;
      clock.advance(STEP_MS);

      const response = await me('recovery-codes', accessToken, { code: totpCode(secret) });

      expect(response.status).toBe(200);
      const { recoveryCodes } = response.body as { recoveryCodes: string[] };
      expect(recoveryCodes).toHaveLength(10);
      expect((await credentialRow(ADMIN_ID))?.recovery_code_hashes).toHaveLength(10);
      expect(await auditActions()).toContain('auth.mfa_recovery_codes_regenerated');

      const old = await verify({
        challenge: (await mfaRequired(ADMIN_EMAIL)).mfaToken,
        recoveryCode: RECOVERY_CODES[0],
      });
      expect(old.problem?.code).toBe('CODE_INVALID');
      const fresh = await verify({
        challenge: (await mfaRequired(ADMIN_EMAIL)).mfaToken,
        recoveryCode: recoveryCodes[0] ?? '',
      });
      expect(fresh.status).toBe(200);
      expect((fresh.body as { recoveryCodesLeft: number }).recoveryCodesLeft).toBe(9);
    });

    it('refuses a STAFF access token (roles MANAGER and ADMIN only)', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
      const { accessToken } = (await login(STAFF_EMAIL)).body as AdminSessionBody;

      const response = await me('recovery-codes', accessToken, { code: '123456' });

      expect(response.status).toBe(403);
    });
  });
});
