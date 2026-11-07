import { IntegrityError, STALE_SAMPLE_SIZE } from './step.js';
import type { SeedStep, SqlClient, TableCounts } from './step.js';

// The geography step of `seed reference`: `provinces` and `wards` (api migration
// `0009_geography.sql`) from `@kd/seed-data/admin-units/provinces.json` and `wards.json`, the only
// package `@kd/seed` may read (decision 0003 section 6). Upsert by `code`; a re-run changes
// nothing; a changed name or type is updated in place (ADR-0008 #17); a row missing from the file
// is only reported as stale, never deleted, because addresses may reference it.

export const PROVINCE_TYPES = ['CITY', 'PROVINCE'] as const;
export type ProvinceType = (typeof PROVINCE_TYPES)[number];

export const WARD_TYPES = ['WARD', 'COMMUNE', 'SPECIAL_ZONE'] as const;
export type WardType = (typeof WARD_TYPES)[number];

/** The two keys written to `names` (`vi` required by the table, `vi_full` documented by ADR-0008 #17). */
export interface AdminUnitNames {
  readonly vi: string;
  readonly vi_full: string;
}

export interface ProvinceRow {
  readonly code: string;
  readonly names: AdminUnitNames;
  readonly type: ProvinceType;
}

export interface WardRow {
  readonly code: string;
  readonly provinceCode: string;
  readonly names: AdminUnitNames;
  readonly type: WardType;
}

/** Official code formats (`tools/seed-data/admin-units/README.md`, "Mapping to the schema"). */
const PROVINCE_CODE = /^[0-9]{2}$/;
const WARD_CODE = /^[0-9]{5}$/;

export const PROVINCES_FILE = '@kd/seed-data/admin-units/provinces.json';
export const WARDS_FILE = '@kd/seed-data/admin-units/wards.json';

// ---------------------------------------------------------------------------------------------
// Row mapping: the fixture rows (`rows[]` with `code`, `names { vi, vi_full }`, `type` and, for
// wards, `province_code`) to the table rows. Any other key (`region`) is ignored.
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowsOf(file: string, json: unknown): unknown[] {
  if (!isRecord(json) || !Array.isArray(json['rows'])) {
    throw new IntegrityError(`${file}: expected an object with a rows array`);
  }
  return json['rows'];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function namesOf(where: string, value: unknown): AdminUnitNames {
  if (!isRecord(value) || !nonEmptyString(value['vi']) || !nonEmptyString(value['vi_full'])) {
    throw new IntegrityError(`${where}: names.vi and names.vi_full must be non-empty strings`);
  }
  return { vi: value['vi'], vi_full: value['vi_full'] };
}

function assertUniqueCodes(file: string, rows: readonly { code: string }[]): void {
  const seen = new Set<string>();
  for (const { code } of rows) {
    if (seen.has(code)) {
      throw new IntegrityError(`${file}: code ${code} appears twice`);
    }
    seen.add(code);
  }
}

/** Maps and checks `provinces.json`. Throws `IntegrityError` (exit 4) on the first broken row. */
export function parseProvinces(json: unknown): ProvinceRow[] {
  const file = 'provinces.json';
  const rows = rowsOf(file, json).map((row, index): ProvinceRow => {
    const where = `${file} row ${index + 1}`;
    if (!isRecord(row)) {
      throw new IntegrityError(`${where}: expected an object`);
    }
    const { code, type } = row;
    if (typeof code !== 'string' || !PROVINCE_CODE.test(code)) {
      throw new IntegrityError(`${where}: code must be 2 digits`);
    }
    if (!oneOf(PROVINCE_TYPES, type)) {
      throw new IntegrityError(`${where}: type must be one of ${PROVINCE_TYPES.join('|')}`);
    }
    return { code, names: namesOf(where, row['names']), type };
  });
  assertUniqueCodes(file, rows);
  return rows;
}

/**
 * Maps and checks `wards.json`; every `province_code` must be a province of the file, so the
 * foreign key cannot fail halfway. Throws `IntegrityError` (exit 4) on the first broken row.
 */
export function parseWards(json: unknown, provinceCodes: ReadonlySet<string>): WardRow[] {
  const file = 'wards.json';
  const rows = rowsOf(file, json).map((row, index): WardRow => {
    const where = `${file} row ${index + 1}`;
    if (!isRecord(row)) {
      throw new IntegrityError(`${where}: expected an object`);
    }
    const { code, type } = row;
    const provinceCode = row['province_code'];
    if (typeof code !== 'string' || !WARD_CODE.test(code)) {
      throw new IntegrityError(`${where}: code must be 5 digits`);
    }
    if (typeof provinceCode !== 'string' || !provinceCodes.has(provinceCode)) {
      throw new IntegrityError(`${where}: province_code is not a province of provinces.json`);
    }
    if (!oneOf(WARD_TYPES, type)) {
      throw new IntegrityError(`${where}: type must be one of ${WARD_TYPES.join('|')}`);
    }
    return { code, provinceCode, names: namesOf(where, row['names']), type };
  });
  assertUniqueCodes(file, rows);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Plan arithmetic: what the upsert will do, from the rows of the file and of the table.
// ---------------------------------------------------------------------------------------------

/** Equal when `vi` and `vi_full` match and the stored object has no other key (jsonb `=` semantics). */
export function sameNames(stored: unknown, wanted: AdminUnitNames): boolean {
  return (
    isRecord(stored) &&
    Object.keys(stored).length === 2 &&
    stored['vi'] === wanted.vi &&
    stored['vi_full'] === wanted.vi_full
  );
}

/**
 * Counts per table: a file row whose code is not stored is inserted; one whose stored row differs
 * (`same` is false) is updated; the others are unchanged; a stored code missing from the file is
 * stale. Mirrors the `WHERE ... IS DISTINCT FROM` of the upsert, which the runner checks.
 */
export function planTable<Row extends { readonly code: string }, Stored extends { code: string }>(
  table: string,
  fileRows: readonly Row[],
  storedRows: readonly Stored[],
  same: (stored: Stored, wanted: Row) => boolean,
): TableCounts {
  const stored = new Map(storedRows.map((row) => [row.code, row]));
  const fileCodes = new Set(fileRows.map((row) => row.code));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of fileRows) {
    const current = stored.get(row.code);
    if (current === undefined) {
      inserted += 1;
    } else if (same(current, row)) {
      unchanged += 1;
    } else {
      updated += 1;
    }
  }
  const staleCodes = storedRows
    .map((row) => row.code)
    .filter((code) => !fileCodes.has(code))
    .sort();
  return {
    table,
    inserted,
    updated,
    unchanged,
    stale: staleCodes.length,
    staleSample: staleCodes.slice(0, STALE_SAMPLE_SIZE),
  };
}

// ---------------------------------------------------------------------------------------------
// SQL. One statement per table with array parameters; `names` travel as JSON text cast to jsonb.
// ---------------------------------------------------------------------------------------------

interface StoredProvince {
  code: string;
  names: unknown;
  type: string;
}

interface StoredWard extends StoredProvince {
  province_code: string;
}

export const SELECT_PROVINCES_SQL = 'SELECT code, names, type::text AS type FROM public.provinces';
export const SELECT_WARDS_SQL =
  'SELECT code, province_code, names, type::text AS type FROM public.wards';

export const UPSERT_PROVINCES_SQL = `INSERT INTO public.provinces AS p (code, names, type)
SELECT code, names, type
  FROM unnest($1::text[], $2::jsonb[], $3::public.province_type[]) AS t(code, names, type)
ON CONFLICT (code) DO UPDATE
   SET names = EXCLUDED.names, type = EXCLUDED.type
 WHERE (p.names, p.type) IS DISTINCT FROM (EXCLUDED.names, EXCLUDED.type)
RETURNING code`;

export const UPSERT_WARDS_SQL = `INSERT INTO public.wards AS w (code, province_code, names, type)
SELECT code, province_code, names, type
  FROM unnest($1::text[], $2::text[], $3::jsonb[], $4::public.ward_type[])
       AS t(code, province_code, names, type)
ON CONFLICT (code) DO UPDATE
   SET province_code = EXCLUDED.province_code, names = EXCLUDED.names, type = EXCLUDED.type
 WHERE (w.province_code, w.names, w.type)
       IS DISTINCT FROM (EXCLUDED.province_code, EXCLUDED.names, EXCLUDED.type)
RETURNING code`;

function namesJson(names: AdminUnitNames): string {
  return JSON.stringify({ vi: names.vi, vi_full: names.vi_full });
}

export interface GeographySource {
  readonly provinces: unknown;
  readonly wards: unknown;
}

/**
 * The geography step. `load` returns the parsed JSON of the two files; it is called once, and the
 * rows are checked before any statement runs.
 */
export function createGeographyStep(load: () => Promise<GeographySource>): SeedStep {
  let rows: Promise<{ provinces: ProvinceRow[]; wards: WardRow[] }> | undefined;
  const source = () => {
    rows ??= load().then((json) => {
      const provinces = parseProvinces(json.provinces);
      const wards = parseWards(json.wards, new Set(provinces.map((row) => row.code)));
      return { provinces, wards };
    });
    return rows;
  };

  return {
    name: 'geography',

    async plan(client: SqlClient): Promise<readonly TableCounts[]> {
      const { provinces, wards } = await source();
      const storedProvinces = (await client.query<StoredProvince>(SELECT_PROVINCES_SQL)).rows;
      const storedWards = (await client.query<StoredWard>(SELECT_WARDS_SQL)).rows;
      return [
        planTable(
          'provinces',
          provinces,
          storedProvinces,
          (stored, wanted) => stored.type === wanted.type && sameNames(stored.names, wanted.names),
        ),
        planTable(
          'wards',
          wards,
          storedWards,
          (stored, wanted) =>
            stored.province_code === wanted.provinceCode &&
            stored.type === wanted.type &&
            sameNames(stored.names, wanted.names),
        ),
      ];
    },

    async apply(client: SqlClient): Promise<ReadonlyMap<string, number>> {
      const { provinces, wards } = await source();
      // Provinces first: wards reference them.
      const provinceResult = await client.query(UPSERT_PROVINCES_SQL, [
        provinces.map((row) => row.code),
        provinces.map((row) => namesJson(row.names)),
        provinces.map((row) => row.type),
      ]);
      const wardResult = await client.query(UPSERT_WARDS_SQL, [
        wards.map((row) => row.code),
        wards.map((row) => row.provinceCode),
        wards.map((row) => namesJson(row.names)),
        wards.map((row) => row.type),
      ]);
      return new Map([
        ['provinces', provinceResult.rows.length],
        ['wards', wardResult.rows.length],
      ]);
    },
  };
}
