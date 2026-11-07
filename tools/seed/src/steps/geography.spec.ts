import { describe, expect, it } from 'vitest';

import {
  createGeographyStep,
  parseProvinces,
  parseWards,
  planTable,
  sameNames,
  SELECT_PROVINCES_SQL,
  SELECT_WARDS_SQL,
  UPSERT_PROVINCES_SQL,
  UPSERT_WARDS_SQL,
} from './geography.js';
import type { GeographySource } from './geography.js';
import { IntegrityError, STALE_SAMPLE_SIZE } from './step.js';
import type { SqlClient } from './step.js';

// Fictional units in the shape of `@kd/seed-data/admin-units/*.json`; the codes are made up.

function provinceJson(code: string, vi: string, type = 'PROVINCE') {
  return { code, names: { vi, vi_full: `Tỉnh ${vi}` }, type, region: null };
}

function wardJson(code: string, provinceCode: string, vi: string, type = 'WARD') {
  return { code, province_code: provinceCode, names: { vi, vi_full: `Phường ${vi}` }, type };
}

const SOURCE: GeographySource = {
  provinces: {
    _meta: { as_of: '01/01/2026' },
    rows: [provinceJson('90', 'Mẫu Lâm', 'CITY'), provinceJson('93', 'Đồng Mẫu')],
  },
  wards: {
    rows: [
      wardJson('90001', '90', 'Bến Mẫu'),
      wardJson('90002', '90', 'Ánh Mẫu', 'COMMUNE'),
      wardJson('93001', '93', 'Khác Mẫu', 'SPECIAL_ZONE'),
    ],
  },
};

/** A client that records every statement and answers from canned rows. */
function fakeClient(stored: { provinces?: unknown[]; wards?: unknown[] } = {}) {
  const statements: { text: string; values: readonly unknown[] | undefined }[] = [];
  const client: SqlClient = {
    query: async <Row>(text: string, values?: readonly unknown[]) => {
      statements.push({ text, values });
      if (text === SELECT_PROVINCES_SQL) return { rows: (stored.provinces ?? []) as Row[] };
      if (text === SELECT_WARDS_SQL) return { rows: (stored.wards ?? []) as Row[] };
      return { rows: [] as Row[] };
    },
  };
  return { client, statements };
}

describe('parseProvinces', () => {
  it('maps code, names { vi, vi_full } and type, and drops every other key', () => {
    expect(parseProvinces(SOURCE.provinces)).toEqual([
      { code: '90', names: { vi: 'Mẫu Lâm', vi_full: 'Tỉnh Mẫu Lâm' }, type: 'CITY' },
      { code: '93', names: { vi: 'Đồng Mẫu', vi_full: 'Tỉnh Đồng Mẫu' }, type: 'PROVINCE' },
    ]);
  });

  it.each([
    ['no rows array', { data: [] }, 'expected an object with a rows array'],
    ['a row that is not an object', { rows: ['90'] }, 'row 1: expected an object'],
    ['a three-digit code', { rows: [provinceJson('900', 'Mẫu')] }, 'row 1: code must be 2 digits'],
    [
      'a numeric code',
      { rows: [{ ...provinceJson('90', 'Mẫu'), code: 90 }] },
      'code must be 2 digits',
    ],
    ['an unknown type', { rows: [provinceJson('90', 'Mẫu', 'STATE')] }, 'type must be one of'],
    [
      'an empty vi',
      { rows: [{ code: '90', names: { vi: ' ', vi_full: 'Tỉnh' }, type: 'PROVINCE' }] },
      'names.vi and names.vi_full',
    ],
    [
      'no vi_full',
      { rows: [{ code: '90', names: { vi: 'Mẫu' }, type: 'PROVINCE' }] },
      'names.vi and names.vi_full',
    ],
    [
      'a duplicate code',
      { rows: [provinceJson('90', 'Mẫu'), provinceJson('90', 'Khác')] },
      'code 90 appears twice',
    ],
  ])('refuses %s with an IntegrityError', (_case, json, message) => {
    expect(() => parseProvinces(json)).toThrow(IntegrityError);
    expect(() => parseProvinces(json)).toThrow(message);
  });
});

describe('parseWards', () => {
  const provinceCodes = new Set(['90', '93']);

  it('maps province_code to provinceCode', () => {
    expect(parseWards(SOURCE.wards, provinceCodes)[2]).toEqual({
      code: '93001',
      provinceCode: '93',
      names: { vi: 'Khác Mẫu', vi_full: 'Phường Khác Mẫu' },
      type: 'SPECIAL_ZONE',
    });
  });

  it.each([
    ['a four-digit code', { rows: [wardJson('9001', '90', 'Mẫu')] }, 'code must be 5 digits'],
    [
      'a province missing from provinces.json',
      { rows: [wardJson('99001', '99', 'Mẫu')] },
      'province_code is not a province of provinces.json',
    ],
    [
      'an unknown type',
      { rows: [wardJson('90001', '90', 'Mẫu', 'DISTRICT')] },
      'type must be one of',
    ],
    [
      'a duplicate code',
      { rows: [wardJson('90001', '90', 'Mẫu'), wardJson('90001', '93', 'Khác')] },
      'code 90001 appears twice',
    ],
  ])('refuses %s with an IntegrityError', (_case, json, message) => {
    expect(() => parseWards(json, provinceCodes)).toThrow(IntegrityError);
    expect(() => parseWards(json, provinceCodes)).toThrow(message);
  });
});

describe('sameNames', () => {
  const wanted = { vi: 'Mẫu', vi_full: 'Tỉnh Mẫu' };

  it('is true for the same two keys in any order', () => {
    expect(sameNames({ vi_full: 'Tỉnh Mẫu', vi: 'Mẫu' }, wanted)).toBe(true);
  });

  it.each([
    ['another vi', { vi: 'Khác', vi_full: 'Tỉnh Mẫu' }],
    ['another vi_full', { vi: 'Mẫu', vi_full: 'Thành phố Mẫu' }],
    ['an extra key', { vi: 'Mẫu', vi_full: 'Tỉnh Mẫu', en: 'Sample' }],
    ['no vi_full', { vi: 'Mẫu' }],
    ['a string', 'Mẫu'],
    ['null', null],
  ])('is false for %s', (_case, stored) => {
    expect(sameNames(stored, wanted)).toBe(false);
  });
});

describe('planTable', () => {
  const same = (stored: { code: string; v: number }, wanted: { code: string; v: number }) =>
    stored.v === wanted.v;

  it('counts inserted, updated, unchanged and stale rows', () => {
    const file = [
      { code: 'a', v: 1 },
      { code: 'b', v: 2 },
      { code: 'c', v: 3 },
    ];
    const stored = [
      { code: 'b', v: 2 },
      { code: 'c', v: 9 },
      { code: 'z', v: 0 },
      { code: 'y', v: 0 },
    ];

    expect(planTable('t', file, stored, same)).toEqual({
      table: 't',
      inserted: 1,
      updated: 1,
      unchanged: 1,
      stale: 2,
      staleSample: ['y', 'z'],
    });
  });

  it('plans nothing on a re-run against the same rows', () => {
    const rows = [
      { code: 'a', v: 1 },
      { code: 'b', v: 2 },
    ];

    expect(planTable('t', rows, rows, same)).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 2,
      stale: 0,
    });
  });

  it(`lists at most ${STALE_SAMPLE_SIZE} stale codes, sorted, and counts them all`, () => {
    const stored = Array.from({ length: 12 }, (_, index) => ({
      code: String(90_012 - index),
      v: 0,
    }));

    const counts = planTable('t', [], stored, same);

    expect(counts.stale).toBe(12);
    expect(counts.staleSample).toHaveLength(STALE_SAMPLE_SIZE);
    expect(counts.staleSample[0]).toBe('90001');
  });
});

describe('createGeographyStep', () => {
  it('plans against the stored rows: a renamed ward, a new province, a stale ward', async () => {
    const step = createGeographyStep(async () => SOURCE);
    const { client, statements } = fakeClient({
      provinces: [{ code: '90', names: { vi: 'Mẫu Lâm', vi_full: 'Tỉnh Mẫu Lâm' }, type: 'CITY' }],
      wards: [
        {
          code: '90001',
          province_code: '90',
          names: { vi: 'Bến Cũ', vi_full: 'Phường Bến Cũ' },
          type: 'WARD',
        },
        {
          code: '90002',
          province_code: '90',
          names: { vi: 'Ánh Mẫu', vi_full: 'Phường Ánh Mẫu' },
          type: 'COMMUNE',
        },
        {
          code: '90009',
          province_code: '90',
          names: { vi: 'Bỏ', vi_full: 'Phường Bỏ' },
          type: 'WARD',
        },
      ],
    });

    const planned = await step.plan(client);

    expect(planned).toEqual([
      { table: 'provinces', inserted: 1, updated: 0, unchanged: 1, stale: 0, staleSample: [] },
      { table: 'wards', inserted: 1, updated: 1, unchanged: 1, stale: 1, staleSample: ['90009'] },
    ]);
    // The plan only reads.
    expect(statements.map((statement) => statement.text)).toEqual([
      SELECT_PROVINCES_SQL,
      SELECT_WARDS_SQL,
    ]);
  });

  it('counts a ward moved to another province or retyped as updated', async () => {
    const step = createGeographyStep(async () => SOURCE);
    const { client } = fakeClient({
      provinces: [],
      wards: [
        {
          code: '90001',
          province_code: '93',
          names: { vi: 'Bến Mẫu', vi_full: 'Phường Bến Mẫu' },
          type: 'WARD',
        },
        {
          code: '90002',
          province_code: '90',
          names: { vi: 'Ánh Mẫu', vi_full: 'Phường Ánh Mẫu' },
          type: 'WARD',
        },
      ],
    });

    const [, wards] = await step.plan(client);

    expect(wards).toMatchObject({ inserted: 1, updated: 2, unchanged: 0 });
  });

  it('applies provinces then wards, one upsert each, with array parameters and names as JSON', async () => {
    const step = createGeographyStep(async () => SOURCE);
    const { client, statements } = fakeClient();

    await step.apply(client);

    expect(statements).toEqual([
      {
        text: UPSERT_PROVINCES_SQL,
        values: [
          ['90', '93'],
          [
            '{"vi":"Mẫu Lâm","vi_full":"Tỉnh Mẫu Lâm"}',
            '{"vi":"Đồng Mẫu","vi_full":"Tỉnh Đồng Mẫu"}',
          ],
          ['CITY', 'PROVINCE'],
        ],
      },
      {
        text: UPSERT_WARDS_SQL,
        values: [
          ['90001', '90002', '93001'],
          ['90', '90', '93'],
          [
            '{"vi":"Bến Mẫu","vi_full":"Phường Bến Mẫu"}',
            '{"vi":"Ánh Mẫu","vi_full":"Phường Ánh Mẫu"}',
            '{"vi":"Khác Mẫu","vi_full":"Phường Khác Mẫu"}',
          ],
          ['WARD', 'COMMUNE', 'SPECIAL_ZONE'],
        ],
      },
    ]);
  });

  it('upserts by code, updates only rows that differ, never deletes', () => {
    for (const sql of [UPSERT_PROVINCES_SQL, UPSERT_WARDS_SQL]) {
      expect(sql).toContain('ON CONFLICT (code) DO UPDATE');
      expect(sql).toContain('IS DISTINCT FROM');
      expect(sql).toContain('RETURNING code');
      expect(sql).not.toMatch(/\bDELETE\b/i);
    }
  });

  it('reads the files once and checks them before any statement', async () => {
    let loads = 0;
    const step = createGeographyStep(async () => {
      loads += 1;
      return { provinces: SOURCE.provinces, wards: { rows: [wardJson('99001', '99', 'Mẫu')] } };
    });
    const { client, statements } = fakeClient();

    await expect(step.plan(client)).rejects.toThrow(IntegrityError);
    await expect(step.apply(client)).rejects.toThrow(IntegrityError);
    expect(loads).toBe(1);
    expect(statements).toEqual([]);
  });
});
