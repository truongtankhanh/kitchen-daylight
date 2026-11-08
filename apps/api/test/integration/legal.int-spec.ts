import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppRole,
  openRoleClient,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A4-T4: migration 0012_consent_document_content.sql and GET /legal/documents/current, against real
// PostgreSQL. Documents are written as kd_migrator, as the seed (A4-T5) does. The text is fictional
// fixture text, not legal text.

const NOW = '2026-11-09T03:00:00.000Z';
const CACHE_CONTROL = 'public, max-age=300';
const STRONG_ETAG = /^"[A-Za-z0-9_-]{43}"$/;
const PATH = '/api/v1/legal/documents/current';

const OLD_TERMS_ID = '01930000-0000-7000-8000-000000000d01';
const TERMS_ID = '01930000-0000-7000-8000-000000000d02';
const PRIVACY_ID = '01930000-0000-7000-8000-000000000d03';
const NEW_TERMS_ID = '01930000-0000-7000-8000-000000000d04';
const FUTURE_PRIVACY_ID = '01930000-0000-7000-8000-000000000d05';
const EN_TERMS_ID = '01930000-0000-7000-8000-000000000d06';
const EN_PRIVACY_ID = '01930000-0000-7000-8000-000000000d07';
const BARE_TERMS_ID = '01930000-0000-7000-8000-000000000d08';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';

const INSERT_DOCUMENT_SQL = `INSERT INTO public.consent_documents
  (id, type, version, locale, content_sha256, content, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)`;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Fixture text with Vietnamese diacritics, so the database hashes the same UTF-8 bytes as Node. */
function fixtureText(label: string): string {
  return `Văn bản mẫu dùng cho kiểm thử, không phải văn bản pháp lý.\n${label}: Điều khoản mẫu.`;
}

interface DocumentRow {
  readonly id: string;
  readonly type: 'TERMS_OF_SERVICE' | 'PRIVACY_POLICY';
  readonly version: string;
  readonly locale?: string;
  readonly publishedAt: string;
  /** `null` inserts a row without text (published before migration 0012). */
  readonly content?: string | null;
}

interface DocumentBody {
  id: string;
  type: string;
  version: string;
  locale: string;
  publishedAt: string;
  contentSha256: string;
  content: string;
}

function documentsOf(response: TestResponse): DocumentBody[] {
  return (response.body as { documents: DocumentBody[] }).documents;
}

describe('legal documents (migration 0012, GET /legal/documents/current)', () => {
  let migrator: RoleClient;
  let appRole: RoleClient;

  function insertDocument(row: DocumentRow, client: RoleClient = migrator): Promise<unknown> {
    const content = row.content === undefined ? fixtureText(row.version) : row.content;
    return client.query(INSERT_DOCUMENT_SQL, [
      row.id,
      row.type,
      row.version,
      row.locale ?? 'vi',
      sha256Hex(content ?? row.version),
      content,
      row.publishedAt,
    ]);
  }

  beforeAll(async () => {
    migrator = await openRoleClient('kd_migrator');
    appRole = await openAppRole();
  });

  afterAll(async () => {
    await appRole.close();
    await migrator.close();
  });

  beforeEach(async () => {
    await truncateAll();
    await insertDocument({
      id: OLD_TERMS_ID,
      type: 'TERMS_OF_SERVICE',
      // A higher version string than the current one: the order is published_at, never version.
      version: '9',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    await insertDocument({
      id: TERMS_ID,
      type: 'TERMS_OF_SERVICE',
      version: '10',
      publishedAt: '2026-10-01T00:00:00Z',
    });
    await insertDocument({
      id: PRIVACY_ID,
      type: 'PRIVACY_POLICY',
      version: '1',
      publishedAt: '2026-10-01T00:00:00Z',
    });
    await insertDocument({
      id: FUTURE_PRIVACY_ID,
      type: 'PRIVACY_POLICY',
      version: '2',
      publishedAt: '2027-01-01T00:00:00Z',
    });
  });

  describe('the content column', () => {
    it('stores a text whose content_sha256 is the SHA-256 of its UTF-8 bytes', async () => {
      const rows = await migrator.query<{ content: string; content_sha256: string }>(
        'SELECT content, content_sha256 FROM public.consent_documents WHERE id = $1',
        [TERMS_ID],
      );

      expect(rows[0]?.content).toBe(fixtureText('10'));
      expect(rows[0]?.content_sha256).toBe(sha256Hex(fixtureText('10')));
    });

    it('refuses a text that does not match content_sha256', async () => {
      await expectSqlState(
        migrator.query(INSERT_DOCUMENT_SQL, [
          NEW_TERMS_ID,
          'TERMS_OF_SERVICE',
          '11',
          'vi',
          sha256Hex(fixtureText('11')),
          `${fixtureText('11')} `,
          '2026-11-01T00:00:00Z',
        ]),
        CHECK_VIOLATION,
      );
    });

    it('is nullable, so a row published before the column existed stays valid', async () => {
      await insertDocument({
        id: BARE_TERMS_ID,
        type: 'TERMS_OF_SERVICE',
        version: 'smoke-1',
        publishedAt: '2025-01-01T00:00:00Z',
        content: null,
      });

      const rows = await migrator.query<{ content: string | null }>(
        'SELECT content FROM public.consent_documents WHERE id = $1',
        [BARE_TERMS_ID],
      );
      expect(rows).toEqual([{ content: null }]);
    });
  });

  describe('kd_app privileges', () => {
    it('has SELECT and INSERT only: no UPDATE, no DELETE, no TRUNCATE', async () => {
      const rows = await appRole.query<{ privilege: string }>(
        `SELECT p AS privilege FROM unnest($1::text[]) AS p
          WHERE has_table_privilege('kd_app', 'public.consent_documents', p)
          ORDER BY p`,
        [['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']],
      );

      expect(rows.map((row) => row.privilege)).toEqual(['INSERT', 'SELECT']);
    });

    it('cannot change the text of a published document or delete it', async () => {
      await appRole.expectPermissionDenied(
        "UPDATE public.consent_documents SET content = 'đổi' WHERE id = $1",
        [TERMS_ID],
      );
      await appRole.expectPermissionDenied('DELETE FROM public.consent_documents WHERE id = $1', [
        TERMS_ID,
      ]);
    });

    it('is also held to the hash CHECK when it inserts', async () => {
      await expectSqlState(
        appRole.query(INSERT_DOCUMENT_SQL, [
          NEW_TERMS_ID,
          'TERMS_OF_SERVICE',
          '11',
          'vi',
          'a'.repeat(64),
          fixtureText('11'),
          '2026-11-01T00:00:00Z',
        ]),
        CHECK_VIOLATION,
      );
    });
  });

  describe('endpoint', () => {
    let testApp: TestApp | undefined;
    let client: TestHttpClient;

    beforeAll(async () => {
      testApp = await createTestApp({ clock: new FixedClock(NOW) });
      client = http(testApp.baseUrl);
    });

    afterAll(async () => {
      await testApp?.close();
    });

    it('returns the newest published document of each type, without a token', async () => {
      const response = await client.get(PATH);

      expect(response.status).toBe(200);
      expect(documentsOf(response)).toEqual([
        {
          id: TERMS_ID,
          type: 'TERMS_OF_SERVICE',
          version: '10',
          locale: 'vi',
          publishedAt: '2026-10-01T00:00:00.000Z',
          contentSha256: sha256Hex(fixtureText('10')),
          content: fixtureText('10'),
        },
        {
          id: PRIVACY_ID,
          type: 'PRIVACY_POLICY',
          version: '1',
          locale: 'vi',
          publishedAt: '2026-10-01T00:00:00.000Z',
          contentSha256: sha256Hex(fixtureText('1')),
          content: fixtureText('1'),
        },
      ]);
      expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL);
      expect(response.headers.get('etag')).toMatch(STRONG_ETAG);
    });

    it('answers 304 without a body when If-None-Match matches', async () => {
      const first = await client.get(PATH);
      const etag = first.headers.get('etag') ?? '';

      // Node's fetch adds `Cache-Control: no-cache` to a request with `If-None-Match` unless one is
      // set, and Express answers such an end-to-end reload with 200 (see geo.int-spec.ts).
      // `max-age=0` is what a revalidating cache sends.
      const second = await client.get(PATH, {
        headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' },
      });

      expect(second.status).toBe(304);
      expect(second.body).toBeNull();
      expect(second.headers.get('etag')).toBe(etag);
    });

    it('serves a newer row in place of the older one without a restart', async () => {
      const before = await client.get(PATH);

      await insertDocument({
        id: NEW_TERMS_ID,
        type: 'TERMS_OF_SERVICE',
        version: '11',
        publishedAt: '2026-11-01T00:00:00Z',
      });
      const after = await client.get(PATH);

      expect(after.status).toBe(200);
      expect(documentsOf(after).map((document) => document.id)).toEqual([NEW_TERMS_ID, PRIVACY_ID]);
      expect(after.headers.get('etag')).not.toBe(before.headers.get('etag'));
    });

    it('falls back to vi for a locale without documents and serves a locale that has them', async () => {
      const fallback = await client.get(`${PATH}?locale=en`);
      expect(fallback.status).toBe(200);
      expect(documentsOf(fallback).map((document) => [document.id, document.locale])).toEqual([
        [TERMS_ID, 'vi'],
        [PRIVACY_ID, 'vi'],
      ]);

      await insertDocument({
        id: EN_TERMS_ID,
        type: 'TERMS_OF_SERVICE',
        version: 'en-1',
        locale: 'en',
        publishedAt: '2026-10-15T00:00:00Z',
      });
      await insertDocument({
        id: EN_PRIVACY_ID,
        type: 'PRIVACY_POLICY',
        version: 'en-1',
        locale: 'en',
        publishedAt: '2026-10-15T00:00:00Z',
      });
      const english = await client.get(`${PATH}?locale=en`);
      expect(documentsOf(english).map((document) => [document.id, document.locale])).toEqual([
        [EN_TERMS_ID, 'en'],
        [EN_PRIVACY_ID, 'en'],
      ]);
    });

    it('skips a newest document without text: the type is missing, NOT_FOUND', async () => {
      await insertDocument({
        id: BARE_TERMS_ID,
        type: 'TERMS_OF_SERVICE',
        version: 'smoke-2',
        publishedAt: '2026-11-01T00:00:00Z',
        content: null,
      });

      const response = await client.get(PATH);

      expect(response.status).toBe(404);
      expect(response.problem?.code).toBe('NOT_FOUND');
      expect(response.headers.get('cache-control')).not.toBe(CACHE_CONTROL);
      // Express puts its own weak tag on every body, errors included; the strong tag of the
      // documents is set on a success only.
      expect(response.headers.get('etag') ?? '').not.toMatch(STRONG_ETAG);
    });

    it('is NOT_FOUND when a type has no published document', async () => {
      await truncateAll();
      await insertDocument({
        id: TERMS_ID,
        type: 'TERMS_OF_SERVICE',
        version: '10',
        publishedAt: '2026-10-01T00:00:00Z',
      });

      const response = await client.get(PATH);

      expect(response.status).toBe(404);
      expect(response.problem?.code).toBe('NOT_FOUND');
    });

    it('refuses a malformed locale and an unknown query parameter', async () => {
      for (const path of [`${PATH}?locale=VI%20`, `${PATH}?locale=`, `${PATH}?version=1`]) {
        const response = await client.get(path);

        expect(response.status, path).toBe(400);
        expect(response.problem?.code, path).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('registration', () => {
    let testApp: TestApp;
    let client: TestHttpClient;

    beforeEach(async () => {
      // A fresh app per test: the register throttle counts per IP for an hour.
      testApp = await createTestApp({ clock: new FixedClock(NOW) });
      client = http(testApp.baseUrl);
    });

    afterEach(async () => {
      await testApp.close();
    });

    function register(acceptedDocumentIds: readonly string[]): Promise<TestResponse> {
      return client.post('/api/v1/auth/register', {
        email: 'fixture-legal@kd.example',
        password: PASSPHRASE,
        displayName: 'Người dùng mẫu',
        acceptedDocumentIds,
      });
    }

    it('accepts exactly the ids the endpoint returns and records them', async () => {
      const ids = documentsOf(await client.get(PATH)).map((document) => document.id);

      const response = await register(ids);

      expect(response.status).toBe(201);
      const consents = await migrator.query<{ document_id: string }>(
        'SELECT document_id FROM public.user_consents ORDER BY document_id',
      );
      expect(consents.map((row) => row.document_id)).toEqual([...ids].sort());
    });

    it('refuses an id the endpoint no longer returns', async () => {
      const response = await register([OLD_TERMS_ID, PRIVACY_ID]);

      expect(response.status).toBe(400);
      expect(response.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'acceptedDocumentIds', code: 'INVALID' }],
      });
    });
  });
});
