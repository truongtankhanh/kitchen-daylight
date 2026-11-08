import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CONSENT_DOCUMENTS_FILE,
  createConsentDocumentsStep,
  createPublishedDocumentsStep,
  INSERT_DOCUMENTS_SQL,
  INSERT_PUBLISHED_DOCUMENTS_SQL,
  isPlaceholderDocument,
  parseConsentDocuments,
  parsePublishedDocuments,
  PLACEHOLDER_FIRST_LINE,
  planDocuments,
  planPublishedDocuments,
  SELECT_DOCUMENT_TYPES_SQL,
  SELECT_DOCUMENT_VERSIONS_SQL,
  sha256Hex,
} from './consent-documents.js';
import { IntegrityError } from './step.js';
import type { SqlClient } from './step.js';

const FILE_JSON = JSON.parse(readFileSync(CONSENT_DOCUMENTS_FILE, 'utf8')) as {
  rows: Record<string, unknown>[];
};

function placeholder(type: string, overrides: Record<string, unknown> = {}) {
  return {
    type,
    locale: 'vi',
    version: 'placeholder-1',
    content: `${PLACEHOLDER_FIRST_LINE}\nNội dung mẫu.`,
    ...overrides,
  };
}

/** A client that records statements; `stored` answers the SELECT, the INSERT skips stored types. */
function fakeClient(stored: readonly { type: string; locale: string }[]) {
  const statements: { text: string; values: readonly unknown[] | undefined }[] = [];
  const client: SqlClient = {
    query: async <Row>(text: string, values?: readonly unknown[]) => {
      statements.push({ text, values });
      if (text === SELECT_DOCUMENT_TYPES_SQL) {
        return { rows: [...stored] as Row[] };
      }
      if (text === INSERT_DOCUMENTS_SQL) {
        const types = (values?.[0] ?? []) as string[];
        const locales = (values?.[2] ?? []) as string[];
        const rows = types
          .map((type, index) => ({ type, locale: locales[index] }))
          .filter((row) => !stored.some((s) => s.type === row.type && s.locale === row.locale))
          .map((_, index) => ({ id: `id-${index}` }));
        return { rows: rows as Row[] };
      }
      return { rows: [] as Row[] };
    },
  };
  return { client, statements };
}

describe('isPlaceholderDocument', () => {
  it('is true only for a version starting with placeholder-, as the API helper', () => {
    expect(isPlaceholderDocument('placeholder-1')).toBe(true);
    expect(isPlaceholderDocument('1.0')).toBe(false);
    expect(isPlaceholderDocument('Placeholder-1')).toBe(false);
  });
});

describe('parseConsentDocuments', () => {
  it('reads one placeholder per type for vi, with the SHA-256 of the UTF-8 text', () => {
    const rows = parseConsentDocuments(FILE_JSON);

    expect(rows.map((row) => [row.type, row.locale, row.version])).toEqual([
      ['TERMS_OF_SERVICE', 'vi', 'placeholder-1'],
      ['PRIVACY_POLICY', 'vi', 'placeholder-1'],
    ]);
    for (const row of rows) {
      expect(row.content.split('\n')[0]).toBe(PLACEHOLDER_FIRST_LINE);
      expect(row.contentSha256).toBe(
        createHash('sha256').update(row.content, 'utf8').digest('hex'),
      );
      expect(row.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it.each([
    ['no rows array', { rows: {} }, 'expected an object with a rows array'],
    ['an unknown type', { rows: [placeholder('COOKIES')] }, 'type must be one of'],
    [
      'another locale',
      { rows: [placeholder('TERMS_OF_SERVICE', { locale: 'en' })] },
      'locale must be vi',
    ],
    [
      'a real version',
      { rows: [placeholder('TERMS_OF_SERVICE', { version: '1.0' })] },
      'version must start with placeholder-',
    ],
    [
      'a text without the marker line',
      { rows: [placeholder('TERMS_OF_SERVICE', { content: 'Điều khoản.' })] },
      'the first line must be the placeholder marker',
    ],
    [
      'a missing type',
      { rows: [placeholder('TERMS_OF_SERVICE')] },
      'expected one PRIVACY_POLICY row, found 0',
    ],
    [
      'a repeated type',
      {
        rows: [
          placeholder('TERMS_OF_SERVICE'),
          placeholder('TERMS_OF_SERVICE'),
          placeholder('PRIVACY_POLICY'),
        ],
      },
      'expected one TERMS_OF_SERVICE row, found 2',
    ],
  ])('refuses %s with an IntegrityError', (_case, json, message) => {
    expect(() => parseConsentDocuments(json)).toThrow(IntegrityError);
    expect(() => parseConsentDocuments(json)).toThrow(message);
  });
});

describe('planDocuments', () => {
  const rows = parseConsentDocuments(FILE_JSON);

  it('inserts both types into an empty table and marks them as placeholders', () => {
    expect(planDocuments(rows, [])).toMatchObject({
      inserted: 2,
      unchanged: 0,
      note: 'placeholder text, not legal text',
    });
  });

  it('leaves a type that already has a document in vi, whatever its version or text', () => {
    expect(planDocuments(rows, [{ type: 'TERMS_OF_SERVICE', locale: 'vi' }])).toMatchObject({
      inserted: 1,
      updated: 0,
      unchanged: 1,
    });
    expect(planDocuments(rows, [{ type: 'TERMS_OF_SERVICE', locale: 'en' }])).toMatchObject({
      inserted: 2,
    });
  });
});

describe('createConsentDocumentsStep', () => {
  const step = () => createConsentDocumentsStep(async () => FILE_JSON);

  it('plans with one SELECT of the vi types', async () => {
    const { client, statements } = fakeClient([{ type: 'PRIVACY_POLICY', locale: 'vi' }]);

    const planned = await step().plan(client);

    expect(planned[0]).toMatchObject({ table: 'consent_documents', inserted: 1, unchanged: 1 });
    expect(statements).toEqual([{ text: SELECT_DOCUMENT_TYPES_SQL, values: [['vi']] }]);
  });

  it('applies one guarded INSERT with the type, version, locale, hash and text of each row', async () => {
    const { client, statements } = fakeClient([]);

    const applied = await step().apply(client);

    expect(applied.get('consent_documents')).toBe(2);
    const values = statements[0]?.values ?? [];
    expect(values[0]).toEqual(['TERMS_OF_SERVICE', 'PRIVACY_POLICY']);
    expect(values[1]).toEqual(['placeholder-1', 'placeholder-1']);
    expect(values[2]).toEqual(['vi', 'vi']);
    expect((values[3] as string[]).every((hash) => /^[0-9a-f]{64}$/u.test(hash))).toBe(true);
    expect((values[4] as string[]).every((text) => text.startsWith(PLACEHOLDER_FIRST_LINE))).toBe(
      true,
    );
  });

  it('counts only documents with text: a row from before migration 0012 does not block', () => {
    expect(SELECT_DOCUMENT_TYPES_SQL).toContain('content IS NOT NULL');
    expect(INSERT_DOCUMENTS_SQL).toContain('d.content IS NOT NULL');
  });

  it('never changes a published row: only a guarded INSERT, no UPDATE, no DELETE', () => {
    expect(INSERT_DOCUMENTS_SQL).toContain('WHERE NOT EXISTS');
    expect(INSERT_DOCUMENTS_SQL).not.toMatch(/\b(UPDATE|DELETE)\b/u);
  });

  it('a re-run changes nothing', async () => {
    const stored = [
      { type: 'TERMS_OF_SERVICE', locale: 'vi' },
      { type: 'PRIVACY_POLICY', locale: 'vi' },
    ];
    const { client } = fakeClient(stored);
    const seeded = step();

    expect((await seeded.plan(client))[0]).toMatchObject({ inserted: 0, unchanged: 2 });
    expect((await seeded.apply(client)).get('consent_documents')).toBe(0);
  });
});

// The owner's real documents (SEED_CONSENT_DOCUMENTS_FILE). Fictional text, not legal text.

function realDocument(type: string, overrides: Record<string, unknown> = {}) {
  return {
    type,
    locale: 'vi',
    version: '2026-12-01',
    content: `Văn bản mẫu của ${type}.\nNội dung kiểm thử.`,
    ...overrides,
  };
}

const OWNER_JSON = {
  rows: [realDocument('TERMS_OF_SERVICE'), realDocument('PRIVACY_POLICY')],
};

describe('parsePublishedDocuments', () => {
  it('reads real documents with the SHA-256 of their text', () => {
    const rows = parsePublishedDocuments(OWNER_JSON);

    expect(rows.map((row) => [row.type, row.version, row.locale])).toEqual([
      ['TERMS_OF_SERVICE', '2026-12-01', 'vi'],
      ['PRIVACY_POLICY', '2026-12-01', 'vi'],
    ]);
    expect(rows[0]?.contentSha256).toBe(sha256Hex(rows[0]?.content ?? ''));
  });

  it('accepts one type alone: a later version of one document only', () => {
    expect(parsePublishedDocuments({ rows: [realDocument('PRIVACY_POLICY')] })).toHaveLength(1);
  });

  it.each([
    ['no rows', { rows: [] }, 'non-empty rows array'],
    ['an unknown type', { rows: [realDocument('COOKIES')] }, 'type must be one of'],
    [
      'another locale (registration accepts vi only)',
      { rows: [realDocument('TERMS_OF_SERVICE', { locale: 'en' })] },
      'locale must be one of vi',
    ],
    [
      'a placeholder version',
      { rows: [realDocument('TERMS_OF_SERVICE', { version: 'placeholder-2' })] },
      'not start with placeholder-',
    ],
    [
      'a blank version',
      { rows: [realDocument('TERMS_OF_SERVICE', { version: ' ' })] },
      'version must be 1 to 50 characters',
    ],
    [
      'the placeholder text',
      {
        rows: [realDocument('TERMS_OF_SERVICE', { content: `${PLACEHOLDER_FIRST_LINE}\nx` })],
      },
      'content is the placeholder text',
    ],
    [
      'a blank text',
      { rows: [realDocument('TERMS_OF_SERVICE', { content: '  ' })] },
      'content must be a non-blank text',
    ],
    [
      'the same version twice',
      { rows: [realDocument('TERMS_OF_SERVICE'), realDocument('TERMS_OF_SERVICE')] },
      'TERMS_OF_SERVICE version 2026-12-01 appears twice',
    ],
  ])('refuses %s with an IntegrityError', (_case, json, message) => {
    expect(() => parsePublishedDocuments(json)).toThrow(IntegrityError);
    expect(() => parsePublishedDocuments(json)).toThrow(message);
  });

  it('never puts the text in an error', () => {
    const json = { rows: [realDocument('TERMS_OF_SERVICE', { locale: 'S3cr3t-Value' })] };
    try {
      parsePublishedDocuments({
        rows: [realDocument('TERMS_OF_SERVICE', { content: 'S3cr3t-Value', version: '' })],
      });
    } catch (error) {
      expect(String(error)).not.toContain('S3cr3t-Value');
    }
    expect(() => parsePublishedDocuments(json)).not.toThrow(/S3cr3t-Value/u);
  });
});

describe('planPublishedDocuments', () => {
  const rows = parsePublishedDocuments(OWNER_JSON);
  const stored = (row: (typeof rows)[number], overrides: Record<string, unknown> = {}) => ({
    type: row.type,
    version: row.version,
    locale: row.locale,
    content_sha256: row.contentSha256,
    has_content: true,
    ...overrides,
  });

  it('inserts a version that is not stored, even over a placeholder', () => {
    const placeholderRow = {
      type: 'TERMS_OF_SERVICE',
      version: 'placeholder-1',
      locale: 'vi',
      content_sha256: 'a'.repeat(64),
      has_content: true,
    };

    expect(planPublishedDocuments(rows, [placeholderRow])).toMatchObject({
      inserted: 2,
      unchanged: 0,
      note: 'documents from SEED_CONSENT_DOCUMENTS_FILE',
    });
  });

  it('leaves a version stored with the same text: a re-run changes nothing', () => {
    expect(
      planPublishedDocuments(
        rows,
        rows.map((row) => stored(row)),
      ),
    ).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 2,
    });
  });

  it('refuses a published version whose text changed, or that has no text', () => {
    const first = rows[0];
    if (first === undefined) throw new Error('fixture');

    expect(() =>
      planPublishedDocuments(rows, [stored(first, { content_sha256: 'b'.repeat(64) })]),
    ).toThrow('is already published with another text; publish a new version');
    expect(() => planPublishedDocuments(rows, [stored(first, { has_content: false })])).toThrow(
      IntegrityError,
    );
  });
});

describe('createPublishedDocumentsStep', () => {
  it('plans with one SELECT of the stored versions and inserts with ON CONFLICT DO NOTHING', async () => {
    const statements: { text: string; values: readonly unknown[] | undefined }[] = [];
    const client: SqlClient = {
      query: async <Row>(text: string, values?: readonly unknown[]) => {
        statements.push({ text, values });
        return {
          rows: (text === INSERT_PUBLISHED_DOCUMENTS_SQL
            ? [{ id: 'a' }, { id: 'b' }]
            : []) as Row[],
        };
      },
    };
    const step = createPublishedDocumentsStep(async () => OWNER_JSON);

    const planned = await step.plan(client);
    const applied = await step.apply(client);

    expect(planned[0]).toMatchObject({ inserted: 2 });
    expect(applied.get('consent_documents')).toBe(2);
    expect(statements.map((statement) => statement.text)).toEqual([
      SELECT_DOCUMENT_VERSIONS_SQL,
      INSERT_PUBLISHED_DOCUMENTS_SQL,
    ]);
    expect(statements[0]?.values).toEqual([['vi']]);
    expect(INSERT_PUBLISHED_DOCUMENTS_SQL).toContain(
      'ON CONFLICT (type, version, locale) DO NOTHING',
    );
    expect(INSERT_PUBLISHED_DOCUMENTS_SQL).not.toMatch(/\b(UPDATE|DELETE)\b/u);
  });
});
