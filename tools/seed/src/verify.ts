import type { AppEnv } from './environment.js';
import { SETTING_STORAGE_KEYS, settingIssues } from './settings-rules.js';
import type { SettingStorageKey } from './settings-rules.js';
import { CONSENT_DOCUMENT_TYPES, isPlaceholderDocument } from './steps/consent-documents.js';
import type { SqlClient } from './steps/step.js';

// `verify reference` (migration-plan "Acceptance checks"; decision 0005 section 8, the `verify`
// command added by A4-T5, api-divergences D-123). Read only. One line per check, `ok` or `FAIL`,
// with counts, keys, field paths and types only: never a row's content (no name, email, text or
// setting value). The other scopes, and acceptance check 8 (two active admins with TOTP), are A13-T4.

export const VERIFY_SCOPES = ['reference'] as const;
export type VerifyScope = (typeof VERIFY_SCOPES)[number];

export interface VerifyCheck {
  readonly name: string;
  readonly ok: boolean;
  /** Why it failed, or a remark on a pass. Counts, keys, paths or types only. */
  readonly detail?: string;
}

export interface ReferenceExpectations {
  /** Rows of `@kd/seed-data/admin-units/provinces.json` and `wards.json`. */
  readonly provinces: number;
  readonly wards: number;
}

export interface VerifyReferenceOptions {
  readonly appEnv: AppEnv;
  readonly expected: ReferenceExpectations;
}

/** The locale whose documents registration accepts (A4-T4, `DEFAULT_CONSENT_LOCALE`). */
export const VERIFY_CONSENT_LOCALE = 'vi';

export const COUNT_PROVINCES_SQL = 'SELECT count(*)::integer AS count FROM public.provinces';
export const COUNT_WARDS_SQL = 'SELECT count(*)::integer AS count FROM public.wards';
export const COUNT_ORPHAN_WARDS_SQL = `SELECT count(*)::integer AS count
  FROM public.wards w
 WHERE NOT EXISTS (SELECT 1 FROM public.provinces p WHERE p.code = w.province_code)`;
export const SELECT_SETTINGS_SQL = 'SELECT key, value FROM public.app_settings';
/** The current document per type, as `GET /legal/documents/current` picks it (A4-T4). */
export const SELECT_CURRENT_DOCUMENTS_SQL = `SELECT DISTINCT ON (type)
       type::text AS type, version, content IS NOT NULL AS has_content
  FROM public.consent_documents
 WHERE locale = $1 AND published_at <= now()
 ORDER BY type, published_at DESC, id DESC`;
/** An `ADMIN` who can sign in now or after the invitation: `INVITED` or `ACTIVE`. */
export const COUNT_ADMINS_SQL = `SELECT count(*)::integer AS count
  FROM public.users
 WHERE role = 'ADMIN' AND status IN ('INVITED', 'ACTIVE')`;

async function count(client: SqlClient, sql: string): Promise<number> {
  const result = await client.query<{ count: number }>(sql);
  return result.rows[0]?.count ?? 0;
}

function countCheck(name: string, expected: number, found: number): VerifyCheck {
  return found === expected
    ? { name, ok: true }
    : { name, ok: false, detail: `expected ${expected}, found ${found}` };
}

/** One check per storage key: present, and its value passes the key's rules. */
export function settingChecks(stored: readonly { key: string; value: unknown }[]): VerifyCheck[] {
  const byKey = new Map(stored.map((row) => [row.key, row.value]));
  return SETTING_STORAGE_KEYS.map((key: SettingStorageKey): VerifyCheck => {
    const name = `app_settings ${key}`;
    if (!byKey.has(key)) {
      return { name, ok: false, detail: 'missing' };
    }
    const issues = settingIssues(key, byKey.get(key));
    return issues.length === 0
      ? { name, ok: true }
      : { name, ok: false, detail: `breaks a rule at ${issues.join(', ')}` };
  });
}

/**
 * One check per type: a current document exists, has its text (else the endpoint answers
 * `NOT_FOUND` and nobody can register), and, in `prod`, is not a placeholder.
 */
export function documentChecks(
  current: readonly { type: string; version: string; has_content: boolean }[],
  appEnv: AppEnv,
): VerifyCheck[] {
  return CONSENT_DOCUMENT_TYPES.map((type): VerifyCheck => {
    const name = `consent_documents ${type} ${VERIFY_CONSENT_LOCALE}`;
    const document = current.find((row) => row.type === type);
    if (document === undefined) {
      return { name, ok: false, detail: 'missing' };
    }
    if (!document.has_content) {
      return { name, ok: false, detail: 'the current document has no text' };
    }
    if (isPlaceholderDocument(document.version)) {
      return appEnv === 'prod'
        ? { name, ok: false, detail: 'placeholder text in prod, not legal text' }
        : { name, ok: true, detail: 'placeholder text, refused in prod' };
    }
    return { name, ok: true };
  });
}

/** Runs every check of the `reference` scope, in order. Reads only. */
export async function verifyReference(
  client: SqlClient,
  options: VerifyReferenceOptions,
): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = [
    countCheck(
      'provinces count',
      options.expected.provinces,
      await count(client, COUNT_PROVINCES_SQL),
    ),
    countCheck('wards count', options.expected.wards, await count(client, COUNT_WARDS_SQL)),
    countCheck('wards have their province', 0, await count(client, COUNT_ORPHAN_WARDS_SQL)),
  ];

  const settings = await client.query<{ key: string; value: unknown }>(SELECT_SETTINGS_SQL);
  checks.push(...settingChecks(settings.rows));

  const documents = await client.query<{ type: string; version: string; has_content: boolean }>(
    SELECT_CURRENT_DOCUMENTS_SQL,
    [VERIFY_CONSENT_LOCALE],
  );
  checks.push(...documentChecks(documents.rows, options.appEnv));

  const admins = await count(client, COUNT_ADMINS_SQL);
  checks.push(
    admins > 0
      ? { name: 'admin users', ok: true }
      : { name: 'admin users', ok: false, detail: 'no ADMIN with status INVITED or ACTIVE' },
  );
  return checks;
}

/** `ok    name` or `FAIL  name (detail)`. */
export function verifyLine(check: VerifyCheck): string {
  const line = `${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}`;
  return check.detail === undefined ? line : `${line} (${check.detail})`;
}
