import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A2-T4, api-outline "Current user" and testing-strategy "Authorization and ownership": `/me`,
// `/me/password`, `/me/consents` and `/me/sessions` end to end, as `kd_app`, against real
// PostgreSQL. Each test boots its own app, so the per-IP sign-in counter starts empty. Fictional
// data only; the phone numbers are well-formed but made up.

const NOW = '2026-11-07T03:00:00.000Z';

const CUSTOMER_ID = '01930000-0000-7000-8000-000000000e01';
const OTHER_CUSTOMER_ID = '01930000-0000-7000-8000-000000000e02';
const SOCIAL_ID = '01930000-0000-7000-8000-000000000e03';
const BRANCH_ID = '01930000-0000-7000-8000-000000000e11';
const DELETED_BRANCH_ID = '01930000-0000-7000-8000-000000000e12';
const MISSING_ID = '01930000-0000-7000-8000-000000000eff';

const CUSTOMER_EMAIL = 'fixture-me@kd.example';
const OTHER_EMAIL = 'fixture-me-other@kd.example';
const SOCIAL_EMAIL = 'fixture-me-social@kd.example';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';
const NEW_PASSPHRASE = 'kd-fixture-new-passphrase';

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Người dùng mẫu', 'vi', 'CUSTOMER', 'ACTIVE')`;

const SHA = (digit: string): string => digit.repeat(64);

interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** The family id, `sid` of the access token. */
  readonly familyId: string;
}

/** The `sid` claim of an access token (the payload is not secret; the signature is not checked). */
function familyIdOf(accessToken: string): string {
  const payload = accessToken.split('.')[1] ?? '';
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid: string };
  return claims.sid;
}

describe('current user (kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSPHRASE);
  });

  beforeEach(async () => {
    await truncateAll();
    testApp = await createTestApp({ clock: new FixedClock(NOW) });
    client = http(testApp.baseUrl);
    await query(INSERT_USER_SQL, [CUSTOMER_ID, CUSTOMER_EMAIL, passwordHash]);
    await query(INSERT_USER_SQL, [OTHER_CUSTOMER_ID, OTHER_EMAIL, passwordHash]);
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  async function signIn(email = CUSTOMER_EMAIL, deviceLabel?: string): Promise<Session> {
    const response = await client.post('/api/v1/auth/login', {
      email,
      password: PASSPHRASE,
      ...(deviceLabel === undefined ? {} : { deviceLabel }),
    });
    expect(response.status).toBe(200);
    const { accessToken, refreshToken } = response.body as Session;
    return { accessToken, refreshToken, familyId: familyIdOf(accessToken) };
  }

  function bearer(session: Pick<Session, 'accessToken'>): Record<string, string> {
    return { authorization: `Bearer ${session.accessToken}` };
  }

  function patchMe(session: Session, body: unknown): Promise<TestResponse> {
    return client.request('/api/v1/me', { method: 'PATCH', headers: bearer(session), body });
  }

  function changePassword(
    session: Pick<Session, 'accessToken'>,
    currentPassword: string,
    newPassword: string,
  ): Promise<TestResponse> {
    return client.post(
      '/api/v1/me/password',
      { currentPassword, newPassword },
      { headers: bearer(session) },
    );
  }

  function revokeSession(session: Session, familyId: string): Promise<TestResponse> {
    return client.request(`/api/v1/me/sessions/${familyId}`, {
      method: 'DELETE',
      headers: bearer(session),
    });
  }

  function refresh(refreshToken: string): Promise<TestResponse> {
    return client.post('/api/v1/auth/refresh', { refreshToken });
  }

  async function storedUser(id = CUSTOMER_ID) {
    const rows = await query<{
      email: string;
      display_name: string;
      phone: string | null;
      preferred_branch_id: string | null;
      failed_login_count: number;
    }>(
      `SELECT email::text, display_name, phone, preferred_branch_id, failed_login_count
         FROM public.users WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  describe('GET and PATCH /me', () => {
    it('needs a token', async () => {
      expect((await client.get('/api/v1/me')).status).toBe(401);
    });

    it('returns the profile of the token user only', async () => {
      const session = await signIn();

      const response = await client.get('/api/v1/me', { headers: bearer(session) });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: CUSTOMER_ID,
        email: CUSTOMER_EMAIL,
        emailVerifiedAt: null,
        displayName: 'Người dùng mẫu',
        phone: null,
        avatarUrl: null,
        preferredBranchId: null,
      });
    });

    it('stores a national-form phone in E.164 and clears it with null', async () => {
      const session = await signIn();

      const set = await patchMe(session, { phone: '090 123 4567' });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ phone: '+84901234567' });
      expect((await storedUser())?.phone).toBe('+84901234567');

      const cleared = await patchMe(session, { phone: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ phone: null });
      expect((await storedUser())?.phone).toBeNull();
    });

    it('refuses a phone that is not a Vietnamese mobile with INVALID_PHONE, unchanged', async () => {
      const session = await signIn();
      await patchMe(session, { phone: '0901234567' });

      for (const phone of ['0281234567', '12345', '']) {
        const response = await patchMe(session, { phone });

        expect(response.status).toBe(400);
        expect(response.problem).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'phone', code: 'INVALID_PHONE' }],
        });
      }
      expect((await storedUser())?.phone).toBe('+84901234567');
    });

    it('trims displayName, refuses a blank one and one over 60 characters', async () => {
      const session = await signIn();

      expect((await patchMe(session, { displayName: '  Khách Mới  ' })).body).toMatchObject({
        displayName: 'Khách Mới',
      });
      const blank = await patchMe(session, { displayName: '  ' });
      expect(blank.problem?.errors).toEqual([
        expect.objectContaining({ field: 'displayName', code: 'REQUIRED' }),
      ]);
      const tooLong = await patchMe(session, { displayName: 'a'.repeat(61) });
      expect(tooLong.problem?.errors).toEqual([
        expect.objectContaining({ field: 'displayName', code: 'TOO_LONG' }),
      ]);
      const missing = await patchMe(session, { displayName: null });
      expect(missing.status).toBe(400);
      expect((await storedUser())?.display_name).toBe('Khách Mới');
    });

    it('cannot change the email or name another user', async () => {
      const session = await signIn();

      for (const body of [{ email: 'fixture-taken@kd.example' }, { id: OTHER_CUSTOMER_ID }]) {
        const response = await patchMe(session, body);

        expect(response.status).toBe(400);
        expect(response.problem?.code).toBe('VALIDATION_FAILED');
      }
      expect((await storedUser())?.email).toBe(CUSTOMER_EMAIL);
    });

    it('sets a live preferred branch, refuses a missing or deleted one with NOT_FOUND, clears with null', async () => {
      await insertIdentityFixtures({ branchIds: [BRANCH_ID, DELETED_BRANCH_ID] });
      await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [
        DELETED_BRANCH_ID,
      ]);
      const session = await signIn();

      const set = await patchMe(session, { preferredBranchId: BRANCH_ID });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ preferredBranchId: BRANCH_ID });

      for (const preferredBranchId of [MISSING_ID, DELETED_BRANCH_ID]) {
        const response = await patchMe(session, { preferredBranchId });

        expect(response.status).toBe(400);
        expect(response.problem).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'preferredBranchId', code: 'NOT_FOUND' }],
        });
      }
      const malformed = await patchMe(session, { preferredBranchId: 'not-a-uuid' });
      expect(malformed.problem?.errors).toEqual([
        expect.objectContaining({ field: 'preferredBranchId', code: 'INVALID' }),
      ]);
      expect((await storedUser())?.preferred_branch_id).toBe(BRANCH_ID);

      const cleared = await patchMe(session, { preferredBranchId: null });
      expect(cleared.body).toMatchObject({ preferredBranchId: null });
    });

    it('changes nothing for an empty body', async () => {
      const session = await signIn();

      const response = await patchMe(session, {});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: CUSTOMER_ID, displayName: 'Người dùng mẫu' });
    });
  });

  describe('POST /me/password', () => {
    it('keeps the current session and signs every other one out', async () => {
      const current = await signIn(CUSTOMER_EMAIL, 'Điện thoại mẫu');
      const other = await signIn(CUSTOMER_EMAIL, 'Máy tính mẫu');
      const stranger = await signIn(OTHER_EMAIL);

      const response = await changePassword(current, PASSPHRASE, NEW_PASSPHRASE);

      expect(response.status).toBe(204);
      expect((await refresh(current.refreshToken)).status).toBe(200);
      expect((await refresh(other.refreshToken)).status).toBe(401);
      // Another user's session is untouched.
      expect((await refresh(stranger.refreshToken)).status).toBe(200);
      const login = (password: string) =>
        client.post('/api/v1/auth/login', { email: CUSTOMER_EMAIL, password });
      expect((await login(PASSPHRASE)).status).toBe(401);
      expect((await login(NEW_PASSPHRASE)).status).toBe(200);
    });

    it('answers INVALID_CREDENTIALS to a wrong current password and counts it toward the lockout', async () => {
      const current = await signIn();
      const other = await signIn();

      const response = await changePassword(current, 'kd-fixture-wrong-guess', NEW_PASSPHRASE);

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('INVALID_CREDENTIALS');
      expect((await storedUser())?.failed_login_count).toBe(1);
      // Nothing else changed: the other session lives, the old password still works.
      expect((await refresh(other.refreshToken)).status).toBe(200);
    });

    it('checks the policy on newPassword first, without counting an attempt', async () => {
      const current = await signIn();

      const response = await changePassword(current, 'kd-fixture-wrong-guess', 'short');

      expect(response.status).toBe(400);
      expect(response.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'newPassword', code: 'TOO_SHORT' }],
      });
      expect((await storedUser())?.failed_login_count).toBe(0);
    });

    it('answers INVALID_STATE for an account without a password (social only, mobile G98)', async () => {
      await query(INSERT_USER_SQL, [SOCIAL_ID, SOCIAL_EMAIL, null]);
      const { token } = await testApp.app
        .get(AccessTokenService)
        .sign({ userId: SOCIAL_ID, role: 'CUSTOMER', sessionId: MISSING_ID });

      const response = await changePassword({ accessToken: token }, PASSPHRASE, NEW_PASSPHRASE);

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('INVALID_STATE');
    });
  });

  describe('GET /me/consents', () => {
    it('returns the latest event per document type of the token user', async () => {
      const [termsV1, termsV2, privacy] = await Promise.all(
        [
          ['TERMS_OF_SERVICE', '1.0', SHA('a')],
          ['TERMS_OF_SERVICE', '2.0', SHA('b')],
          ['PRIVACY_POLICY', '1.0', SHA('c')],
        ].map(async ([type, version, sha]) => {
          const rows = await query<{ id: string }>(
            `INSERT INTO public.consent_documents (type, version, locale, content_sha256, published_at)
             VALUES ($1, $2, 'vi', $3, '2026-10-01T00:00:00Z') RETURNING id`,
            [type, version, sha],
          );
          return rows[0]?.id ?? '';
        }),
      );
      const consent = (userId: string, documentId: string, occurredAt: string) =>
        query(
          `INSERT INTO public.user_consents (user_id, document_id, action, occurred_at, client)
           VALUES ($1, $2, 'GRANTED', $3, 'MOBILE')`,
          [userId, documentId, occurredAt],
        );
      await consent(CUSTOMER_ID, termsV1 ?? '', '2026-10-02T00:00:00Z');
      await consent(CUSTOMER_ID, termsV2 ?? '', '2026-11-02T00:00:00Z');
      await consent(CUSTOMER_ID, privacy ?? '', '2026-10-02T00:00:00Z');
      // Another user's newer consent is not visible.
      await consent(OTHER_CUSTOMER_ID, termsV1 ?? '', '2026-11-05T00:00:00Z');
      const session = await signIn();

      const response = await client.get('/api/v1/me/consents', { headers: bearer(session) });

      expect(response.status).toBe(200);
      // In the order of the `consent_document_type` enum: Terms of Service, then Privacy Policy.
      expect(response.body).toEqual([
        {
          documentId: termsV2,
          type: 'TERMS_OF_SERVICE',
          version: '2.0',
          locale: 'vi',
          action: 'GRANTED',
          occurredAt: '2026-11-02T00:00:00.000Z',
        },
        {
          documentId: privacy,
          type: 'PRIVACY_POLICY',
          version: '1.0',
          locale: 'vi',
          action: 'GRANTED',
          occurredAt: '2026-10-02T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('/me/sessions', () => {
    function listSessions(session: Session, search = ''): Promise<TestResponse> {
      return client.get(`/api/v1/me/sessions${search}`, { headers: bearer(session) });
    }

    it('pages the live families of the token user only and marks the current one', async () => {
      const first = await signIn(CUSTOMER_EMAIL, 'Thiết bị 1');
      await signIn(CUSTOMER_EMAIL, 'Thiết bị 2');
      const third = await signIn(CUSTOMER_EMAIL, 'Thiết bị 3');
      await signIn(OTHER_EMAIL, 'Thiết bị khác');

      const page1 = await listSessions(third, '?page=1&pageSize=2');
      const page2 = await listSessions(third, '?page=2&pageSize=2');

      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      const items = [
        ...(page1.body as { items: { id: string; deviceLabel: string; isCurrent: boolean }[] })
          .items,
        ...(page2.body as { items: { id: string; deviceLabel: string; isCurrent: boolean }[] })
          .items,
      ];
      expect(items.map((item) => item.deviceLabel).sort()).toEqual([
        'Thiết bị 1',
        'Thiết bị 2',
        'Thiết bị 3',
      ]);
      expect(items.filter((item) => item.isCurrent).map((item) => item.id)).toEqual([
        third.familyId,
      ]);
      expect(items.map((item) => item.id)).toContain(first.familyId);
    });

    it('defaults to page 1 of 20 and refuses a page size over 50', async () => {
      const session = await signIn();

      expect((await listSessions(session)).body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      const tooLarge = await listSessions(session, '?pageSize=51');
      expect(tooLarge.status).toBe(400);
      expect(tooLarge.problem?.errors).toEqual([
        expect.objectContaining({ field: 'pageSize', code: 'OUT_OF_RANGE' }),
      ]);
    });

    it('revokes one of my sessions, idempotently; its refresh token then fails', async () => {
      const current = await signIn();
      const other = await signIn();

      expect((await revokeSession(current, other.familyId)).status).toBe(204);
      expect((await revokeSession(current, other.familyId)).status).toBe(204);

      expect((await refresh(other.refreshToken)).status).toBe(401);
      expect((await refresh(current.refreshToken)).status).toBe(200);
    });

    it("cannot list or revoke another user's session: NOT_FOUND, and it stays live", async () => {
      const mine = await signIn();
      const theirs = await signIn(OTHER_EMAIL);

      const listed = await listSessions(mine);
      expect((listed.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
        mine.familyId,
      ]);

      const response = await revokeSession(mine, theirs.familyId);
      expect(response.status).toBe(404);
      expect(response.problem?.code).toBe('NOT_FOUND');
      expect((await refresh(theirs.refreshToken)).status).toBe(200);
    });

    it('answers NOT_FOUND to an unknown family and VALIDATION_FAILED to a malformed id', async () => {
      const session = await signIn();

      expect((await revokeSession(session, MISSING_ID)).status).toBe(404);
      expect((await revokeSession(session, 'not-a-uuid')).status).toBe(400);
    });

    it('revoking the current session makes its refresh token fail', async () => {
      const current = await signIn();

      expect((await revokeSession(current, current.familyId)).status).toBe(204);

      expect((await refresh(current.refreshToken)).status).toBe(401);
      // The access token lives until it expires; the list no longer shows the session.
      expect((await listSessions(current)).body).toMatchObject({ items: [], total: 0 });
    });
  });
});
