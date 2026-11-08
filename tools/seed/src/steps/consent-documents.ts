import { createHash } from 'node:crypto';

import { IntegrityError } from './step.js';
import type { SeedStep, SqlClient, TableCounts } from './step.js';

// The `consent-documents` step of `seed reference` (api migrations `0008` and
// `0012_consent_document_content.sql`; A4-T4; api-divergences D-126). Two sources, never both:
//
// - by default, the committed placeholder file: a type gets its placeholder only when no document
//   of that type and locale has text (rows inserted before migration 0012 have none). The
//   placeholder is NOT legal text (migration-plan open item 3);
// - with `SEED_CONSENT_DOCUMENTS_FILE`, the owner's real documents from private storage, supplied
//   at deploy time and never committed (migration-plan principle 4): each (type, version, locale)
//   is inserted once, and a version already published with another text is refused.
//
// A published row is never changed or deleted: a new version is a new row, and the latest
// `published_at` is current (A4-T4).

/** `tools/seed/data/consent-documents.placeholder.json`, from `dist/steps/` or `src/steps/`. */
export const CONSENT_DOCUMENTS_FILE = new URL(
  '../../data/consent-documents.placeholder.json',
  import.meta.url,
);

/** `public.consent_document_type` (migration 0008), in its order. */
export const CONSENT_DOCUMENT_TYPES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'] as const;
export type ConsentDocumentType = (typeof CONSENT_DOCUMENT_TYPES)[number];

/**
 * The marker of a placeholder version: the same prefix as `PLACEHOLDER_VERSION_PREFIX` of
 * apps/api/src/modules/legal/legal.service.ts (A4-T4), repeated because `@kd/seed` may not import
 * `@kd/api` (decision 0003 section 6).
 */
export const PLACEHOLDER_VERSION_PREFIX = 'placeholder-';

/** The first line of every placeholder text: in Vietnamese, "placeholder, not legal text". */
export const PLACEHOLDER_FIRST_LINE =
  'VĂN BẢN GIỮ CHỖ: đây không phải văn bản pháp lý và không có giá trị áp dụng.';

/** True for a placeholder document; the same rule as `isPlaceholderDocument` of the API. */
export function isPlaceholderDocument(version: string): boolean {
  return version.startsWith(PLACEHOLDER_VERSION_PREFIX);
}

export interface ConsentDocumentRow {
  readonly type: ConsentDocumentType;
  readonly locale: string;
  readonly version: string;
  readonly content: string;
  /** Lower-case hex SHA-256 of the UTF-8 text; the `CHECK` of migration 0012 checks it again. */
  readonly contentSha256: string;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstLine(text: string): string {
  return text.split(/\r\n|\r|\n/u, 1)[0] ?? '';
}

/**
 * Maps and checks the placeholder file: one row per type, locale `vi`, a `placeholder-` version and
 * a text whose first line is `PLACEHOLDER_FIRST_LINE`. Throws `IntegrityError` (exit 4).
 */
export function parseConsentDocuments(json: unknown): ConsentDocumentRow[] {
  const file = 'consent-documents.placeholder.json';
  if (!isRecord(json) || !Array.isArray(json['rows'])) {
    throw new IntegrityError(`${file}: expected an object with a rows array`);
  }
  const rows = json['rows'].map((row: unknown, index): ConsentDocumentRow => {
    const where = `${file} row ${index + 1}`;
    if (!isRecord(row)) {
      throw new IntegrityError(`${where}: expected an object`);
    }
    const { type, locale, version, content } = row;
    if (typeof type !== 'string' || !(CONSENT_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      throw new IntegrityError(`${where}: type must be one of ${CONSENT_DOCUMENT_TYPES.join('|')}`);
    }
    if (locale !== 'vi') {
      throw new IntegrityError(`${where}: locale must be vi`);
    }
    if (typeof version !== 'string' || !isPlaceholderDocument(version)) {
      throw new IntegrityError(`${where}: version must start with ${PLACEHOLDER_VERSION_PREFIX}`);
    }
    if (typeof content !== 'string' || firstLine(content) !== PLACEHOLDER_FIRST_LINE) {
      throw new IntegrityError(`${where}: the first line must be the placeholder marker`);
    }
    return {
      type: type as ConsentDocumentType,
      locale,
      version,
      content,
      contentSha256: sha256Hex(content),
    };
  });
  for (const type of CONSENT_DOCUMENT_TYPES) {
    const count = rows.filter((row) => row.type === type).length;
    if (count !== 1) {
      throw new IntegrityError(`${file}: expected one ${type} row, found ${count}`);
    }
  }
  return rows;
}

/** The types that already have a document with text in a locale, whatever its version. */
export const SELECT_DOCUMENT_TYPES_SQL = `SELECT DISTINCT type::text AS type, locale
  FROM public.consent_documents
 WHERE locale = ANY($1) AND content IS NOT NULL`;

/**
 * Inserts a placeholder only when its type has no document with text in its locale; a row without
 * text (published before migration 0012) does not count, so the placeholder becomes current over
 * it. `published_at` is the transaction time. Never an `UPDATE`: published rows are immutable
 * (api-divergences D-036).
 */
export const INSERT_DOCUMENTS_SQL = `INSERT INTO public.consent_documents
  (type, version, locale, content_sha256, content, published_at)
SELECT t.type, t.version, t.locale, t.content_sha256, t.content, now()
  FROM unnest($1::public.consent_document_type[], $2::text[], $3::text[], $4::text[], $5::text[])
       AS t(type, version, locale, content_sha256, content)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.consent_documents d
    WHERE d.type = t.type AND d.locale = t.locale AND d.content IS NOT NULL
 )
RETURNING id`;

/** Counts: a row whose type has a document with text in its locale is unchanged, the others inserted. */
export function planDocuments(
  rows: readonly ConsentDocumentRow[],
  stored: readonly { type: string; locale: string }[],
): TableCounts {
  const present = new Set(stored.map((row) => `${row.type}:${row.locale}`));
  const unchanged = rows.filter((row) => present.has(`${row.type}:${row.locale}`)).length;
  return {
    table: 'consent_documents',
    inserted: rows.length - unchanged,
    updated: 0,
    unchanged,
    stale: 0,
    staleSample: [],
    ...(rows.length - unchanged > 0 ? { note: 'placeholder text, not legal text' } : {}),
  };
}

/** The placeholder step. `load` returns the parsed JSON of the placeholder file; called once. */
export function createConsentDocumentsStep(load: () => Promise<unknown>): SeedStep {
  let rows: Promise<ConsentDocumentRow[]> | undefined;
  const source = () => {
    rows ??= load().then(parseConsentDocuments);
    return rows;
  };

  return {
    name: 'consent-documents',

    async plan(client: SqlClient): Promise<readonly TableCounts[]> {
      const documents = await source();
      const locales = [...new Set(documents.map((row) => row.locale))];
      const stored = await client.query<{ type: string; locale: string }>(
        SELECT_DOCUMENT_TYPES_SQL,
        [locales],
      );
      return [planDocuments(documents, stored.rows)];
    },

    async apply(client: SqlClient): Promise<ReadonlyMap<string, number>> {
      const documents = await source();
      const result = await client.query(INSERT_DOCUMENTS_SQL, [
        documents.map((row) => row.type),
        documents.map((row) => row.version),
        documents.map((row) => row.locale),
        documents.map((row) => row.contentSha256),
        documents.map((row) => row.content),
      ]);
      return new Map([['consent_documents', result.rows.length]]);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Real documents from `SEED_CONSENT_DOCUMENTS_FILE` (api-divergences D-126).
// ---------------------------------------------------------------------------------------------

/**
 * The only locale accepted for a real document: registration accepts the `vi` documents only
 * (api-divergences D-120), so a published document in another locale would show ids that
 * `POST /auth/register` refuses.
 */
export const PUBLISHED_LOCALES: readonly string[] = ['vi'];
/** A version is free text, never compared (A4-T4); this bounds it for the report and the index. */
export const VERSION_MAX_LENGTH = 50;

/**
 * Maps and checks the owner's file (same shape as the placeholder file): at least one row; each a
 * known type, locale `vi`, a version of 1 to 50 characters that is not a placeholder, a non-blank
 * text whose first line is not the placeholder marker; no (type, version, locale) twice. Throws
 * `IntegrityError` (exit 4) naming the row, never its text.
 */
export function parsePublishedDocuments(json: unknown): ConsentDocumentRow[] {
  const file = 'SEED_CONSENT_DOCUMENTS_FILE';
  if (!isRecord(json) || !Array.isArray(json['rows']) || json['rows'].length === 0) {
    throw new IntegrityError(`${file}: expected an object with a non-empty rows array`);
  }
  const rows = json['rows'].map((row: unknown, index): ConsentDocumentRow => {
    const where = `${file} row ${index + 1}`;
    if (!isRecord(row)) {
      throw new IntegrityError(`${where}: expected an object`);
    }
    const { type, locale, version, content } = row;
    if (typeof type !== 'string' || !(CONSENT_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      throw new IntegrityError(`${where}: type must be one of ${CONSENT_DOCUMENT_TYPES.join('|')}`);
    }
    if (typeof locale !== 'string' || !PUBLISHED_LOCALES.includes(locale)) {
      throw new IntegrityError(`${where}: locale must be one of ${PUBLISHED_LOCALES.join('|')}`);
    }
    if (
      typeof version !== 'string' ||
      version.trim() === '' ||
      version.length > VERSION_MAX_LENGTH ||
      isPlaceholderDocument(version)
    ) {
      throw new IntegrityError(
        `${where}: version must be 1 to ${VERSION_MAX_LENGTH} characters and not start with ${PLACEHOLDER_VERSION_PREFIX}`,
      );
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new IntegrityError(`${where}: content must be a non-blank text`);
    }
    if (firstLine(content) === PLACEHOLDER_FIRST_LINE) {
      throw new IntegrityError(`${where}: content is the placeholder text`);
    }
    return {
      type: type as ConsentDocumentType,
      locale,
      version,
      content,
      contentSha256: sha256Hex(content),
    };
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const id = `${row.type}:${row.version}:${row.locale}`;
    if (seen.has(id)) {
      throw new IntegrityError(`${file}: ${row.type} version ${row.version} appears twice`);
    }
    seen.add(id);
  }
  return rows;
}

interface StoredVersion {
  type: string;
  version: string;
  locale: string;
  content_sha256: string;
  has_content: boolean;
}

export const SELECT_DOCUMENT_VERSIONS_SQL = `SELECT type::text AS type, version, locale, content_sha256,
       content IS NOT NULL AS has_content
  FROM public.consent_documents
 WHERE locale = ANY($1)`;

/**
 * Inserts each (type, version, locale) once, with `published_at` the transaction time, so it
 * becomes current. The unique constraint of migration 0008 makes a re-run insert nothing.
 */
export const INSERT_PUBLISHED_DOCUMENTS_SQL = `INSERT INTO public.consent_documents
  (type, version, locale, content_sha256, content, published_at)
SELECT t.type, t.version, t.locale, t.content_sha256, t.content, now()
  FROM unnest($1::public.consent_document_type[], $2::text[], $3::text[], $4::text[], $5::text[])
       AS t(type, version, locale, content_sha256, content)
ON CONFLICT (type, version, locale) DO NOTHING
RETURNING id`;

/**
 * Counts: a version not stored is inserted; one stored with the same hash and a text is unchanged.
 * A version stored with another text, or without text, is refused (`IntegrityError`, exit 4): a
 * published document never changes, so a new text needs a new version.
 */
export function planPublishedDocuments(
  rows: readonly ConsentDocumentRow[],
  stored: readonly StoredVersion[],
): TableCounts {
  const byId = new Map(stored.map((row) => [`${row.type}:${row.version}:${row.locale}`, row]));
  let inserted = 0;
  let unchanged = 0;
  for (const row of rows) {
    const current = byId.get(`${row.type}:${row.version}:${row.locale}`);
    if (current === undefined) {
      inserted += 1;
    } else if (current.has_content && current.content_sha256 === row.contentSha256) {
      unchanged += 1;
    } else {
      throw new IntegrityError(
        `consent-documents: ${row.type} version ${row.version} (${row.locale}) is already published with another text; publish a new version`,
      );
    }
  }
  return {
    table: 'consent_documents',
    inserted,
    updated: 0,
    unchanged,
    stale: 0,
    staleSample: [],
    ...(inserted > 0 ? { note: 'documents from SEED_CONSENT_DOCUMENTS_FILE' } : {}),
  };
}

/** The step with the owner's file. `load` returns its parsed JSON; it is called once. */
export function createPublishedDocumentsStep(load: () => Promise<unknown>): SeedStep {
  let rows: Promise<ConsentDocumentRow[]> | undefined;
  const source = () => {
    rows ??= load().then(parsePublishedDocuments);
    return rows;
  };

  return {
    name: 'consent-documents',

    async plan(client: SqlClient): Promise<readonly TableCounts[]> {
      const documents = await source();
      const locales = [...new Set(documents.map((row) => row.locale))];
      const stored = await client.query<StoredVersion>(SELECT_DOCUMENT_VERSIONS_SQL, [locales]);
      return [planPublishedDocuments(documents, stored.rows)];
    },

    async apply(client: SqlClient): Promise<ReadonlyMap<string, number>> {
      const documents = await source();
      const result = await client.query(INSERT_PUBLISHED_DOCUMENTS_SQL, [
        documents.map((row) => row.type),
        documents.map((row) => row.version),
        documents.map((row) => row.locale),
        documents.map((row) => row.contentSha256),
        documents.map((row) => row.content),
      ]);
      return new Map([['consent_documents', result.rows.length]]);
    },
  };
}
