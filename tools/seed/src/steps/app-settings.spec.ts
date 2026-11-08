import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SETTING_STORAGE_KEYS } from '../settings-rules.js';
import {
  APP_SETTINGS_FILE,
  createAppSettingsStep,
  INSERT_SETTINGS_SQL,
  parseSettingDefaults,
  planSettings,
  SELECT_SETTING_KEYS_SQL,
} from './app-settings.js';
import { IntegrityError } from './step.js';
import type { SqlClient } from './step.js';

const FILE_JSON = JSON.parse(readFileSync(APP_SETTINGS_FILE, 'utf8')) as {
  rows: Record<string, unknown>;
};

/** A client that records statements; the stored keys answer the SELECT, `inserted` the INSERT. */
function fakeClient(storedKeys: readonly string[]) {
  const statements: { text: string; values: readonly unknown[] | undefined }[] = [];
  const client: SqlClient = {
    query: async <Row>(text: string, values?: readonly unknown[]) => {
      statements.push({ text, values });
      if (text === SELECT_SETTING_KEYS_SQL) {
        return { rows: storedKeys.map((key) => ({ key })) as Row[] };
      }
      if (text === INSERT_SETTINGS_SQL) {
        const keys = (values?.[0] ?? []) as string[];
        return {
          rows: keys.filter((key) => !storedKeys.includes(key)).map((key) => ({ key })) as Row[],
        };
      }
      return { rows: [] as Row[] };
    },
  };
  return { client, statements };
}

describe('parseSettingDefaults', () => {
  it('reads the eight keys of the committed file, in storage-key order', () => {
    const rows = parseSettingDefaults(FILE_JSON);

    expect(rows.map((row) => row.key)).toEqual([...SETTING_STORAGE_KEYS]);
  });

  it('carries the accepted WA16 ordering defaults and the 04:00 business day', () => {
    const rows = new Map(parseSettingDefaults(FILE_JSON).map((row) => [row.key, row.value]));

    expect(rows.get('ordering')).toMatchObject({
      board_thresholds: { accept: { warn: 5, late: 10 }, ready: { warn: 15, late: 25 } },
      board_refetch_seconds: 15,
      call_hint_minutes: 10,
      auto_cancel_unaccepted_minutes: null,
    });
    expect(rows.get('reports')).toEqual({ business_day_starts_at: '04:00' });
    expect(Object.values(rows.get('payment') ?? {})).toEqual([null, null, null, null, null, null]);
  });

  it.each([
    ['no rows object', { rows: [] }, 'expected an object with a rows object'],
    ['an unknown key', { rows: { ...FILE_JSON.rows, theme: {} } }, 'unknown key theme'],
    [
      'a missing key',
      { rows: Object.fromEntries(Object.entries(FILE_JSON.rows).filter(([k]) => k !== 'loyalty')) },
      'key loyalty is missing',
    ],
    [
      'a value that breaks a rule',
      { rows: { ...FILE_JSON.rows, reports: { business_day_starts_at: '4h' } } },
      'reports breaks a rule at business_day_starts_at',
    ],
  ])('refuses %s with an IntegrityError', (_case, json, message) => {
    expect(() => parseSettingDefaults(json)).toThrow(IntegrityError);
    expect(() => parseSettingDefaults(json)).toThrow(message);
  });
});

describe('planSettings', () => {
  const rows = parseSettingDefaults(FILE_JSON);

  it('inserts every key into an empty table', () => {
    expect(planSettings(rows, new Set())).toMatchObject({ inserted: 8, updated: 0, unchanged: 0 });
  });

  it('never plans an update: a stored key is unchanged whatever its value', () => {
    expect(planSettings(rows, new Set(['brand', 'ordering']))).toMatchObject({
      inserted: 6,
      updated: 0,
      unchanged: 2,
    });
    expect(planSettings(rows, new Set(SETTING_STORAGE_KEYS))).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 8,
    });
  });
});

describe('createAppSettingsStep', () => {
  const step = () => createAppSettingsStep(async () => FILE_JSON);

  it('plans with one SELECT of the eight keys', async () => {
    const { client, statements } = fakeClient(['brand']);

    const planned = await step().plan(client);

    expect(planned).toEqual([
      {
        table: 'app_settings',
        inserted: 7,
        updated: 0,
        unchanged: 1,
        stale: 0,
        staleSample: [],
      },
    ]);
    expect(statements).toEqual([
      { text: SELECT_SETTING_KEYS_SQL, values: [[...SETTING_STORAGE_KEYS]] },
    ]);
  });

  it('applies one INSERT ... ON CONFLICT (key) DO NOTHING with every key and its JSON value', async () => {
    const { client, statements } = fakeClient(['brand']);

    const applied = await step().apply(client);

    expect(applied.get('app_settings')).toBe(7);
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement?.text).toBe(INSERT_SETTINGS_SQL);
    expect(statement?.values?.[0]).toEqual([...SETTING_STORAGE_KEYS]);
    const values = (statement?.values?.[1] as string[]).map(
      (value) => JSON.parse(value) as unknown,
    );
    expect(values[1]).toEqual({ business_day_starts_at: '04:00' });
  });

  it('never overwrites: the SQL has no UPDATE and does nothing on conflict', () => {
    expect(INSERT_SETTINGS_SQL).toContain('ON CONFLICT (key) DO NOTHING');
    expect(INSERT_SETTINGS_SQL).not.toMatch(/\bUPDATE\b/u);
  });

  it('a re-run changes nothing', async () => {
    const { client } = fakeClient([...SETTING_STORAGE_KEYS]);
    const seeded = step();

    expect((await seeded.plan(client))[0]).toMatchObject({ inserted: 0, updated: 0 });
    expect((await seeded.apply(client)).get('app_settings')).toBe(0);
  });
});
