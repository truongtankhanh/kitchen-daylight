import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import {
  MAX_CURSOR_LENGTH,
  buildCursorPage,
  cursorFingerprint,
  decodeCursor,
  encodeCursor,
} from './cursor.js';
import type { CursorSpec } from './cursor.js';

const FILTERS = { from: '2026-10-01', to: '2026-10-31', status: ['PLACED'], sort: 'placed_at' };
const FINGERPRINT = cursorFingerprint(FILTERS);
const SPEC: CursorSpec = { keyTypes: ['timestamp', 'uuid'], fingerprint: FINGERPRINT };
const ID = '0199a3c0-0000-7000-8000-000000000001';
const PLACED_AT = '2026-10-27T03:15:00.123456Z';

function raw(body: unknown): string {
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

function rejection(cursor: string): ApiError {
  try {
    decodeCursor(cursor, SPEC);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected an ApiError');
}

describe('cursorFingerprint', () => {
  it('is 16 hex characters and ignores member order and undefined members', () => {
    expect(FINGERPRINT).toMatch(/^[0-9a-f]{16}$/);
    expect(
      cursorFingerprint({
        sort: 'placed_at',
        status: ['PLACED'],
        to: '2026-10-31',
        from: '2026-10-01',
        q: undefined,
      }),
    ).toBe(FINGERPRINT);
  });

  it('changes with the filters', () => {
    expect(cursorFingerprint({ ...FILTERS, to: '2026-11-01' })).not.toBe(FINGERPRINT);
    expect(cursorFingerprint({ ...FILTERS, status: ['PLACED', 'ACCEPTED'] })).not.toBe(FINGERPRINT);
  });
});

describe('encodeCursor and decodeCursor', () => {
  it('round-trips the direction and the sort-key tuple', () => {
    const next = encodeCursor('next', [PLACED_AT, ID], FINGERPRINT);
    expect(next).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(next, SPEC)).toEqual({ direction: 'next', key: [PLACED_AT, ID] });

    const prev = encodeCursor('prev', [new Date('2026-10-27T03:15:00Z'), ID], FINGERPRINT);
    expect(decodeCursor(prev, SPEC)).toEqual({
      direction: 'prev',
      key: ['2026-10-27T03:15:00.000Z', ID],
    });
  });

  it('writes the format of decision 0007', () => {
    const cursor = encodeCursor('next', [PLACED_AT, ID], FINGERPRINT);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
      v: 1,
      d: 'n',
      k: [PLACED_AT, ID],
      f: FINGERPRINT,
    });
  });

  it('checks string and number keys', () => {
    const spec: CursorSpec = { keyTypes: ['number', 'string', 'uuid'], fingerprint: FINGERPRINT };
    const cursor = encodeCursor('next', [4, 'Phở bò', ID], FINGERPRINT);
    expect(decodeCursor(cursor, spec).key).toEqual([4, 'Phở bò', ID]);
    expect(() =>
      decodeCursor(encodeCursor('next', ['4', 'Phở bò', ID], FINGERPRINT), spec),
    ).toThrow(ApiError);
  });

  it('answers VALIDATION_FAILED with INVALID_CURSOR on the cursor field', () => {
    const error = rejection('nope!');
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(400);
    expect(error.errors).toEqual([
      { field: 'cursor', code: 'INVALID_CURSOR', message: 'is invalid or expired' },
    ]);
  });

  const valid = { v: 1, d: 'n', k: [PLACED_AT, ID], f: FINGERPRINT };

  it.each([
    ['empty', ''],
    ['too long', 'A'.repeat(MAX_CURSOR_LENGTH + 1)],
    ['not base64url', 'abc+/='],
    ['not JSON', Buffer.from('not json').toString('base64url')],
    ['a JSON array', raw([1, 'n'])],
    ['a JSON string', raw('n')],
    ['an unknown version', raw({ ...valid, v: 2 })],
    ['an unknown direction', raw({ ...valid, d: 'x' })],
    ['a missing member', raw({ v: 1, d: 'n', k: [PLACED_AT, ID] })],
    ['an extra member', raw({ ...valid, branchId: ID })],
    ['too few keys', raw({ ...valid, k: [ID] })],
    ['too many keys', raw({ ...valid, k: [PLACED_AT, ID, 1] })],
    ['keys that are not an array', raw({ ...valid, k: PLACED_AT })],
    ['a number for the timestamp', raw({ ...valid, k: [1761534900000, ID] })],
    ['a date with no time', raw({ ...valid, k: ['2026-10-27', ID] })],
    ['an impossible instant', raw({ ...valid, k: ['2026-02-30T25:00:00Z', ID] })],
    ['an id that is not a UUID', raw({ ...valid, k: [PLACED_AT, '42'] })],
    [
      'other filters (expired)',
      raw({ ...valid, f: cursorFingerprint({ ...FILTERS, to: '2026-11-01' }) }),
    ],
  ])('rejects %s', (_case, cursor) => {
    expect(rejection(cursor).errors?.[0]?.code).toBe('INVALID_CURSOR');
  });
});

describe('buildCursorPage', () => {
  interface Row {
    id: string;
    placedAt: Date;
  }

  const rows: Row[] = [1, 2, 3, 4].map((n) => ({
    id: `0199a3c0-0000-7000-8000-00000000000${n}`,
    placedAt: new Date(Date.UTC(2026, 9, 27, 3, n)),
  }));
  const key = (row: Row) => [row.placedAt, row.id] as const;
  const request = { fingerprint: FINGERPRINT };
  const decode = (cursor: string | null) => (cursor === null ? null : decodeCursor(cursor, SPEC));

  it('first page with an extra row: items, a next cursor from the last item, no previous', () => {
    const page = buildCursorPage(rows, 3, key, request);
    expect(page.items).toEqual(rows.slice(0, 3));
    expect(decode(page.nextCursor)).toEqual({
      direction: 'next',
      key: [rows[2]?.placedAt.toISOString(), rows[2]?.id],
    });
    expect(page.prevCursor).toBeNull();
  });

  it('first page with no extra row: no cursor', () => {
    const page = buildCursorPage(rows.slice(0, 3), 3, key, request);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    expect(page.prevCursor).toBeNull();
  });

  it('next page: a previous cursor from the first item, a next one only with the extra row', () => {
    const cursor = { direction: 'next', key: [PLACED_AT, ID] } as const;
    const middle = buildCursorPage(rows, 3, key, { ...request, cursor });
    expect(decode(middle.prevCursor)).toEqual({
      direction: 'prev',
      key: [rows[0]?.placedAt.toISOString(), rows[0]?.id],
    });
    expect(middle.nextCursor).not.toBeNull();

    const last = buildCursorPage(rows.slice(0, 2), 3, key, { ...request, cursor });
    expect(last.items).toEqual(rows.slice(0, 2));
    expect(last.nextCursor).toBeNull();
    expect(last.prevCursor).not.toBeNull();
  });

  it('previous page: rows read in reverse are put back in list order', () => {
    const cursor = { direction: 'prev', key: [PLACED_AT, ID] } as const;
    const reversed = [...rows].reverse();

    const middle = buildCursorPage(reversed, 3, key, { ...request, cursor });
    expect(middle.items).toEqual([rows[1], rows[2], rows[3]]);
    expect(decode(middle.prevCursor)?.key).toEqual([rows[1]?.placedAt.toISOString(), rows[1]?.id]);
    expect(decode(middle.nextCursor)?.key).toEqual([rows[3]?.placedAt.toISOString(), rows[3]?.id]);

    const first = buildCursorPage(reversed.slice(0, 2), 3, key, { ...request, cursor });
    expect(first.items).toEqual([rows[2], rows[3]]);
    expect(first.prevCursor).toBeNull();
    expect(first.nextCursor).not.toBeNull();
  });

  it('empty page: no cursor', () => {
    const cursor = { direction: 'next', key: [PLACED_AT, ID] } as const;
    expect(buildCursorPage([], 3, key, { ...request, cursor })).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
    });
  });

  it('does not change the rows it is given', () => {
    const reversed = [...rows].reverse();
    const copy = [...reversed];
    buildCursorPage(reversed, 3, key, {
      ...request,
      cursor: { direction: 'prev', key: [PLACED_AT, ID] },
    });
    expect(reversed).toEqual(copy);
  });
});
