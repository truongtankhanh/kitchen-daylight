import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AccountThrottleService,
  RESEND_INTERVAL_MS,
} from '../../src/common/throttling/account-throttle.service.js';
import { FixedClock } from '../../src/common/time/testing.js';
import { openAppDataSource } from '../support/app-role.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { TestRoutesModule } from '../support/test-routes.js';
import { truncateAll } from '../support/truncate.js';

/** Figures of `UNLISTED_AUTH_PROFILE` and `UNLISTED_ADMIN_AUTH_PROFILE` (decision 0008 section 7). */
const STRICT_LIMIT = 5;
const STRICT_WINDOW_SECONDS = 15 * 60;

describe('per-IP throttling (in-process memory store)', () => {
  let testApp: TestApp | undefined;
  let client: TestHttpClient;

  beforeAll(async () => {
    // A fresh app has a fresh memory store: no other spec's requests are counted here.
    testApp = await createTestApp({ imports: [TestRoutesModule] });
    client = http(testApp.baseUrl);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it.each(['/api/v1/auth/test-throttle', '/api/v1/admin/auth/test-throttle'])(
    'limits %s by its URL prefix, then answers 429 RATE_LIMITED with Retry-After',
    async (path) => {
      for (let hit = 1; hit <= STRICT_LIMIT; hit += 1) {
        const allowed = await client.post(path);
        expect({ hit, status: allowed.status }).toEqual({ hit, status: 204 });
      }

      const refused = await client.post(path);

      expect(refused.status).toBe(429);
      expect(refused.problem).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
      const retryAfter = Number(refused.headers.get('retry-after'));
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(STRICT_WINDOW_SECONDS);

      // The client address is the socket's (TRUST_PROXY_HOPS 0): a forged header changes nothing.
      const forged = await client.post(path, undefined, {
        headers: { 'x-forwarded-for': '198.51.100.7' },
      });
      expect(forged.status).toBe(429);
    },
  );

  it('keeps a lenient route open after the strict limits are reached', async () => {
    for (let hit = 1; hit <= 20; hit += 1) {
      const response = await client.get('/api/v1/test-guards/public');
      expect({ hit, status: response.status }).toEqual({ hit, status: 200 });
    }
    const last = await client.get('/api/v1/test-guards/public');

    expect(last.headers.get('x-ratelimit-limit')).toBe('600');
  });

  it('never throttles the health check', async () => {
    for (let hit = 1; hit <= 10; hit += 1) {
      const response = await client.get('/api/health');
      expect({ hit, status: response.status }).toEqual({ hit, status: 200 });
      expect(response.headers.get('x-ratelimit-limit')).toBeNull();
    }
  });
});

const NOW = '2026-11-06T03:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const USER_A = '01930000-0000-7000-8000-00000000a8a1';
const USER_B = '01930000-0000-7000-8000-00000000a8b1';
const UNKNOWN_USER = '01930000-0000-7000-8000-00000000a8c1';

// A used token row (so the live-row unique index never interferes), issued at `$5`.
const INSERT_USED_TOKEN_SQL = `INSERT INTO public.email_tokens
  (user_id, type, channel, token_hash, target_email, max_attempts, created_at, expires_at, used_at)
VALUES ($1, $2, $3, $4, 'fixture@kd.example', 5, $5, $5::timestamptz + interval '10 minutes', $5)`;

describe('AccountThrottleService (kd_app, real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: AccountThrottleService;

  async function insertToken(
    userId: string,
    type: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
    createdAt: Date,
  ): Promise<void> {
    // A fixed placeholder hash: 32 bytes, as the CHECK requires; never a real token.
    await dataSource.query(INSERT_USED_TOKEN_SQL, [
      userId,
      type,
      'CODE',
      Buffer.alloc(32, 7),
      createdAt,
    ]);
  }

  async function setLockedUntil(userId: string, lockedUntil: Date | null): Promise<void> {
    await dataSource.query('UPDATE public.users SET locked_until = $2 WHERE id = $1', [
      userId,
      lockedUntil,
    ]);
  }

  beforeAll(async () => {
    dataSource = await openAppDataSource();
    service = new AccountThrottleService(dataSource, new FixedClock(NOW));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ userIds: [USER_A, USER_B] });
  });

  it('reads the lock from users.locked_until, locked only while it is in the future', async () => {
    await expect(service.isSignInLocked(USER_A)).resolves.toBe(false);

    await setLockedUntil(USER_A, new Date(NOW_MS + 15 * 60 * 1000));
    await expect(service.isSignInLocked(USER_A)).resolves.toBe(true);
    await expect(service.isSignInLocked(USER_B)).resolves.toBe(false);

    await setLockedUntil(USER_A, new Date(NOW_MS));
    await expect(service.isSignInLocked(USER_A)).resolves.toBe(false);

    await expect(service.isSignInLocked(UNKNOWN_USER)).resolves.toBe(false);
  });

  it('allows a resend when no email token was ever issued', async () => {
    await expect(service.resendDecision(USER_A, 'VERIFY_EMAIL')).resolves.toEqual({
      allowed: true,
    });
  });

  it('refuses a resend within 60 s of the newest token of the same user and type', async () => {
    await insertToken(USER_A, 'VERIFY_EMAIL', new Date(NOW_MS - 10 * 60 * 1000));
    await insertToken(USER_A, 'VERIFY_EMAIL', new Date(NOW_MS - 30 * 1000));

    await expect(service.resendDecision(USER_A, 'VERIFY_EMAIL')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    // Another type and another user are counted apart.
    await expect(service.resendDecision(USER_A, 'RESET_PASSWORD')).resolves.toEqual({
      allowed: true,
    });
    await expect(service.resendDecision(USER_B, 'VERIFY_EMAIL')).resolves.toEqual({
      allowed: true,
    });
  });

  it('allows a resend from exactly 60 s after the newest token', async () => {
    await insertToken(USER_A, 'RESET_PASSWORD', new Date(NOW_MS - RESEND_INTERVAL_MS));

    await expect(service.resendDecision(USER_A, 'RESET_PASSWORD')).resolves.toEqual({
      allowed: true,
    });
  });
});
