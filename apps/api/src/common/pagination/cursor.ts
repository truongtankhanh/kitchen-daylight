import { createHash } from 'node:crypto';

import type { CursorPage } from '@kd/contracts';

import { ApiError } from '../errors/api-error.js';

// Cursor format of decision 0007 section 6: base64url(JSON) of
// `{ "v": 1, "d": "n" | "p", "k": [<sort values>, <id>], "f": "<fingerprint>" }`.
// Unsigned on purpose: the cursor only carries sort-key values used as bound parameters; scoping
// and authorization always come from the token and the request, never from the cursor.

const CURSOR_VERSION = 1;
/** A longer cursor is rejected before it is decoded. */
export const MAX_CURSOR_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO 8601 instant with an offset, up to microseconds (PostgreSQL `timestamptz` precision).
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = ['d', 'f', 'k', 'v'];

/** Type of one sort-key value; the last key of every cursor list is the `uuid` id. */
export type CursorKeyType = 'string' | 'number' | 'timestamp' | 'uuid';
/** A decoded key value: `timestamp` stays the ISO string it was encoded as. */
export type CursorKeyValue = string | number;
/** A value read from a row; a `Date` is encoded as its ISO string. */
export type CursorKeyInput = string | number | Date;
export type CursorDirection = 'next' | 'prev';

/** The boundary row of a page and the direction to read from it. */
export interface Cursor {
  readonly direction: CursorDirection;
  readonly key: readonly CursorKeyValue[];
}

/** What a list expects of its cursors. */
export interface CursorSpec {
  /** Types of the sort-key tuple, for example `['timestamp', 'uuid']` for (`placed_at`, `id`). */
  readonly keyTypes: readonly CursorKeyType[];
  /** `cursorFingerprint` of the list's current filters and sort. */
  readonly fingerprint: string;
}

function invalidCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', {
    errors: [{ field: 'cursor', code: 'INVALID_CURSOR', message: 'is invalid or expired' }],
  });
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, member]) => [name, canonical(member)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * First 16 hex characters of the SHA-256 of the list's canonical filters and sort: object members
 * sorted by name, `undefined` members dropped, dates as ISO strings. Array order is kept, so a
 * list whose array filter is a set (`status[]`) sorts it before calling this.
 */
export function cursorFingerprint(filtersAndSort: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(filtersAndSort)))
    .digest('hex')
    .slice(0, 16);
}

function toKeyValue(value: CursorKeyInput): CursorKeyValue {
  return value instanceof Date ? value.toISOString() : value;
}

/** Encodes the boundary key of a page; the caller passes the list's current fingerprint. */
export function encodeCursor(
  direction: CursorDirection,
  key: readonly CursorKeyInput[],
  fingerprint: string,
): string {
  const body = {
    v: CURSOR_VERSION,
    d: direction === 'next' ? 'n' : 'p',
    k: key.map(toKeyValue),
    f: fingerprint,
  };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

function matchesType(value: unknown, type: CursorKeyType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'timestamp':
      return typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
    case 'uuid':
      return typeof value === 'string' && UUID.test(value);
  }
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Decodes a client cursor. Anything wrong (too long, not base64url JSON, unknown version or
 * direction, wrong key arity or types, a fingerprint of other filters) → `400 VALIDATION_FAILED`
 * with `errors[0] { field: 'cursor', code: 'INVALID_CURSOR' }`; the screen returns to page 1.
 */
export function decodeCursor(raw: string, spec: CursorSpec): Cursor {
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH || !BASE64URL.test(raw)) {
    throw invalidCursor();
  }
  const body = parse(raw);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidCursor();
  }
  const { v, d, k, f } = body as Record<string, unknown>;
  const fields = Object.keys(body).sort();
  if (
    fields.length !== FIELDS.length ||
    fields.some((field, index) => field !== FIELDS[index]) ||
    v !== CURSOR_VERSION ||
    (d !== 'n' && d !== 'p') ||
    f !== spec.fingerprint ||
    !Array.isArray(k) ||
    k.length !== spec.keyTypes.length ||
    !spec.keyTypes.every((type, index) => matchesType(k[index], type))
  ) {
    throw invalidCursor();
  }
  return { direction: d === 'n' ? 'next' : 'prev', key: k as CursorKeyValue[] };
}

/** `items`, `nextCursor` and `prevCursor` of a cursor page; `estimatedTotal` is counted apart. */
export type CursorPageSlice<T> = Pick<CursorPage<T>, 'items' | 'nextCursor' | 'prevCursor'>;

/** How `buildCursorPage` reads the request. */
export interface CursorPageRequest {
  /** The decoded request cursor; absent on the first page. */
  readonly cursor?: Cursor | undefined;
  /** The list's current fingerprint, written into the cursors it returns. */
  readonly fingerprint: string;
}

/**
 * Builds a page from the rows of a keyset query that read `limit + 1` rows from the boundary.
 *
 * - First page or `next`: the query reads in list order after the boundary; the extra row means a
 *   next page exists.
 * - `prev`: the query reads in reverse list order before the boundary; the extra row means a
 *   previous page exists, and the rows are put back in list order here.
 *
 * A page reached through a cursor always has the other direction, from its first or last row. An
 * empty page has no cursor at all.
 */
export function buildCursorPage<T>(
  rows: readonly T[],
  limit: number,
  key: (row: T) => readonly CursorKeyInput[],
  request: CursorPageRequest,
): CursorPageSlice<T> {
  const hasMore = rows.length > limit;
  const read = rows.slice(0, limit);
  const backwards = request.cursor?.direction === 'prev';
  const items = backwards ? read.reverse() : read;
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    return { items, nextCursor: null, prevCursor: null };
  }
  const hasNext = backwards ? true : hasMore;
  const hasPrev = backwards ? hasMore : request.cursor !== undefined;
  return {
    items,
    nextCursor: hasNext ? encodeCursor('next', key(last), request.fingerprint) : null,
    prevCursor: hasPrev ? encodeCursor('prev', key(first), request.fingerprint) : null,
  };
}
