import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isSettingStorageKey, SETTING_STORAGE_KEYS, settingIssues } from './settings-rules.js';
import type { SettingStorageKey } from './settings-rules.js';

/** The committed defaults, the values every rule below starts from. */
const DEFAULTS = (
  JSON.parse(
    readFileSync(new URL('../data/app-settings.defaults.json', import.meta.url), 'utf8'),
  ) as { rows: Record<SettingStorageKey, Record<string, unknown>> }
).rows;

/** A copy of a default with `path` (dotted) set to `value`; `undefined` deletes the field. */
function withField(key: SettingStorageKey, path: string, value: unknown): unknown {
  const copy = structuredClone(DEFAULTS[key]);
  const parts = path.split('.');
  let target: Record<string, unknown> = copy;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  const last = parts.at(-1) as string;
  if (value === undefined) {
    delete target[last];
  } else {
    target[last] = value;
  }
  return copy;
}

describe('settingIssues', () => {
  it('passes every committed default', () => {
    for (const key of SETTING_STORAGE_KEYS) {
      expect(settingIssues(key, DEFAULTS[key]), key).toEqual([]);
    }
  });

  it('passes values the owner may set', () => {
    expect(
      settingIssues('brand', {
        ...DEFAULTS.brand,
        hotline: '+842800000000',
        support_email: 'hello@kitchendaylight.example',
        tax_code: '0123456789',
        logo: '01930000-0000-7000-8000-000000000001',
      }),
    ).toEqual([]);
    expect(
      settingIssues('maintenance', {
        enabled: true,
        message: 'Bảo trì',
        expected_back_at: '2026-11-09T10:00:00.000Z',
        since: '2026-11-09T09:00:00+07:00',
      }),
    ).toEqual([]);
    expect(
      settingIssues('payment', {
        bank_name: 'Ngân hàng Mẫu',
        account_number: '0001112223',
        account_holder: 'CONG TY MAU',
        transfer_note_rule: 'Số đơn hàng',
        bank_code: '970400',
        qr_media_id: null,
      }),
    ).toEqual([]);
    expect(
      settingIssues('ordering', withField('ordering', 'auto_cancel_unaccepted_minutes', 30)),
    ).toEqual([]);
    expect(
      settingIssues('loyalty', {
        earn_vnd_per_point: 10000,
        redeem_vnd_per_point: 100,
        min_redeem_points: 50,
        expiry_months: null,
      }),
    ).toEqual([]);
  });

  it.each<[SettingStorageKey, string, unknown]>([
    ['brand', 'name', '   '],
    ['brand', 'name', 'x'.repeat(101)],
    ['brand', 'logo', 'not-a-uuid'],
    ['brand', 'hotline', '0900000000'],
    ['brand', 'support_email', 'no-at-sign'],
    ['brand', 'tax_code', '12345'],
    ['brand', 'receipt.title', 'x'.repeat(41)],
    ['brand', 'receipt.footer', 'a\nb\nc\nd\ne'],
    ['brand', 'receipt.paper_width', 72],
    ['brand', 'receipt.show_tax_code', 'false'],
    ['reports', 'business_day_starts_at', '24:00'],
    ['min_app_version', 'ios', '1.0'],
    ['min_app_version', 'android', '01.0.0'],
    ['maintenance', 'enabled', null],
    ['maintenance', 'expected_back_at', '2026-11-09'],
    ['feature_flags', 'einvoice', 1],
    ['payment', 'account_number', '12-34'],
    ['payment', 'bank_code', '12345'],
    ['ordering', 'max_item_quantity', 100],
    ['ordering', 'max_cart_lines', 0],
    ['ordering', 'item_note_max', 201],
    ['ordering', 'review_window_days', 7.5],
    ['ordering', 'board_thresholds.accept.warn', 10],
    ['ordering', 'board_thresholds.ready.late', 241],
    ['ordering', 'ready_unserved_warn_minutes', 10],
    ['ordering', 'auto_cancel_unaccepted_minutes', 10],
    ['ordering', 'list_max_range_days', 367],
    ['loyalty', 'expiry_months', 121],
    ['loyalty', 'earn_vnd_per_point', 0],
  ])('%s: refuses a bad %s', (key, path, value) => {
    expect(settingIssues(key, withField(key, path, value))).toEqual([path]);
  });

  it('names a missing field and an unknown one', () => {
    expect(settingIssues('reports', {})).toEqual(['business_day_starts_at']);
    expect(settingIssues('reports', { business_day_starts_at: '04:00', extra: 1 })).toEqual([
      'extra',
    ]);
    expect(settingIssues('brand', withField('brand', 'receipt.footer', undefined))).toEqual([
      'receipt.footer',
    ]);
  });

  it('refuses a value that is not an object', () => {
    expect(settingIssues('loyalty', null)).toEqual(['(value)']);
    expect(settingIssues('loyalty', [])).toEqual(['(value)']);
    expect(settingIssues('brand', withField('brand', 'receipt', 'x'))).toEqual(['receipt']);
  });

  it('reports paths only, never the value', () => {
    const issues = settingIssues('brand', withField('brand', 'hotline', 'S3cr3t-Value'));
    expect(JSON.stringify(issues)).not.toContain('S3cr3t-Value');
  });
});

describe('SETTING_STORAGE_KEYS', () => {
  it('are the eight keys of migration 0011, in its order', () => {
    expect(SETTING_STORAGE_KEYS).toEqual([
      'brand',
      'reports',
      'min_app_version',
      'maintenance',
      'feature_flags',
      'payment',
      'ordering',
      'loyalty',
    ]);
    expect(isSettingStorageKey('ordering')).toBe(true);
    expect(isSettingStorageKey('minAppVersion')).toBe(false);
  });
});
