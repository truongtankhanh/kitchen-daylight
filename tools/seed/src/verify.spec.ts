import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { AppEnv } from './environment.js';
import { SETTING_STORAGE_KEYS } from './settings-rules.js';
import type { SqlClient } from './steps/step.js';
import {
  COUNT_ADMINS_SQL,
  COUNT_ORPHAN_WARDS_SQL,
  COUNT_PROVINCES_SQL,
  COUNT_WARDS_SQL,
  documentChecks,
  SELECT_CURRENT_DOCUMENTS_SQL,
  SELECT_SETTINGS_SQL,
  settingChecks,
  verifyLine,
  verifyReference,
} from './verify.js';
import type { VerifyCheck } from './verify.js';

const DEFAULTS = (
  JSON.parse(
    readFileSync(new URL('../data/app-settings.defaults.json', import.meta.url), 'utf8'),
  ) as { rows: Record<string, unknown> }
).rows;

const EXPECTED = { provinces: 34, wards: 3321 };

interface Database {
  provinces: number;
  wards: number;
  orphanWards: number;
  settings: { key: string; value: unknown }[];
  documents: { type: string; version: string; has_content: boolean }[];
  admins: number;
}

/** A database that passes every check in a non-prod tier. */
function healthy(): Database {
  return {
    provinces: 34,
    wards: 3321,
    orphanWards: 0,
    settings: SETTING_STORAGE_KEYS.map((key) => ({ key, value: DEFAULTS[key] })),
    documents: [
      { type: 'PRIVACY_POLICY', version: '2026-11', has_content: true },
      { type: 'TERMS_OF_SERVICE', version: '2026-11', has_content: true },
    ],
    admins: 1,
  };
}

/** A client that records statements and answers each SELECT of `verify.ts` from `db`. */
function fakeClient(db: Database) {
  const statements: string[] = [];
  const client: SqlClient = {
    query: async <Row>(text: string) => {
      statements.push(text);
      const answers: Record<string, unknown[]> = {
        [COUNT_PROVINCES_SQL]: [{ count: db.provinces }],
        [COUNT_WARDS_SQL]: [{ count: db.wards }],
        [COUNT_ORPHAN_WARDS_SQL]: [{ count: db.orphanWards }],
        [SELECT_SETTINGS_SQL]: db.settings,
        [SELECT_CURRENT_DOCUMENTS_SQL]: db.documents,
        [COUNT_ADMINS_SQL]: [{ count: db.admins }],
      };
      const rows = answers[text];
      if (rows === undefined) {
        throw new Error(`unexpected statement: ${text}`);
      }
      return { rows: rows as Row[] };
    },
  };
  return { client, statements };
}

async function run(db: Database, appEnv: AppEnv = 'dev'): Promise<VerifyCheck[]> {
  return verifyReference(fakeClient(db).client, { appEnv, expected: EXPECTED });
}

function failed(checks: readonly VerifyCheck[]): string[] {
  return checks.filter((check) => !check.ok).map((check) => check.name);
}

describe('verifyReference', () => {
  it('passes a complete reference database, one check per line, reading only', async () => {
    const { client, statements } = fakeClient(healthy());

    const checks = await verifyReference(client, { appEnv: 'prod', expected: EXPECTED });

    expect(failed(checks)).toEqual([]);
    expect(checks.map((check) => check.name)).toEqual([
      'provinces count',
      'wards count',
      'wards have their province',
      ...SETTING_STORAGE_KEYS.map((key) => `app_settings ${key}`),
      'consent_documents TERMS_OF_SERVICE vi',
      'consent_documents PRIVACY_POLICY vi',
      'admin users',
    ]);
    expect(statements.every((text) => /^SELECT\b/u.test(text))).toBe(true);
  });

  it('fails a province or ward count that differs from the committed files', async () => {
    const checks = await run({ ...healthy(), provinces: 33, wards: 3322 });

    expect(failed(checks)).toEqual(['provinces count', 'wards count']);
    expect(checks[0]?.detail).toBe('expected 34, found 33');
  });

  it('fails a ward without its province', async () => {
    expect(failed(await run({ ...healthy(), orphanWards: 2 }))).toEqual([
      'wards have their province',
    ]);
  });

  it('fails a missing settings key and one that breaks a rule, naming the field only', async () => {
    const db = healthy();
    db.settings = db.settings
      .filter((row) => row.key !== 'loyalty')
      .map((row) =>
        row.key === 'reports'
          ? { key: 'reports', value: { business_day_starts_at: '25:00' } }
          : row,
      );

    const checks = await run(db);

    expect(failed(checks)).toEqual(['app_settings reports', 'app_settings loyalty']);
    expect(checks.find((check) => check.name === 'app_settings reports')?.detail).toBe(
      'breaks a rule at business_day_starts_at',
    );
    expect(checks.find((check) => check.name === 'app_settings loyalty')?.detail).toBe('missing');
  });

  it('fails a missing document type and a current document without text', async () => {
    const db = healthy();
    db.documents = [{ type: 'TERMS_OF_SERVICE', version: 'smoke-1', has_content: false }];

    const checks = await run(db);

    expect(failed(checks)).toEqual([
      'consent_documents TERMS_OF_SERVICE vi',
      'consent_documents PRIVACY_POLICY vi',
    ]);
    expect(checks.map((check) => check.detail)).toContain('the current document has no text');
    expect(checks.map((check) => check.detail)).toContain('missing');
  });

  it('fails no ADMIN', async () => {
    expect(failed(await run({ ...healthy(), admins: 0 }))).toEqual(['admin users']);
  });
});

describe('documentChecks: the placeholder marker', () => {
  const placeholders = [
    { type: 'TERMS_OF_SERVICE', version: 'placeholder-1', has_content: true },
    { type: 'PRIVACY_POLICY', version: 'placeholder-1', has_content: true },
  ];

  it.each<AppEnv>(['dev', 'test', 'demo'])('passes a placeholder in %s, with a remark', (env) => {
    const checks = documentChecks(placeholders, env);

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks[0]?.detail).toBe('placeholder text, refused in prod');
  });

  it('fails a placeholder in prod, type by type', () => {
    const checks = documentChecks(
      [placeholders[0]!, { type: 'PRIVACY_POLICY', version: '2026-11', has_content: true }],
      'prod',
    );

    expect(checks.map((check) => check.ok)).toEqual([false, true]);
    expect(checks[0]?.detail).toBe('placeholder text in prod, not legal text');
  });
});

describe('settingChecks', () => {
  it('passes the committed defaults', () => {
    const checks = settingChecks(
      SETTING_STORAGE_KEYS.map((key) => ({ key, value: DEFAULTS[key] })),
    );
    expect(checks.every((check) => check.ok)).toBe(true);
  });
});

describe('verifyLine', () => {
  it('prints ok or FAIL, the name and the detail', () => {
    expect(verifyLine({ name: 'admin users', ok: true })).toBe('ok    admin users');
    expect(verifyLine({ name: 'wards count', ok: false, detail: 'expected 2, found 1' })).toBe(
      'FAIL  wards count (expected 2, found 1)',
    );
  });

  it('never prints a row content', async () => {
    const db = healthy();
    db.settings = db.settings.map((row) =>
      row.key === 'brand'
        ? { key: 'brand', value: { ...(row.value as object), hotline: 'S3cr3t-Value' } }
        : row,
    );

    const lines = (await run(db)).map(verifyLine).join('\n');

    expect(lines).toContain('FAIL  app_settings brand (breaks a rule at hotline)');
    expect(lines).not.toContain('S3cr3t-Value');
  });
});
