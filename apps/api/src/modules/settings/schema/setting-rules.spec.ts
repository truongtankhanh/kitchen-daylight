import { describe, expect, it } from 'vitest';

import { SETTING_STORAGE_KEYS } from '../entities/app-setting.entity.js';
import { SETTING_DEFAULTS } from '../settings-defaults.js';
import { SETTING_SCHEMAS, schemaOfStorageKey } from './registry.js';
import { SETTING_KEYS } from './setting-rules.js';

describe('setting schemas', () => {
  it('has one schema per key, each with its own storage key', () => {
    expect(Object.keys(SETTING_SCHEMAS)).toEqual([...SETTING_KEYS]);
    expect(SETTING_KEYS.map((key) => SETTING_SCHEMAS[key].storageKey)).toEqual([
      ...SETTING_STORAGE_KEYS,
    ]);
    for (const storageKey of SETTING_STORAGE_KEYS) {
      expect(schemaOfStorageKey(storageKey).storageKey).toBe(storageKey);
    }
  });

  it.each(SETTING_KEYS)('accepts the default of %s', (key) => {
    expect(SETTING_SCHEMAS[key].parse(SETTING_DEFAULTS[key])).toEqual({
      ok: true,
      value: SETTING_DEFAULTS[key],
    });
  });

  it.each([
    ['undefined', undefined, 'REQUIRED'],
    ['null', null, 'REQUIRED'],
    ['an array', [], 'INVALID'],
    ['a string', 'on', 'INVALID'],
  ])('reports a value that is %s against the key itself', (_case, raw, code) => {
    expect(SETTING_SCHEMAS.featureFlags.parse(raw)).toEqual({
      ok: false,
      errors: [{ field: 'featureFlags', code, message: expect.any(String) as unknown }],
    });
  });

  it('gives a fixed English message per code', () => {
    const result = SETTING_SCHEMAS.reports.parse({ businessDayStartsAt: '25:00' });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          field: 'reports.businessDayStartsAt',
          code: 'INVALID_TIME',
          message: 'must be a time of day HH:mm',
        },
      ],
    });
  });
});
