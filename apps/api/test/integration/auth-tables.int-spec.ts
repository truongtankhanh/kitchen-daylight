import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUTH_PROVIDERS } from '../../src/modules/auth/entities/auth-identity.entity.js';
import {
  EMAIL_TOKEN_CHANNELS,
  EMAIL_TOKEN_TYPES,
} from '../../src/modules/auth/entities/email-token.entity.js';
import { CONSENT_DOCUMENT_TYPES } from '../../src/modules/users/entities/consent-document.entity.js';
import {
  CONSENT_ACTIONS,
  CONSENT_CLIENTS,
} from '../../src/modules/users/entities/user-consent.entity.js';
import { CHECK_VIOLATION, expectSqlState, openAppRole } from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';
/** SQLSTATE `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';
/** SQLSTATE `invalid_text_representation`, raised by an unknown enum value. */
const INVALID_TEXT_REPRESENTATION = '22P02';

const USER_A = '01930000-0000-7000-8000-00000000000a';
const USER_B = '01930000-0000-7000-8000-00000000000b';
const UNKNOWN_USER = '01930000-0000-7000-8000-0000000000ff';
const UNKNOWN_DOCUMENT = '01930000-0000-7000-8000-0000000000fe';

/** A 32-byte fixture hash; fictional input, never a real token or code. */
function fixtureHash(label: string): Buffer {
  return createHash('sha256').update(`kd-fixture:${label}`).digest();
}

/** `v1.<kid>.<iv>.<ciphertext>.<tag>` of decision 0008 section 8, with placeholder parts. */
const FIXTURE_SECRET = `v1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(27)}.${'C'.repeat(22)}`;
const FIXTURE_SHA256 = 'a'.repeat(64);

const INSERT_REFRESH_SQL = `INSERT INTO public.refresh_tokens
  (user_id, family_id, token_hash, device_label, expires_at, family_expires_at)
VALUES ($1, $2, $3, 'Fixture device', now() + interval '1 day', now() + interval '7 days')
RETURNING id`;

const INSERT_EMAIL_TOKEN_SQL = `INSERT INTO public.email_tokens
  (user_id, type, channel, token_hash, target_email, max_attempts, expires_at)
VALUES ($1, $2, $3, $4, 'fixture@kd.example', $5, now() + interval '10 minutes')
RETURNING id`;

const INSERT_DOCUMENT_SQL = `INSERT INTO public.consent_documents
  (type, version, locale, content_sha256, published_at)
VALUES ($1, $2, $3, $4, now())
RETURNING id`;

const INSERT_CONSENT_SQL = `INSERT INTO public.user_consents (user_id, document_id, action, client)
VALUES ($1, $2, 'GRANTED', 'MOBILE')
RETURNING id`;

describe('auth, MFA and consent tables (migration 0008)', () => {
  let app: RoleClient;

  beforeAll(async () => {
    app = await openAppRole();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ userIds: [USER_A, USER_B] });
  });

  async function insertRefresh(userId: string, label: string): Promise<string> {
    const rows = await app.query<{ id: string }>(INSERT_REFRESH_SQL, [
      userId,
      USER_A, // any uuid serves as a family id
      fixtureHash(label),
    ]);
    return rows[0]!.id;
  }

  async function insertDocument(version = '1.0'): Promise<string> {
    const rows = await app.query<{ id: string }>(INSERT_DOCUMENT_SQL, [
      'TERMS_OF_SERVICE',
      version,
      'vi',
      FIXTURE_SHA256,
    ]);
    return rows[0]!.id;
  }

  describe('enum values', () => {
    it.each([
      ['auth_provider', AUTH_PROVIDERS],
      ['email_token_type', EMAIL_TOKEN_TYPES],
      ['email_token_channel', EMAIL_TOKEN_CHANNELS],
      ['consent_document_type', CONSENT_DOCUMENT_TYPES],
      ['consent_action', CONSENT_ACTIONS],
      ['consent_client', CONSENT_CLIENTS],
    ] as const)('%s matches the entity constant', async (typeName, values) => {
      const rows = await app.query<{ label: string }>(
        `SELECT e.enumlabel AS label
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typnamespace = 'public'::regnamespace AND t.typname = $1
          ORDER BY e.enumsortorder`,
        [typeName],
      );
      expect(rows.map((row) => row.label)).toEqual([...values]);
    });

    it('refuses a value outside the enum', async () => {
      await expectSqlState(
        app.query(INSERT_EMAIL_TOKEN_SQL, [USER_A, 'MAGIC_LINK', 'CODE', fixtureHash('x'), 5]),
        INVALID_TEXT_REPRESENTATION,
      );
    });
  });

  describe('refresh_tokens', () => {
    it('reads back the defaults and the hash', async () => {
      const id = await insertRefresh(USER_A, 'r1');
      const rows = await app.query<{
        token_hash: Buffer;
        created_at: Date;
        last_used_at: Date;
        used_at: Date | null;
      }>(
        'SELECT token_hash, created_at, last_used_at, used_at FROM public.refresh_tokens WHERE id = $1',
        [id],
      );
      expect(rows[0]?.token_hash.equals(fixtureHash('r1'))).toBe(true);
      expect(rows[0]?.created_at).toBeInstanceOf(Date);
      expect(rows[0]?.last_used_at).toBeInstanceOf(Date);
      expect(rows[0]?.used_at).toBeNull();
    });

    it('refuses a second row with the same token_hash', async () => {
      await insertRefresh(USER_A, 'same');
      await expectSqlState(insertRefresh(USER_B, 'same'), UNIQUE_VIOLATION);
    });

    it('refuses a hash that is not 32 bytes', async () => {
      await expectSqlState(
        app.query(INSERT_REFRESH_SQL, [USER_A, USER_A, Buffer.alloc(16)]),
        CHECK_VIOLATION,
      );
    });

    it('refuses an idle end after the absolute end', async () => {
      await expectSqlState(
        app.query(
          `INSERT INTO public.refresh_tokens
             (user_id, family_id, token_hash, device_label, expires_at, family_expires_at)
           VALUES ($1, $1, $2, 'Fixture device', now() + interval '2 days', now() + interval '1 day')`,
          [USER_A, fixtureHash('late')],
        ),
        CHECK_VIOLATION,
      );
    });

    it('refuses an empty or a 61-character device label', async () => {
      for (const label of ['', 'x'.repeat(61)]) {
        await expectSqlState(
          app.query(
            `INSERT INTO public.refresh_tokens
               (user_id, family_id, token_hash, device_label, expires_at, family_expires_at)
             VALUES ($1, $1, $2, $3, now() + interval '1 day', now() + interval '7 days')`,
            [USER_A, fixtureHash(`label-${label.length}`), label],
          ),
          CHECK_VIOLATION,
        );
      }
    });

    it('links a used token to its successor, and refuses a successor on an unused token', async () => {
      const first = await insertRefresh(USER_A, 'chain-1');
      const second = await insertRefresh(USER_A, 'chain-2');

      await expectSqlState(
        app.query('UPDATE public.refresh_tokens SET replaced_by_id = $2 WHERE id = $1', [
          first,
          second,
        ]),
        CHECK_VIOLATION,
      );
      await app.query(
        'UPDATE public.refresh_tokens SET used_at = now(), replaced_by_id = $2 WHERE id = $1',
        [first, second],
      );
      const third = await insertRefresh(USER_A, 'chain-3');
      await expectSqlState(
        app.query(
          'UPDATE public.refresh_tokens SET used_at = now(), replaced_by_id = $1 WHERE id = $1',
          [third],
        ),
        CHECK_VIOLATION,
      );
      // One successor per token.
      await expectSqlState(
        app.query(
          'UPDATE public.refresh_tokens SET used_at = now(), replaced_by_id = $2 WHERE id = $1',
          [third, second],
        ),
        UNIQUE_VIOLATION,
      );
    });

    it('clears replaced_by_id when the successor is purged', async () => {
      const first = await insertRefresh(USER_A, 'purge-1');
      const second = await insertRefresh(USER_A, 'purge-2');
      await app.query(
        'UPDATE public.refresh_tokens SET used_at = now(), replaced_by_id = $2 WHERE id = $1',
        [first, second],
      );

      await app.query('DELETE FROM public.refresh_tokens WHERE id = $1', [second]);

      const rows = await app.query<{ replaced_by_id: string | null }>(
        'SELECT replaced_by_id FROM public.refresh_tokens WHERE id = $1',
        [first],
      );
      expect(rows[0]?.replaced_by_id).toBeNull();
    });

    it('refuses an unknown user', async () => {
      await expectSqlState(insertRefresh(UNKNOWN_USER, 'nobody'), FOREIGN_KEY_VIOLATION);
    });
  });

  describe('email_tokens', () => {
    it('refuses a second live token of one user and type, and accepts it once the first is used', async () => {
      const rows = await app.query<{ id: string }>(INSERT_EMAIL_TOKEN_SQL, [
        USER_A,
        'VERIFY_EMAIL',
        'CODE',
        fixtureHash('code-1'),
        5,
      ]);
      const firstId = rows[0]!.id;
      const second = [USER_A, 'VERIFY_EMAIL', 'CODE', fixtureHash('code-2'), 5];

      await expectSqlState(app.query(INSERT_EMAIL_TOKEN_SQL, second), UNIQUE_VIOLATION);

      await app.query('UPDATE public.email_tokens SET used_at = now() WHERE id = $1', [firstId]);
      await expect(app.query(INSERT_EMAIL_TOKEN_SQL, second)).resolves.toHaveLength(1);
    });

    it('keeps one live token per type and per user independently', async () => {
      await app.query(INSERT_EMAIL_TOKEN_SQL, [
        USER_A,
        'VERIFY_EMAIL',
        'CODE',
        fixtureHash('a-v'),
        5,
      ]);
      await expect(
        app.query(INSERT_EMAIL_TOKEN_SQL, [
          USER_A,
          'RESET_PASSWORD',
          'CODE',
          fixtureHash('a-r'),
          5,
        ]),
      ).resolves.toHaveLength(1);
      await expect(
        app.query(INSERT_EMAIL_TOKEN_SQL, [USER_B, 'VERIFY_EMAIL', 'CODE', fixtureHash('b-v'), 5]),
      ).resolves.toHaveLength(1);
    });

    it('allows the same hash on two rows (a code may repeat once the old one is used)', async () => {
      const rows = await app.query<{ id: string }>(INSERT_EMAIL_TOKEN_SQL, [
        USER_A,
        'VERIFY_EMAIL',
        'CODE',
        fixtureHash('repeat'),
        5,
      ]);
      await app.query('UPDATE public.email_tokens SET used_at = now() WHERE id = $1', [
        rows[0]!.id,
      ]);
      await expect(
        app.query(INSERT_EMAIL_TOKEN_SQL, [
          USER_A,
          'VERIFY_EMAIL',
          'CODE',
          fixtureHash('repeat'),
          5,
        ]),
      ).resolves.toHaveLength(1);
    });

    it('refuses an invitation sent as a code', async () => {
      await expectSqlState(
        app.query(INSERT_EMAIL_TOKEN_SQL, [USER_A, 'INVITE', 'CODE', fixtureHash('inv'), 1]),
        CHECK_VIOLATION,
      );
      await expect(
        app.query(INSERT_EMAIL_TOKEN_SQL, [USER_A, 'INVITE', 'LINK', fixtureHash('inv'), 1]),
      ).resolves.toHaveLength(1);
    });

    it('refuses max_attempts below 1, attempts below 0 and a hash that is not 32 bytes', async () => {
      await expectSqlState(
        app.query(INSERT_EMAIL_TOKEN_SQL, [USER_A, 'VERIFY_EMAIL', 'CODE', fixtureHash('m'), 0]),
        CHECK_VIOLATION,
      );
      await expectSqlState(
        app.query(INSERT_EMAIL_TOKEN_SQL, [USER_A, 'VERIFY_EMAIL', 'CODE', Buffer.alloc(31), 5]),
        CHECK_VIOLATION,
      );
      const rows = await app.query<{ id: string }>(INSERT_EMAIL_TOKEN_SQL, [
        USER_A,
        'VERIFY_EMAIL',
        'CODE',
        fixtureHash('a'),
        5,
      ]);
      await expectSqlState(
        app.query('UPDATE public.email_tokens SET attempts = -1 WHERE id = $1', [rows[0]!.id]),
        CHECK_VIOLATION,
      );
    });

    it('stores target_email as citext', async () => {
      await app.query(INSERT_EMAIL_TOKEN_SQL, [
        USER_A,
        'VERIFY_EMAIL',
        'CODE',
        fixtureHash('c'),
        5,
      ]);
      const rows = await app.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM public.email_tokens
          WHERE target_email = 'FIXTURE@KD.EXAMPLE'`,
      );
      expect(rows[0]?.count).toBe(1);
    });

    it('refuses an unknown user', async () => {
      await expectSqlState(
        app.query(INSERT_EMAIL_TOKEN_SQL, [
          UNKNOWN_USER,
          'VERIFY_EMAIL',
          'CODE',
          fixtureHash('u'),
          5,
        ]),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe('mfa_credentials', () => {
    const insertMfa = (userId: string, secret: string, hashes: string[] = []) =>
      app.query(
        `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, recovery_code_hashes)
         VALUES ($1, $2, $3::text[])`,
        [userId, secret, hashes],
      );

    it('stores one row per user, with an empty recovery set by default', async () => {
      await app.query(
        'INSERT INTO public.mfa_credentials (user_id, secret_encrypted) VALUES ($1, $2)',
        [USER_A, FIXTURE_SECRET],
      );
      const rows = await app.query<{
        enabled_at: Date | null;
        last_used_step: number | null;
        recovery_code_hashes: string[];
      }>(
        'SELECT enabled_at, last_used_step, recovery_code_hashes FROM public.mfa_credentials WHERE user_id = $1',
        [USER_A],
      );
      expect(rows[0]).toEqual({ enabled_at: null, last_used_step: null, recovery_code_hashes: [] });

      await expectSqlState(insertMfa(USER_A, FIXTURE_SECRET), UNIQUE_VIOLATION);
    });

    it('refuses a secret outside the v1 layout', async () => {
      for (const secret of [
        'plain-base32-secret',
        FIXTURE_SECRET.replace('v1.', 'v2.'),
        FIXTURE_SECRET.slice(0, -1),
      ]) {
        await expectSqlState(insertMfa(USER_A, secret), CHECK_VIOLATION);
      }
    });

    it('accepts ten recovery hashes and refuses eleven or a null element', async () => {
      const ten = Array.from({ length: 10 }, (_, index) => `fixture-hash-${index}`);
      await expect(insertMfa(USER_A, FIXTURE_SECRET, ten)).resolves.toBeDefined();
      await expectSqlState(
        insertMfa(USER_B, FIXTURE_SECRET, [...ten, 'fixture-hash-10']),
        CHECK_VIOLATION,
      );
      await expectSqlState(
        app.query(
          `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, recovery_code_hashes)
           VALUES ($1, $2, ARRAY['fixture-hash', NULL])`,
          [USER_B, FIXTURE_SECRET],
        ),
        CHECK_VIOLATION,
      );
    });

    it('refuses an unknown user', async () => {
      await expectSqlState(insertMfa(UNKNOWN_USER, FIXTURE_SECRET), FOREIGN_KEY_VIOLATION);
    });
  });

  describe('auth_identities', () => {
    const insertIdentity = (userId: string, provider: string, subject: string) =>
      app.query(
        'INSERT INTO public.auth_identities (user_id, provider, provider_subject) VALUES ($1, $2, $3)',
        [userId, provider, subject],
      );

    it('refuses a provider subject linked twice', async () => {
      await insertIdentity(USER_A, 'GOOGLE', 'fixture-subject-1');
      await expectSqlState(insertIdentity(USER_B, 'GOOGLE', 'fixture-subject-1'), UNIQUE_VIOLATION);
      await expect(insertIdentity(USER_B, 'APPLE', 'fixture-subject-1')).resolves.toBeDefined();
    });

    it('refuses a second identity of one provider for one user', async () => {
      await insertIdentity(USER_A, 'APPLE', 'fixture-subject-2');
      await expectSqlState(insertIdentity(USER_A, 'APPLE', 'fixture-subject-3'), UNIQUE_VIOLATION);
    });

    it('refuses an unknown user', async () => {
      await expectSqlState(
        insertIdentity(UNKNOWN_USER, 'GOOGLE', 'fixture-subject-4'),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe('consent_documents and user_consents', () => {
    it('refuses a second document of one type, version and locale', async () => {
      await insertDocument('1.0');
      await expectSqlState(insertDocument('1.0'), UNIQUE_VIOLATION);
      await expect(
        app.query(INSERT_DOCUMENT_SQL, ['TERMS_OF_SERVICE', '1.0', 'en', FIXTURE_SHA256]),
      ).resolves.toHaveLength(1);
    });

    it('refuses a content_sha256 that is not 64 lower-case hex characters', async () => {
      for (const digest of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
        await expectSqlState(
          app.query(INSERT_DOCUMENT_SQL, ['PRIVACY_POLICY', '1.0', 'vi', digest]),
          CHECK_VIOLATION,
        );
      }
    });

    it('records a consent event and refuses an unknown user or document', async () => {
      const documentId = await insertDocument();
      await expect(app.query(INSERT_CONSENT_SQL, [USER_A, documentId])).resolves.toHaveLength(1);
      await expectSqlState(
        app.query(INSERT_CONSENT_SQL, [UNKNOWN_USER, documentId]),
        FOREIGN_KEY_VIOLATION,
      );
      await expectSqlState(
        app.query(INSERT_CONSENT_SQL, [USER_A, UNKNOWN_DOCUMENT]),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe('kd_app privileges', () => {
    it('cannot update or delete a consent event', async () => {
      const documentId = await insertDocument();
      const rows = await app.query<{ id: string }>(INSERT_CONSENT_SQL, [USER_A, documentId]);
      const id = rows[0]!.id;

      await app.expectPermissionDenied(
        "UPDATE public.user_consents SET action = 'WITHDRAWN' WHERE id = $1",
        [id],
      );
      await app.expectPermissionDenied('DELETE FROM public.user_consents WHERE id = $1', [id]);
      await app.expectPermissionDenied('TRUNCATE public.user_consents');
    });

    it('cannot update or delete a published document', async () => {
      const id = await insertDocument();

      await app.expectPermissionDenied(
        "UPDATE public.consent_documents SET version = '1.1' WHERE id = $1",
        [id],
      );
      await app.expectPermissionDenied('DELETE FROM public.consent_documents WHERE id = $1', [id]);
      await app.expectPermissionDenied('TRUNCATE public.consent_documents');
    });

    it('deletes rows of the four token and identity tables', async () => {
      await insertRefresh(USER_A, 'del');
      await app.query(INSERT_EMAIL_TOKEN_SQL, [
        USER_A,
        'VERIFY_EMAIL',
        'CODE',
        fixtureHash('d'),
        5,
      ]);
      await app.query(
        'INSERT INTO public.mfa_credentials (user_id, secret_encrypted) VALUES ($1, $2)',
        [USER_A, FIXTURE_SECRET],
      );
      await app.query(
        "INSERT INTO public.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'GOOGLE', 'fixture-del')",
        [USER_A],
      );

      for (const table of [
        'refresh_tokens',
        'email_tokens',
        'mfa_credentials',
        'auth_identities',
      ]) {
        await app.query(`DELETE FROM public.${table} WHERE user_id = $1`, [USER_A]);
        const rows = await app.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM public.${table}`,
        );
        expect(rows[0]?.count, table).toBe(0);
      }
    });

    it('has exactly the granted table privileges', async () => {
      const expected: Record<string, readonly string[]> = {
        auth_identities: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        refresh_tokens: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        email_tokens: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        mfa_credentials: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        consent_documents: ['INSERT', 'SELECT'],
        user_consents: ['INSERT', 'SELECT'],
      };
      const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];

      for (const [table, granted] of Object.entries(expected)) {
        const rows = await app.query<{ privilege: string }>(
          `SELECT p AS privilege FROM unnest($2::text[]) AS p
            WHERE has_table_privilege('kd_app', 'public.' || $1, p)
            ORDER BY p`,
          [table, privileges],
        );
        expect(
          rows.map((row) => row.privilege),
          table,
        ).toEqual(granted);
      }
    });
  });
});
