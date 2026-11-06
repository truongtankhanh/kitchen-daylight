import { randomBytes } from 'node:crypto';

import { ERROR_STATUS } from '@kd/contracts';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import {
  EMAIL_CODE_EVENTS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MS,
} from '../../src/modules/auth/email-code.service.js';
import { MailService } from '../../src/modules/mail/mail.service.js';
import { MailDeliveryError } from '../../src/modules/mail/ports/mail.port.js';
import type { MailMessage } from '../../src/modules/mail/ports/mail.port.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A2-T2, testing-strategy "Auth and sessions" (6-digit code) and decision 0008 sections 5 to 7: the
// four code routes end to end, as `kd_app`, against real PostgreSQL. `MailService.send` is replaced
// by a recording double, so the specs read the code from the rendered mail and nothing leaves the
// process. Each test boots its own app, so the in-process per-IP counters (send-code and forgot:
// 5 per 15 minutes; verify and reset: 10 per 15 minutes) start empty. Fictional data only.

const NOW = '2026-11-06T03:00:00.000Z';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const CUSTOMER_ID = '01930000-0000-7000-8000-000000000d01';
const OTHER_CUSTOMER_ID = '01930000-0000-7000-8000-000000000d02';
const STAFF_ID = '01930000-0000-7000-8000-000000000d03';
const SUSPENDED_ID = '01930000-0000-7000-8000-000000000d04';

const CUSTOMER_EMAIL = 'fixture-codes@kd.example';
const OTHER_EMAIL = 'fixture-other@kd.example';
const FREE_EMAIL = 'fixture-free@kd.example';
const STAFF_EMAIL = 'fixture-staff@kd.example';
const SUSPENDED_EMAIL = 'fixture-suspended@kd.example';
const UNKNOWN_EMAIL = 'fixture-unknown@kd.example';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';
const NEW_PASSPHRASE = 'kd-fixture-new-passphrase';

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Người dùng mẫu', 'vi', $4, $5)`;

const INSERT_TOKEN_SQL = `INSERT INTO public.email_tokens
  (user_id, type, channel, token_hash, target_email, max_attempts, created_at, expires_at, used_at)
  VALUES ($1, $2, 'CODE', $3, $4, 5, $5, $5::timestamptz + interval '10 minutes', $5)`;

interface CodeRow {
  id: string;
  type: string;
  channel: string;
  token_hash: Buffer;
  target_email: string;
  attempts: number;
  max_attempts: number;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

const CODE_IN_MAIL = /là: (\d{6})$/mu;

describe('email codes (kd_app, real PostgreSQL)', () => {
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
    await insertUser(CUSTOMER_ID, CUSTOMER_EMAIL);
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
    role = 'CUSTOMER',
    status = 'ACTIVE',
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, passwordHash, role, status]);
  }

  async function signIn(email = CUSTOMER_EMAIL, password = PASSPHRASE): Promise<string> {
    const response = await client.post('/api/v1/auth/login', { email, password });
    expect(response.status).toBe(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  function bearer(accessToken: string): { headers: Record<string, string> } {
    return { headers: { authorization: `Bearer ${accessToken}` } };
  }

  function sendCode(
    accessToken: string,
    body: Record<string, unknown> = {},
  ): Promise<TestResponse> {
    return client.post('/api/v1/auth/email/send-code', body, bearer(accessToken));
  }

  function verify(accessToken: string, code: string): Promise<TestResponse> {
    return client.post('/api/v1/auth/email/verify', { code }, bearer(accessToken));
  }

  function forgot(email: string): Promise<TestResponse> {
    return client.post('/api/v1/auth/password/forgot', { email });
  }

  function reset(email: string, code: string, newPassword = NEW_PASSPHRASE): Promise<TestResponse> {
    return client.post('/api/v1/auth/password/reset', { email, code, newPassword });
  }

  /** The code of the last recorded mail. */
  function lastCode(): string {
    const match = CODE_IN_MAIL.exec(sent.at(-1)?.text ?? '');
    expect(match, 'a code in the last mail').not.toBeNull();
    return match?.[1] ?? '';
  }

  /** A six-digit code other than `code`. */
  function wrongCodeFor(code: string): string {
    return String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  }

  function codeRows(userId = CUSTOMER_ID, type = 'VERIFY_EMAIL'): Promise<CodeRow[]> {
    return query<CodeRow>(
      `SELECT id, type, channel, token_hash, target_email, attempts, max_attempts, created_at,
              expires_at, used_at
         FROM public.email_tokens WHERE user_id = $1 AND type = $2 ORDER BY created_at, id`,
      [userId, type],
    );
  }

  async function userRow(id = CUSTOMER_ID): Promise<{
    email: string;
    email_verified_at: Date | null;
    failed_login_count: number;
    locked_until: Date | null;
  }> {
    const rows = await query<{
      email: string;
      email_verified_at: Date | null;
      failed_login_count: number;
      locked_until: Date | null;
    }>(
      'SELECT email, email_verified_at, failed_login_count, locked_until FROM public.users WHERE id = $1',
      [id],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture user missing');
    }
    return row;
  }

  /** Rows of past messages, all spent, created `agesMs` before now. */
  async function seedPastMessages(type: string, agesMs: readonly number[]): Promise<void> {
    for (const age of agesMs) {
      const createdAt = new Date(clock.now().getTime() - age);
      await query(INSERT_TOKEN_SQL, [
        CUSTOMER_ID,
        type,
        randomBytes(32),
        CUSTOMER_EMAIL,
        createdAt.toISOString(),
      ]);
    }
  }

  function expectCodeInvalid(response: TestResponse): void {
    expect(response.status).toBe(ERROR_STATUS.CODE_INVALID);
    expect(response.problem?.code).toBe('CODE_INVALID');
  }

  function expectGeneric(response: TestResponse): void {
    expect(response.status).toBe(202);
    expect(response.body).toBeNull();
  }

  describe('verify email', () => {
    it('stores only an HMAC and accepts the right code once', async () => {
      const token = await signIn();

      expectGeneric(await sendCode(token));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ templateKey: 'VERIFY_EMAIL_CODE', to: CUSTOMER_EMAIL });
      const code = lastCode();

      const [row] = await codeRows();
      expect(row).toMatchObject({
        channel: 'CODE',
        target_email: CUSTOMER_EMAIL,
        attempts: 0,
        max_attempts: EMAIL_CODE_MAX_ATTEMPTS,
        used_at: null,
      });
      expect(row?.token_hash).toHaveLength(32);
      expect(row?.token_hash.toString('utf8')).not.toContain(code);
      expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + EMAIL_CODE_TTL_MS);

      const first = await verify(token, code);
      expect(first.status).toBe(204);
      expect((await userRow()).email_verified_at?.toISOString()).toBe(NOW);
      expect((await codeRows())[0]?.used_at).not.toBeNull();

      expectCodeInvalid(await verify(token, code));
    });

    it('accepts the code typed with spaces', async () => {
      const token = await signIn();
      await sendCode(token);
      const code = lastCode();

      const response = await verify(token, `${code.slice(0, 3)} ${code.slice(3)}`);

      expect(response.status).toBe(204);
    });

    it('counts a wrong code in attempts', async () => {
      const token = await signIn();
      await sendCode(token);

      expectCodeInvalid(await verify(token, wrongCodeFor(lastCode())));

      expect((await codeRows())[0]?.attempts).toBe(1);
    });

    it('refuses a malformed code without counting it', async () => {
      const token = await signIn();
      await sendCode(token);

      const response = await verify(token, '12a456');

      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
      expect((await codeRows())[0]?.attempts).toBe(0);
    });

    it('kills the code after five wrong attempts, even for the right code', async () => {
      const token = await signIn();
      await sendCode(token);
      const code = lastCode();

      for (let attempt = 0; attempt < EMAIL_CODE_MAX_ATTEMPTS; attempt += 1) {
        expectCodeInvalid(await verify(token, wrongCodeFor(code)));
      }
      expect((await codeRows())[0]?.attempts).toBe(EMAIL_CODE_MAX_ATTEMPTS);

      expectCodeInvalid(await verify(token, code));
      expect((await codeRows())[0]?.attempts).toBe(EMAIL_CODE_MAX_ATTEMPTS);
      expect((await userRow()).email_verified_at).toBeNull();
    });

    it('refuses an expired code', async () => {
      const token = await signIn();
      await sendCode(token);
      const code = lastCode();

      clock.advance(EMAIL_CODE_TTL_MS);

      expectCodeInvalid(await verify(token, code));
      expect((await userRow()).email_verified_at).toBeNull();
    });

    it('expires the old code when a new one is issued', async () => {
      const token = await signIn();
      await sendCode(token);
      const oldCode = lastCode();

      clock.advance(61 * SECOND);
      expectGeneric(await sendCode(token));
      expect(sent).toHaveLength(2);
      const newCode = lastCode();

      const rows = await codeRows();
      expect(rows).toHaveLength(2);
      expect(rows[0]?.used_at).not.toBeNull();
      expect(rows[1]?.used_at).toBeNull();

      if (oldCode !== newCode) {
        expectCodeInvalid(await verify(token, oldCode));
      }
      expect((await verify(token, newCode)).status).toBe(204);
    });

    it('needs a customer access token', async () => {
      const anonymous = await client.post('/api/v1/auth/email/send-code', {});
      expect(anonymous.status).toBe(401);
      expect(anonymous.problem?.code).toBe('UNAUTHENTICATED');

      await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
      // The customer login refuses staff (and the staff login is A3), so the token is signed here.
      const staffToken = await testApp.app.get(AccessTokenService).sign({
        userId: STAFF_ID,
        role: 'STAFF',
        sessionId: '01930000-0000-7000-8000-000000000d99',
      });
      const staff = await sendCode(staffToken.token);
      expect(staff.status).toBe(403);
      expect(staff.problem?.code).toBe('FORBIDDEN');
      expect(sent).toHaveLength(0);
    });

    it('answers 202 even when the mail transport fails', async () => {
      vi.mocked(testApp.app.get(MailService).send).mockImplementation(() =>
        Promise.reject(new MailDeliveryError('VERIFY_EMAIL_CODE', 'ECONNREFUSED')),
      );
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const token = await signIn();

      expectGeneric(await sendCode(token));

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: EMAIL_CODE_EVENTS.sendFailed, userId: CUSTOMER_ID }),
          expect.any(String),
        );
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(CUSTOMER_EMAIL);
    });
  });

  describe('another email', () => {
    it('sends to a free email and makes it the account email on success', async () => {
      const token = await signIn();

      expectGeneric(await sendCode(token, { email: ` ${FREE_EMAIL.toUpperCase()} ` }));

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(FREE_EMAIL);
      expect((await codeRows())[0]?.target_email).toBe(FREE_EMAIL);

      expect((await verify(token, lastCode())).status).toBe(204);
      const user = await userRow();
      expect(user.email).toBe(FREE_EMAIL);
      expect(user.email_verified_at?.toISOString()).toBe(NOW);
    });

    it('sends nothing to an email of another account, answers the same and ends the live code', async () => {
      await insertUser(OTHER_CUSTOMER_ID, OTHER_EMAIL);
      const token = await signIn();
      await sendCode(token);
      const ownCode = lastCode();
      clock.advance(61 * SECOND);

      const taken = await sendCode(token, { email: OTHER_EMAIL });

      expectGeneric(taken);
      expect(sent).toHaveLength(1);
      const rows = await codeRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.used_at).not.toBeNull();
      expectCodeInvalid(await verify(token, ownCode));
      expect((await userRow()).email).toBe(CUSTOMER_EMAIL);
    });

    it('refuses a verified account with INVALID_STATE', async () => {
      await query('UPDATE public.users SET email_verified_at = $2 WHERE id = $1', [
        CUSTOMER_ID,
        NOW,
      ]);
      const token = await signIn();

      const withEmail = await sendCode(token, { email: FREE_EMAIL });
      const withoutEmail = await sendCode(token);

      for (const response of [withEmail, withoutEmail]) {
        expect(response.status).toBe(ERROR_STATUS.INVALID_STATE);
        expect(response.problem?.code).toBe('INVALID_STATE');
      }
      expect(sent).toHaveLength(0);
      expect(await codeRows()).toHaveLength(0);
    });
  });

  describe('password reset', () => {
    it('answers the same for unknown, staff, suspended and customer emails; mails the customer only', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
      await insertUser(SUSPENDED_ID, SUSPENDED_EMAIL, 'CUSTOMER', 'SUSPENDED');

      const responses = [
        await forgot(UNKNOWN_EMAIL),
        await forgot(STAFF_EMAIL),
        await forgot(SUSPENDED_EMAIL),
        await forgot(CUSTOMER_EMAIL),
      ];

      for (const response of responses) {
        expectGeneric(response);
        expect(response.headers.get('content-length') ?? '0').toBe('0');
      }
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ templateKey: 'PASSWORD_RESET_CODE', to: CUSTOMER_EMAIL });
      expect(await codeRows(STAFF_ID, 'RESET_PASSWORD')).toHaveLength(0);
      expect(await codeRows(SUSPENDED_ID, 'RESET_PASSWORD')).toHaveLength(0);
    });

    it('sets the password, revokes every family and clears the lock', async () => {
      await signIn();
      await signIn();
      await query(
        `UPDATE public.users SET failed_login_count = 12, locked_until = $2 WHERE id = $1`,
        [CUSTOMER_ID, new Date(clock.now().getTime() + HOUR).toISOString()],
      );

      expectGeneric(await forgot(CUSTOMER_EMAIL));
      const response = await reset(CUSTOMER_EMAIL, lastCode());

      expect(response.status).toBe(204);
      const families = await query<{ revoked: boolean }>(
        'SELECT revoked_at IS NOT NULL AS revoked FROM public.refresh_tokens WHERE user_id = $1',
        [CUSTOMER_ID],
      );
      expect(families).toHaveLength(2);
      expect(families.every((family) => family.revoked)).toBe(true);
      const user = await userRow();
      expect(user.failed_login_count).toBe(0);
      expect(user.locked_until).toBeNull();

      const old = await client.post('/api/v1/auth/login', {
        email: CUSTOMER_EMAIL,
        password: PASSPHRASE,
      });
      expect(old.problem?.code).toBe('INVALID_CREDENTIALS');
      await signIn(CUSTOMER_EMAIL, NEW_PASSPHRASE);
    });

    it('refuses a wrong code and counts it; the code works once', async () => {
      await forgot(CUSTOMER_EMAIL);
      const code = lastCode();

      expectCodeInvalid(await reset(CUSTOMER_EMAIL, wrongCodeFor(code)));
      expect((await codeRows(CUSTOMER_ID, 'RESET_PASSWORD'))[0]?.attempts).toBe(1);

      expect((await reset(CUSTOMER_EMAIL, code)).status).toBe(204);
      expectCodeInvalid(await reset(CUSTOMER_EMAIL, code, 'kd-fixture-third-passphrase'));
    });

    it('answers CODE_INVALID for unknown, staff and suspended accounts', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF');
      await insertUser(SUSPENDED_ID, SUSPENDED_EMAIL, 'CUSTOMER', 'SUSPENDED');

      for (const email of [UNKNOWN_EMAIL, STAFF_EMAIL, SUSPENDED_EMAIL]) {
        const response = await reset(email, '042137');
        expectCodeInvalid(response);
        expect(response.problem?.detail).toBeUndefined();
      }
    });

    it('checks the new password before the code, without counting it', async () => {
      await forgot(CUSTOMER_EMAIL);

      const response = await reset(CUSTOMER_EMAIL, lastCode(), 'short');

      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
      expect(response.problem?.errors).toEqual([
        expect.objectContaining({ field: 'newPassword', code: 'TOO_SHORT' }),
      ]);
      expect((await codeRows(CUSTOMER_ID, 'RESET_PASSWORD'))[0]).toMatchObject({
        attempts: 0,
        used_at: null,
      });
    });
  });

  describe('per-account throttling (PostgreSQL)', () => {
    it('sends at most one message per user and type every 60 s, answering the same', async () => {
      const token = await signIn();

      expectGeneric(await sendCode(token));
      clock.advance(59 * SECOND);
      expectGeneric(await sendCode(token));
      expect(sent).toHaveLength(1);
      expect(await codeRows()).toHaveLength(1);

      clock.advance(1 * SECOND);
      expectGeneric(await sendCode(token));
      expect(sent).toHaveLength(2);
    });

    it('applies the 60 s rule to forgot as well', async () => {
      expectGeneric(await forgot(CUSTOMER_EMAIL));
      expectGeneric(await forgot(CUSTOMER_EMAIL));

      expect(sent).toHaveLength(1);
    });

    it('sends nothing on the sixth request in 24 hours, logs it, and sends again in a new window', async () => {
      await seedPastMessages('VERIFY_EMAIL', [
        23 * HOUR,
        20 * HOUR,
        10 * HOUR,
        5 * HOUR,
        2 * MINUTE,
      ]);
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const token = await signIn();

      expectGeneric(await sendCode(token));

      expect(sent).toHaveLength(0);
      expect(await codeRows()).toHaveLength(5);
      expect(warn).toHaveBeenCalledWith(
        { event: EMAIL_CODE_EVENTS.dailyCapReached, userId: CUSTOMER_ID, type: 'VERIFY_EMAIL' },
        expect.any(String),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(CUSTOMER_EMAIL);

      // The oldest message leaves the window one hour later.
      clock.advance(HOUR + SECOND);
      expectGeneric(await sendCode(await signIn()));
      expect(sent).toHaveLength(1);
    });

    it('answers a capped forgot like an unknown email', async () => {
      await seedPastMessages('RESET_PASSWORD', [
        22 * HOUR,
        12 * HOUR,
        6 * HOUR,
        1 * HOUR,
        5 * MINUTE,
      ]);

      const capped = await forgot(CUSTOMER_EMAIL);
      const unknown = await forgot(UNKNOWN_EMAIL);

      expectGeneric(capped);
      expect(capped.status).toBe(unknown.status);
      expect(capped.body).toEqual(unknown.body);
      expect(sent).toHaveLength(0);
    });
  });

  describe('per-IP throttling (in-process)', () => {
    it('allows 5 send requests per 15 minutes, shared by send-code and forgot', async () => {
      const token = await signIn();

      expectGeneric(await sendCode(token));
      for (let index = 0; index < 4; index += 1) {
        expectGeneric(await forgot(`fixture-unknown-${index}@kd.example`));
      }
      const refused = await forgot(UNKNOWN_EMAIL);

      expect(refused.status).toBe(429);
      expect(refused.problem?.code).toBe('RATE_LIMITED');
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('allows 10 guesses per 15 minutes on verify and reset together', async () => {
      const token = await signIn();
      await sendCode(token);
      const wrong = wrongCodeFor(lastCode());

      for (let index = 0; index < 5; index += 1) {
        expectCodeInvalid(await verify(token, wrong));
      }
      for (let index = 0; index < 5; index += 1) {
        expectCodeInvalid(await reset(UNKNOWN_EMAIL, wrong));
      }
      const refused = await reset(UNKNOWN_EMAIL, wrong);

      expect(refused.status).toBe(429);
      expect(refused.problem?.code).toBe('RATE_LIMITED');
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    });
  });
});
