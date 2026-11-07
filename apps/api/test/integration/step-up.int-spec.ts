import { randomBytes } from 'node:crypto';

import { Controller, Get, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { SignJWT } from 'jose';
import { Secret, TOTP } from 'otpauth';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MANAGER_ROLES, Roles } from '../../src/common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../src/common/branch-scope/branch-scope.decorator.js';
import { Sensitive } from '../../src/common/fresh-role/sensitive.decorator.js';
import { FixedClock } from '../../src/common/time/testing.js';
import {
  ACCESS_TOKEN_ISSUER,
  AccessTokenService,
} from '../../src/modules/auth/access-token.service.js';
import { ACCESS_TOKEN_ALGORITHM, KeySet } from '../../src/modules/auth/key-set.js';
import { SecretCipher } from '../../src/modules/auth/mfa/secret-cipher.js';
import { RequiresStepUp } from '../../src/modules/auth/step-up/requires-step-up.decorator.js';
import {
  signStepUpToken,
  STEP_UP_AUDIENCE,
  STEP_UP_TOKEN_TYPE,
  STEP_UP_TTL_SECONDS,
} from '../../src/modules/auth/step-up/step-up.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { LOCKOUT_THRESHOLD } from '../../src/modules/users/lockout.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A3-T6, brief L14 (step-up, proposal) and ADR-0003 (sensitive endpoints re-read the role):
// `POST /admin/auth/step-up`, `@RequiresStepUp` and `@Sensitive()` end to end, as `kd_app`, against
// real PostgreSQL. No real route needs a step-up yet (A4-T2 is the first), so the test-only probe
// controllers below are mounted by this spec only. Each test boots its own app, so the in-process
// throttle counters start empty. TOTP codes are computed from the fixed clock. Fictional data only;
// secrets are random per run.

const NOW = '2026-11-07T03:00:10.000Z';
const SECOND = 1000;
const STEP_MS = 30 * SECOND;

const ADMIN_HEADERS = { 'X-Client': 'admin-web', Origin: 'http://localhost:4200' } as const;

const ADMIN_ID = '01930000-0000-7000-8000-000000001601';
const OTHER_ADMIN_ID = '01930000-0000-7000-8000-000000001602';
const MANAGER_ID = '01930000-0000-7000-8000-000000001603';
const STAFF_ID = '01930000-0000-7000-8000-000000001604';
const SESSION_ID = '01930000-0000-7000-8000-0000000016a1';

const ADMIN_EMAIL = 'fixture-stepup-admin@kd.example';

/** Fictional fixture text, at least 12 characters; never a real credential. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';

const STEP_UP_PATH = '/api/v1/admin/auth/step-up';
const PROBE_PATH = '/api/v1/admin/test-step-up/payment';
const FRESH_ROLE_PROBE_PATH = '/api/v1/admin/test-fresh-role';

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Quản trị Mẫu', 'vi', $4, 'ACTIVE')`;

/** A route that needs the `settings.payment` step-up, as A4-T2's `PUT` of the payment key will. */
@Roles('ADMIN')
@Sensitive()
@Controller('admin/test-step-up')
class StepUpProbeController {
  @RequiresStepUp('settings.payment')
  @Post('payment')
  @HttpCode(HttpStatus.NO_CONTENT)
  payment(): void {
    return undefined;
  }
}

/** A sensitive manager route, for the demoted-manager case of the fresh-role guard. */
@Roles(...MANAGER_ROLES)
@Sensitive()
@NotBranchScoped('Test probe: reads no branch data.')
@Controller('admin/test-fresh-role')
class FreshRoleProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [StepUpProbeController, FreshRoleProbeController] })
class StepUpProbeModule {}

interface StepUpBody {
  stepUpToken: string;
  expiresAt: string;
}

interface AuditRow {
  action: string;
  actor_user_id: string | null;
  diff: Record<string, unknown>;
}

describe('admin step-up and fresh-role re-reads (kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;
  const secrets = new Map<string, Buffer>();

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSPHRASE);
  });

  beforeEach(async () => {
    await truncateAll();
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock, imports: [StepUpProbeModule] });
    client = http(testApp.baseUrl);
    secrets.clear();
    await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN');
    await insertUser(OTHER_ADMIN_ID, 'fixture-stepup-other@kd.example', 'ADMIN');
    await insertUser(MANAGER_ID, 'fixture-stepup-manager@kd.example', 'MANAGER');
    await insertUser(STAFF_ID, 'fixture-stepup-staff@kd.example', 'STAFF');
    for (const id of [ADMIN_ID, OTHER_ADMIN_ID, MANAGER_ID]) {
      await enrol(id);
    }
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(id: string, email: string, role: UserRole): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, passwordHash, role]);
  }

  /** An enrolled credential with a random secret, no step used yet. */
  async function enrol(id: string): Promise<void> {
    const secret = randomBytes(20);
    await query(
      `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, enabled_at)
       VALUES ($1, $2, $3)`,
      [id, testApp.app.get(SecretCipher).encrypt(secret, id), '2026-10-01T00:00:00Z'],
    );
    secrets.set(id, secret);
  }

  /** The code the user's authenticator app shows now. */
  function codeOf(id: string): string {
    const secret = secrets.get(id);
    if (secret === undefined) {
      throw new Error('No secret for this user.');
    }
    return TOTP.generate({
      secret: new Secret({ buffer: Uint8Array.from(secret).buffer }),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      timestamp: clock.now().getTime(),
    });
  }

  async function bearer(id: string, role: UserRole): Promise<{ authorization: string }> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId: id, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  async function stepUp(
    id: string,
    role: UserRole,
    code: string,
    extra: Record<string, string> = ADMIN_HEADERS,
  ): Promise<TestResponse> {
    return client.post(
      STEP_UP_PATH,
      { code, purpose: 'settings.payment' },
      { headers: { ...extra, ...(await bearer(id, role)) } },
    );
  }

  async function probe(
    stepUpToken: string | undefined,
    id = ADMIN_ID,
    role: UserRole = 'ADMIN',
  ): Promise<TestResponse> {
    const headers = await bearer(id, role);
    return client.post(PROBE_PATH, undefined, {
      headers: stepUpToken === undefined ? headers : { ...headers, 'X-Step-Up-Token': stepUpToken },
    });
  }

  function auditRows(): Promise<AuditRow[]> {
    return query<AuditRow>(
      'SELECT action, actor_user_id, diff FROM public.audit_logs ORDER BY created_at, id',
    );
  }

  async function failedLoginCount(id: string): Promise<number> {
    const rows = await query<{ failed_login_count: number }>(
      'SELECT failed_login_count FROM public.users WHERE id = $1',
      [id],
    );
    return rows[0]?.failed_login_count ?? -1;
  }

  function expectProblem(response: TestResponse, status: number, code: string): void {
    expect({ status: response.status, code: response.problem?.code }).toEqual({ status, code });
  }

  describe('POST /admin/auth/step-up', () => {
    it('grants a 5-minute token that opens the probe route, audited once without the code', async () => {
      const code = codeOf(ADMIN_ID);
      const response = await stepUp(ADMIN_ID, 'ADMIN', code);

      expect(response.status).toBe(200);
      const body = response.body as StepUpBody;
      expect(body.expiresAt).toBe(new Date(clock.now().getTime() + 300 * SECOND).toISOString());
      expect((await probe(body.stepUpToken)).status).toBe(204);

      const rows = await auditRows();
      expect(rows).toEqual([
        {
          action: 'auth.step_up_succeeded',
          actor_user_id: ADMIN_ID,
          diff: { purpose: 'settings.payment' },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(code);
      expect(JSON.stringify(rows)).not.toContain(body.stepUpToken);
    });

    it('answers CODE_INVALID to a wrong code and counts it toward the lockout', async () => {
      const response = await stepUp(ADMIN_ID, 'ADMIN', '000000');

      expectProblem(response, 400, 'CODE_INVALID');
      expect(await failedLoginCount(ADMIN_ID)).toBe(1);
      expect(await auditRows()).toEqual([
        {
          action: 'auth.step_up_failed',
          actor_user_id: ADMIN_ID,
          diff: {
            purpose: 'settings.payment',
            method: 'TOTP',
            reason: 'WRONG_CODE',
            failedLoginCount: 1,
          },
        },
      ]);
    });

    it('refuses a recovery code (TOTP only), without counting it', async () => {
      const response = await stepUp(ADMIN_ID, 'ADMIN', 'ABCDE-12345');

      expectProblem(response, 400, 'VALIDATION_FAILED');
      expect(await failedLoginCount(ADMIN_ID)).toBe(0);
    });

    it('refuses the step just used by the sign-in: the admin waits for the next code', async () => {
      const login = await client.post(
        '/api/v1/admin/auth/login',
        { email: ADMIN_EMAIL, password: PASSPHRASE },
        { headers: ADMIN_HEADERS },
      );
      expectProblem(login, 403, 'MFA_REQUIRED');
      const challenge = (login.body as { mfaToken: string }).mfaToken;
      const code = codeOf(ADMIN_ID);
      const verified = await client.post(
        '/api/v1/admin/auth/mfa/verify',
        { challenge, code },
        { headers: ADMIN_HEADERS },
      );
      expect(verified.status).toBe(200);

      expectProblem(await stepUp(ADMIN_ID, 'ADMIN', code), 400, 'CODE_INVALID');

      clock.advance(STEP_MS);
      expect((await stepUp(ADMIN_ID, 'ADMIN', codeOf(ADMIN_ID))).status).toBe(200);
    });

    it('refuses a step-up once used: the same code twice', async () => {
      const code = codeOf(ADMIN_ID);

      expect((await stepUp(ADMIN_ID, 'ADMIN', code)).status).toBe(200);
      expectProblem(await stepUp(ADMIN_ID, 'ADMIN', code), 400, 'CODE_INVALID');
    });

    it('locks after five wrong codes; the right code is then CODE_INVALID, not counted', async () => {
      for (let attempt = 1; attempt <= LOCKOUT_THRESHOLD.staff; attempt += 1) {
        expectProblem(await stepUp(ADMIN_ID, 'ADMIN', '000000'), 400, 'CODE_INVALID');
      }
      expectProblem(await stepUp(ADMIN_ID, 'ADMIN', codeOf(ADMIN_ID)), 400, 'CODE_INVALID');

      expect(await failedLoginCount(ADMIN_ID)).toBe(LOCKOUT_THRESHOLD.staff);
      const actions = (await auditRows()).map((row) => row.action);
      expect(actions.filter((action) => action === 'auth.account_locked')).toHaveLength(1);
      expect(actions.at(-1)).toBe('auth.step_up_failed');
      expect((await auditRows()).at(-1)?.diff).toEqual({
        purpose: 'settings.payment',
        method: 'TOTP',
        reason: 'LOCKED',
      });
    });

    it.each([
      ['MANAGER', MANAGER_ID],
      ['STAFF', STAFF_ID],
    ] as const)('refuses a %s with FORBIDDEN', async (role, id) => {
      const code = secrets.has(id) ? codeOf(id) : '123456';

      expectProblem(await stepUp(id, role, code), 403, 'FORBIDDEN');
      expect(await failedLoginCount(id)).toBe(0);
    });

    it('refuses an admin demoted since the access token was issued', async () => {
      await query("UPDATE public.users SET role = 'MANAGER' WHERE id = $1", [ADMIN_ID]);

      expectProblem(await stepUp(ADMIN_ID, 'ADMIN', codeOf(ADMIN_ID)), 403, 'FORBIDDEN');
    });

    it('needs the CSRF headers like every POST /admin/auth/*', async () => {
      expectProblem(await stepUp(ADMIN_ID, 'ADMIN', codeOf(ADMIN_ID), {}), 403, 'FORBIDDEN');
    });

    it('needs an access token', async () => {
      const response = await client.post(
        STEP_UP_PATH,
        { code: '123456', purpose: 'settings.payment' },
        { headers: ADMIN_HEADERS },
      );

      expectProblem(response, 401, 'UNAUTHENTICATED');
    });
  });

  describe('@RequiresStepUp (probe route)', () => {
    it('answers FORBIDDEN without the header', async () => {
      expectProblem(await probe(undefined), 403, 'FORBIDDEN');
    });

    it('answers FORBIDDEN to a token of another user', async () => {
      const { stepUpToken } = await signStepUpToken(
        testApp.app.get(KeySet),
        clock.now(),
        OTHER_ADMIN_ID,
        'settings.payment',
      );

      expectProblem(await probe(stepUpToken), 403, 'FORBIDDEN');
      expect((await probe(stepUpToken, OTHER_ADMIN_ID)).status).toBe(204);
    });

    it('answers FORBIDDEN to a token for another purpose', async () => {
      const { keyId, key } = testApp.app.get(KeySet).signingKey();
      const issuedAt = Math.floor(clock.now().getTime() / 1000);
      const otherPurpose = await new SignJWT({ purpose: 'settings.brand' })
        .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, kid: keyId, typ: STEP_UP_TOKEN_TYPE })
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setAudience(STEP_UP_AUDIENCE)
        .setSubject(ADMIN_ID)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + STEP_UP_TTL_SECONDS)
        .sign(key);

      expectProblem(await probe(otherPurpose), 403, 'FORBIDDEN');
    });

    it('answers FORBIDDEN to an expired token', async () => {
      const granted = await stepUp(ADMIN_ID, 'ADMIN', codeOf(ADMIN_ID));
      const { stepUpToken } = granted.body as StepUpBody;

      clock.advance(STEP_UP_TTL_SECONDS * SECOND + 6 * SECOND);

      expectProblem(await probe(stepUpToken), 403, 'FORBIDDEN');
    });

    it('answers FORBIDDEN to the access token sent as a step-up token', async () => {
      const { authorization } = await bearer(ADMIN_ID, 'ADMIN');

      expectProblem(await probe(authorization.replace('Bearer ', '')), 403, 'FORBIDDEN');
    });
  });

  describe('@Sensitive (fresh-role guard)', () => {
    it('denies a demoted manager whose access token is still valid', async () => {
      const headers = await bearer(MANAGER_ID, 'MANAGER');
      expect((await client.get(FRESH_ROLE_PROBE_PATH, { headers })).status).toBe(200);

      await query("UPDATE public.users SET role = 'STAFF' WHERE id = $1", [MANAGER_ID]);

      expectProblem(await client.get(FRESH_ROLE_PROBE_PATH, { headers }), 403, 'FORBIDDEN');
    });

    it('denies a demoted admin on /admin/users with the same token', async () => {
      const headers = await bearer(ADMIN_ID, 'ADMIN');
      expect((await client.get('/api/v1/admin/users', { headers })).status).toBe(200);

      await query("UPDATE public.users SET role = 'MANAGER' WHERE id = $1", [ADMIN_ID]);

      expectProblem(await client.get('/api/v1/admin/users', { headers }), 403, 'FORBIDDEN');
    });

    it('signs out a suspended admin: UNAUTHENTICATED with the invalid_token challenge', async () => {
      const headers = await bearer(ADMIN_ID, 'ADMIN');
      await query("UPDATE public.users SET status = 'SUSPENDED' WHERE id = $1", [ADMIN_ID]);

      const response = await client.get('/api/v1/admin/users', { headers });

      expectProblem(response, 401, 'UNAUTHENTICATED');
      expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    });
  });
});
