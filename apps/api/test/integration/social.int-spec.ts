import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import type { AuthProvider } from '../../src/modules/auth/entities/auth-identity.entity.js';
import { SOCIAL_NONCE_TTL_MS } from '../../src/modules/auth/social/nonce.service.js';
import { SOCIAL_IDENTITY_VERIFIER } from '../../src/modules/auth/social/social-identity-verifier.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { FakeSocialIdentityVerifier } from '../support/fake-social-identity-verifier.js';
import type { FakeTokenOptions } from '../support/fake-social-identity-verifier.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A2-T6, ADR-0003 "Social sign-in" and testing-strategy "Auth and sessions" (account takeover
// cases): `/auth/social/*` and `/me/identities/{provider}` end to end, as `kd_app`, against real
// PostgreSQL. The verifier is the test double of `test/support/` (the real `jose` checks with a
// local key set), bound through the provider override only. Each test boots its own app, so the
// per-IP counters and the consumed-nonce set start empty. Fictional data only.

const NOW = '2026-11-07T03:00:00.000Z';

const TERMS_ID = '01930000-0000-7000-8000-000000000d01';
const PRIVACY_ID = '01930000-0000-7000-8000-000000000d02';
const DOCUMENT_IDS = [TERMS_ID, PRIVACY_ID];

const LOCAL_ID = '01930000-0000-7000-8000-000000000d11';
const OTHER_ID = '01930000-0000-7000-8000-000000000d12';
const STAFF_ID = '01930000-0000-7000-8000-000000000d13';

const LOCAL_EMAIL = 'fixture-social-local@kd.example';
const OTHER_EMAIL = 'fixture-social-other@kd.example';
const STAFF_EMAIL = 'fixture-social-staff@kd.example';
const NEW_EMAIL = 'fixture-social-new@kd.example';
const RELAY_EMAIL = 'kd-fixture-relay@privaterelay.appleid.com';

const SUBJECT = 'kd-subject-001';
const OTHER_SUBJECT = 'kd-subject-002';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';

const SEED_DOCUMENTS_SQL = `INSERT INTO public.consent_documents
  (id, type, version, locale, content_sha256, published_at) VALUES
  ($1, 'TERMS_OF_SERVICE', '1', 'vi', repeat('a', 64), '2026-10-01T00:00:00Z'),
  ($2, 'PRIVACY_POLICY',   '1', 'vi', repeat('b', 64), '2026-10-01T00:00:00Z')`;

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status, email_verified_at)
  VALUES ($1, $2, $3, 'Người dùng mẫu', 'vi', $4, $5, $6)`;

interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly emailVerifiedAt: string | null;
  };
}

interface IdentityRow {
  readonly user_id: string;
  readonly provider: AuthProvider;
  readonly provider_subject: string;
}

describe('social sign-in (kd_app, real PostgreSQL, test verifier)', () => {
  let passwordHash: string;
  let verifier: FakeSocialIdentityVerifier;
  let clock: FixedClock;
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSPHRASE);
  });

  beforeEach(async () => {
    await truncateAll();
    verifier = await FakeSocialIdentityVerifier.create();
    clock = new FixedClock(NOW);
    testApp = await createTestApp({
      clock,
      providers: [{ provide: SOCIAL_IDENTITY_VERIFIER, useValue: verifier }],
    });
    client = http(testApp.baseUrl);
    await query(SEED_DOCUMENTS_SQL, DOCUMENT_IDS);
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(
    id: string,
    email: string,
    options: {
      readonly role?: string;
      readonly status?: string;
      readonly verified?: boolean;
      readonly password?: boolean;
    } = {},
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [
      id,
      email,
      options.password === false ? null : passwordHash,
      options.role ?? 'CUSTOMER',
      options.status ?? 'ACTIVE',
      options.verified === false ? null : NOW,
    ]);
  }

  function identities(): Promise<IdentityRow[]> {
    return query<IdentityRow>(
      'SELECT user_id, provider, provider_subject FROM public.auth_identities ORDER BY id',
    );
  }

  async function nonce(): Promise<string> {
    const response = await client.post('/api/v1/auth/social/nonce');
    expect(response.status).toBe(200);
    return (response.body as { nonce: string }).nonce;
  }

  /** A fresh nonce and a token carrying it. */
  async function credentials(
    provider: AuthProvider,
    options: Omit<FakeTokenOptions, 'nonce' | 'subject'> & { readonly subject?: string } = {},
  ): Promise<{ idToken: string; nonce: string }> {
    const issued = await nonce();
    const idToken = await verifier.token(provider, {
      subject: SUBJECT,
      email: NEW_EMAIL,
      ...options,
      nonce: issued,
    });
    return { idToken, nonce: issued };
  }

  function signIn(
    provider: AuthProvider,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    const path = provider === 'GOOGLE' ? 'google' : 'apple';
    return client.post(`/api/v1/auth/social/${path}`, body, { headers });
  }

  async function passwordSignIn(email: string): Promise<Session> {
    const response = await client.post('/api/v1/auth/login', { email, password: PASSPHRASE });
    expect(response.status).toBe(200);
    return response.body as Session;
  }

  function link(session: Session, provider: string, body: unknown): Promise<TestResponse> {
    return client.post(`/api/v1/me/identities/${provider}`, body, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
  }

  function unlink(session: Session, provider: string): Promise<TestResponse> {
    return client.request(`/api/v1/me/identities/${provider}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
  }

  describe('POST /auth/social/nonce', () => {
    it('returns a nonce and its expiry, five minutes ahead', async () => {
      const response = await client.post('/api/v1/auth/social/nonce');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        nonce: expect.any(String) as unknown,
        expiresAt: '2026-11-07T03:05:00.000Z',
      });
    });
  });

  describe('sign-in', () => {
    it('creates a verified customer without a password, its consents and its link on first sign-in', async () => {
      const response = await signIn(
        'GOOGLE',
        {
          ...(await credentials('GOOGLE')),
          acceptedDocumentIds: DOCUMENT_IDS,
          displayName: 'Người dùng mẫu',
        },
        { 'x-client': 'mobile-android', 'x-app-version': '1.0.0' },
      );

      expect(response.status).toBe(200);
      const session = response.body as Session;
      expect(session.user).toEqual({
        id: expect.any(String) as unknown,
        email: NEW_EMAIL,
        displayName: 'Người dùng mẫu',
        emailVerifiedAt: NOW,
      });
      const [user] = await query<{ password_hash: string | null; role: string; status: string }>(
        'SELECT password_hash, role, status FROM public.users WHERE id = $1',
        [session.user.id],
      );
      expect(user).toEqual({ password_hash: null, role: 'CUSTOMER', status: 'ACTIVE' });
      expect(await identities()).toEqual([
        { user_id: session.user.id, provider: 'GOOGLE', provider_subject: SUBJECT },
      ]);
      const consents = await query<{ document_id: string; action: string; client: string }>(
        `SELECT document_id, action, client FROM public.user_consents
          WHERE user_id = $1 ORDER BY document_id`,
        [session.user.id],
      );
      expect(consents).toEqual([
        { document_id: TERMS_ID, action: 'GRANTED', client: 'MOBILE' },
        { document_id: PRIVACY_ID, action: 'GRANTED', client: 'MOBILE' },
      ]);
    });

    it('returns the same user on a second sign-in with the same subject', async () => {
      const first = await signIn('APPLE', {
        ...(await credentials('APPLE', { email: RELAY_EMAIL })),
        acceptedDocumentIds: DOCUMENT_IDS,
        displayName: 'Người dùng mẫu',
      });
      expect(first.status).toBe(200);

      // Apple sends no name and the app sends no documents the second time.
      const second = await signIn('APPLE', await credentials('APPLE', { email: RELAY_EMAIL }));

      expect(second.status).toBe(200);
      expect((second.body as Session).user.id).toBe((first.body as Session).user.id);
      expect((second.body as Session).user.email).toBe(RELAY_EMAIL);
      expect(await identities()).toHaveLength(1);
      const [{ count }] = (await query<{ count: string }>(
        'SELECT count(*) AS count FROM public.users',
      )) as [{ count: string }];
      expect(count).toBe('1');
    });

    it('signs in by subject even when the token now carries another email', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      await query(
        `INSERT INTO public.auth_identities (user_id, provider, provider_subject)
         VALUES ($1, 'GOOGLE', $2)`,
        [LOCAL_ID, SUBJECT],
      );

      const response = await signIn(
        'GOOGLE',
        await credentials('GOOGLE', { email: 'fixture-changed@kd.example' }),
      );

      expect(response.status).toBe(200);
      expect((response.body as Session).user.id).toBe(LOCAL_ID);
    });

    it('auto-links an existing account only when both emails are verified', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL, { verified: true });

      const response = await signIn('GOOGLE', await credentials('GOOGLE', { email: LOCAL_EMAIL }));

      expect(response.status).toBe(200);
      expect((response.body as Session).user.id).toBe(LOCAL_ID);
      expect(await identities()).toEqual([
        { user_id: LOCAL_ID, provider: 'GOOGLE', provider_subject: SUBJECT },
      ]);
    });

    it('answers ALREADY_EXISTS and links nothing when the local account email is not verified', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL, { verified: false });

      const response = await signIn(
        'GOOGLE',
        await credentials('GOOGLE', { email: LOCAL_EMAIL.toUpperCase() }),
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('ALREADY_EXISTS');
      expect(await identities()).toEqual([]);
    });

    it('answers ALREADY_EXISTS and links nothing when the provider email is not verified', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL, { verified: true });

      const response = await signIn(
        'APPLE',
        await credentials('APPLE', { email: LOCAL_EMAIL, emailVerified: 'false' }),
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('ALREADY_EXISTS');
      expect(await identities()).toEqual([]);
    });

    it('answers EMAIL_NOT_VERIFIED and creates nothing for a new account with an unverified email', async () => {
      const response = await signIn('GOOGLE', {
        ...(await credentials('GOOGLE', { emailVerified: false })),
        acceptedDocumentIds: DOCUMENT_IDS,
      });

      expect(response.problem?.code).toBe('EMAIL_NOT_VERIFIED');
      expect(await query('SELECT id FROM public.users')).toEqual([]);
    });

    it('requires the current documents to create an account, and writes nothing without them', async () => {
      const missing = await signIn('GOOGLE', await credentials('GOOGLE'));
      const wrong = await signIn('GOOGLE', {
        ...(await credentials('GOOGLE')),
        acceptedDocumentIds: [TERMS_ID],
      });

      expect(missing.status).toBe(400);
      expect(missing.problem?.errors).toEqual([
        expect.objectContaining({ field: 'acceptedDocumentIds', code: 'REQUIRED' }),
      ]);
      expect(wrong.problem?.errors).toEqual([
        expect.objectContaining({ field: 'acceptedDocumentIds', code: 'INVALID' }),
      ]);
      expect(await query('SELECT id FROM public.users')).toEqual([]);
      expect(await identities()).toEqual([]);
    });

    it('refuses a staff account with INVALID_CREDENTIALS, by email and by subject', async () => {
      await insertUser(STAFF_ID, STAFF_EMAIL, { role: 'STAFF', verified: true });

      const byEmail = await signIn('GOOGLE', await credentials('GOOGLE', { email: STAFF_EMAIL }));
      await query(
        `INSERT INTO public.auth_identities (user_id, provider, provider_subject)
         VALUES ($1, 'GOOGLE', $2)`,
        [STAFF_ID, OTHER_SUBJECT],
      );
      const bySubject = await signIn(
        'GOOGLE',
        await credentials('GOOGLE', { subject: OTHER_SUBJECT, email: STAFF_EMAIL }),
      );

      expect(byEmail.problem?.code).toBe('INVALID_CREDENTIALS');
      expect(bySubject.problem?.code).toBe('INVALID_CREDENTIALS');
      expect(await identities()).toHaveLength(1);
    });

    it('refuses a suspended account with ACCOUNT_SUSPENDED and issues no session', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL, { status: 'SUSPENDED' });
      await query(
        `INSERT INTO public.auth_identities (user_id, provider, provider_subject)
         VALUES ($1, 'APPLE', $2)`,
        [LOCAL_ID, SUBJECT],
      );

      const response = await signIn('APPLE', await credentials('APPLE', { email: LOCAL_EMAIL }));

      expect(response.status).toBe(403);
      expect(response.problem?.code).toBe('ACCOUNT_SUSPENDED');
      expect(await query('SELECT id FROM public.refresh_tokens')).toEqual([]);
    });
  });

  describe('nonce and token checks', () => {
    it('refuses a reused nonce with UNAUTHENTICATED', async () => {
      const body = { ...(await credentials('GOOGLE')), acceptedDocumentIds: DOCUMENT_IDS };
      expect((await signIn('GOOGLE', body)).status).toBe(200);

      const replay = await signIn('GOOGLE', body);

      expect(replay.status).toBe(401);
      expect(replay.problem?.code).toBe('UNAUTHENTICATED');
    });

    it('refuses an expired nonce with UNAUTHENTICATED', async () => {
      const body = { ...(await credentials('GOOGLE')), acceptedDocumentIds: DOCUMENT_IDS };
      clock.advance(SOCIAL_NONCE_TTL_MS);

      const response = await signIn('GOOGLE', body);

      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      expect(await query('SELECT id FROM public.users')).toEqual([]);
    });

    it('refuses a token whose nonce is not the one sent', async () => {
      const { idToken } = await credentials('GOOGLE');

      const response = await signIn('GOOGLE', {
        idToken,
        nonce: await nonce(),
        acceptedDocumentIds: DOCUMENT_IDS,
      });

      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });

    it('refuses a token for another client id (wrong aud)', async () => {
      const response = await signIn('GOOGLE', {
        ...(await credentials('GOOGLE', { audience: '9999-other.apps.googleusercontent.com' })),
        acceptedDocumentIds: DOCUMENT_IDS,
      });

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      expect(await query('SELECT id FROM public.users')).toEqual([]);
    });

    it('refuses an expired token', async () => {
      const response = await signIn('APPLE', {
        ...(await credentials('APPLE', { expiresAt: Math.floor(Date.now() / 1000) - 3600 })),
        acceptedDocumentIds: DOCUMENT_IDS,
      });

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });

    it('answers NOT_FOUND for a provider without a client id and spends no nonce', async () => {
      await testApp.close();
      verifier = await FakeSocialIdentityVerifier.create({ apple: [] });
      testApp = await createTestApp({
        clock,
        providers: [{ provide: SOCIAL_IDENTITY_VERIFIER, useValue: verifier }],
      });
      client = http(testApp.baseUrl);
      const body = { ...(await credentials('APPLE')), acceptedDocumentIds: DOCUMENT_IDS };

      const response = await signIn('APPLE', body);

      expect(response.status).toBe(404);
      expect(response.problem?.code).toBe('NOT_FOUND');
    });
  });

  describe('/me/identities/{provider}', () => {
    it('links on (provider, subject) for the signed-in user, whatever the email says', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL, { verified: false });
      const session = await passwordSignIn(LOCAL_EMAIL);

      const response = await link(
        session,
        'GOOGLE',
        await credentials('GOOGLE', {
          email: 'fixture-elsewhere@kd.example',
          emailVerified: false,
        }),
      );

      expect(response.status).toBe(204);
      expect(await identities()).toEqual([
        { user_id: LOCAL_ID, provider: 'GOOGLE', provider_subject: SUBJECT },
      ]);
      const signedIn = await signIn('GOOGLE', await credentials('GOOGLE'));
      expect((signedIn.body as Session).user.id).toBe(LOCAL_ID);
    });

    it('answers ALREADY_EXISTS for a subject linked to another user', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      await insertUser(OTHER_ID, OTHER_EMAIL);
      await query(
        `INSERT INTO public.auth_identities (user_id, provider, provider_subject)
         VALUES ($1, 'APPLE', $2)`,
        [OTHER_ID, SUBJECT],
      );
      const session = await passwordSignIn(LOCAL_EMAIL);

      const response = await link(session, 'APPLE', await credentials('APPLE'));

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('ALREADY_EXISTS');
      expect(await identities()).toEqual([
        { user_id: OTHER_ID, provider: 'APPLE', provider_subject: SUBJECT },
      ]);
    });

    it('treats linking the same subject again as done, and a second subject of a provider as ALREADY_EXISTS', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      const session = await passwordSignIn(LOCAL_EMAIL);
      expect((await link(session, 'GOOGLE', await credentials('GOOGLE'))).status).toBe(204);

      const again = await link(session, 'GOOGLE', await credentials('GOOGLE'));
      const second = await link(
        session,
        'GOOGLE',
        await credentials('GOOGLE', { subject: OTHER_SUBJECT }),
      );

      expect(again.status).toBe(204);
      expect(second.problem?.code).toBe('ALREADY_EXISTS');
      expect(await identities()).toHaveLength(1);
    });

    it('refuses a reused nonce on link', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      const session = await passwordSignIn(LOCAL_EMAIL);
      const body = await credentials('APPLE');
      expect((await link(session, 'APPLE', body)).status).toBe(204);

      const replay = await link(session, 'APPLE', body);

      expect(replay.problem?.code).toBe('UNAUTHENTICATED');
    });

    it('refuses an unknown provider with VALIDATION_FAILED', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      const session = await passwordSignIn(LOCAL_EMAIL);

      const response = await link(session, 'FACEBOOK', await credentials('GOOGLE'));

      expect(response.status).toBe(400);
      expect(response.problem?.errors).toEqual([
        expect.objectContaining({ field: 'provider', code: 'INVALID' }),
      ]);
    });

    it('unlinks with a password left, and refuses to remove the last way to sign in', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      const withPassword = await passwordSignIn(LOCAL_EMAIL);
      expect((await link(withPassword, 'GOOGLE', await credentials('GOOGLE'))).status).toBe(204);
      expect((await unlink(withPassword, 'GOOGLE')).status).toBe(204);
      expect(await identities()).toEqual([]);

      const created = await signIn('APPLE', {
        ...(await credentials('APPLE', { subject: OTHER_SUBJECT })),
        acceptedDocumentIds: DOCUMENT_IDS,
        displayName: 'Người dùng mẫu',
      });
      const socialOnly = created.body as Session;
      const refused = await unlink(socialOnly, 'APPLE');
      expect(refused.status).toBe(409);
      expect(refused.problem?.code).toBe('INVALID_STATE');

      expect(
        (
          await link(
            socialOnly,
            'GOOGLE',
            await credentials('GOOGLE', { subject: 'kd-subject-003' }),
          )
        ).status,
      ).toBe(204);
      expect((await unlink(socialOnly, 'APPLE')).status).toBe(204);
      expect((await unlink(socialOnly, 'GOOGLE')).problem?.code).toBe('INVALID_STATE');
      expect(await identities()).toEqual([
        { user_id: socialOnly.user.id, provider: 'GOOGLE', provider_subject: 'kd-subject-003' },
      ]);
    });

    it('answers NOT_FOUND when nothing of the provider is linked', async () => {
      await insertUser(LOCAL_ID, LOCAL_EMAIL);
      const session = await passwordSignIn(LOCAL_EMAIL);

      expect((await unlink(session, 'APPLE')).problem?.code).toBe('NOT_FOUND');
    });

    it('needs an access token', async () => {
      const response = await client.post('/api/v1/me/identities/GOOGLE', {
        idToken: 'x',
        nonce: 'y',
      });

      expect(response.status).toBe(401);
    });
  });
});
