import { isSettingStorageKey, SETTING_STORAGE_KEYS, settingIssues } from '../settings-rules.js';
import type { SettingStorageKey } from '../settings-rules.js';
import { IntegrityError } from './step.js';
import type { SeedStep, SqlClient, TableCounts } from './step.js';

// The `app-settings` step of `seed reference` (migration-plan, `seed reference` row; data-model
// `app_settings`; api migration `0011_app_settings.sql`). Each of the eight keys gets its default
// only when it has no row: `ON CONFLICT (key) DO NOTHING`, so a value the owner edited is never
// overwritten and a re-run changes nothing. The defaults are a copy of the API's (D-122).

/** `tools/seed/data/app-settings.defaults.json`, from `dist/steps/` or `src/steps/`. */
export const APP_SETTINGS_FILE = new URL('../../data/app-settings.defaults.json', import.meta.url);

export interface SettingRow {
  readonly key: SettingStorageKey;
  readonly value: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps and checks the defaults file: `rows` holds exactly the eight storage keys, and each value
 * passes its key's rules. Throws `IntegrityError` (exit 4) naming the key and the field paths.
 */
export function parseSettingDefaults(json: unknown): SettingRow[] {
  const file = 'app-settings.defaults.json';
  if (!isRecord(json) || !isRecord(json['rows'])) {
    throw new IntegrityError(`${file}: expected an object with a rows object`);
  }
  const rows = json['rows'];
  const unknown = Object.keys(rows).filter((key) => !isSettingStorageKey(key));
  if (unknown.length > 0) {
    throw new IntegrityError(`${file}: unknown key ${unknown.join(', ')}`);
  }
  return SETTING_STORAGE_KEYS.map((key): SettingRow => {
    if (!Object.hasOwn(rows, key)) {
      throw new IntegrityError(`${file}: key ${key} is missing`);
    }
    const value = rows[key];
    const issues = settingIssues(key, value);
    if (issues.length > 0 || !isRecord(value)) {
      throw new IntegrityError(`${file}: ${key} breaks a rule at ${issues.join(', ')}`);
    }
    return { key, value };
  });
}

export const SELECT_SETTING_KEYS_SQL = 'SELECT key FROM public.app_settings WHERE key = ANY($1)';

/** Inserts the absent keys only; `row_version` 1 and `updated_by` null come from the table. */
export const INSERT_SETTINGS_SQL = `INSERT INTO public.app_settings (key, value)
SELECT key, value FROM unnest($1::text[], $2::jsonb[]) AS t(key, value)
ON CONFLICT (key) DO NOTHING
RETURNING key`;

/** Counts: an absent key is inserted, a present one is unchanged whatever its value. */
export function planSettings(
  rows: readonly SettingRow[],
  storedKeys: ReadonlySet<string>,
): TableCounts {
  const present = rows.filter((row) => storedKeys.has(row.key)).length;
  return {
    table: 'app_settings',
    inserted: rows.length - present,
    updated: 0,
    unchanged: present,
    stale: 0,
    staleSample: [],
  };
}

/** The step. `load` returns the parsed JSON of the defaults file; it is called once. */
export function createAppSettingsStep(load: () => Promise<unknown>): SeedStep {
  let rows: Promise<SettingRow[]> | undefined;
  const source = () => {
    rows ??= load().then(parseSettingDefaults);
    return rows;
  };

  return {
    name: 'app-settings',

    async plan(client: SqlClient): Promise<readonly TableCounts[]> {
      const defaults = await source();
      const stored = await client.query<{ key: string }>(SELECT_SETTING_KEYS_SQL, [
        defaults.map((row) => row.key),
      ]);
      return [planSettings(defaults, new Set(stored.rows.map((row) => row.key)))];
    },

    async apply(client: SqlClient): Promise<ReadonlyMap<string, number>> {
      const defaults = await source();
      const result = await client.query(INSERT_SETTINGS_SQL, [
        defaults.map((row) => row.key),
        defaults.map((row) => JSON.stringify(row.value)),
      ]);
      return new Map([['app_settings', result.rows.length]]);
    },
  };
}
