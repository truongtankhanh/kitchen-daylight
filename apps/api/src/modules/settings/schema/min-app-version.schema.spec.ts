import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import {
  fromMinAppVersionStored,
  minAppVersionSchema,
  toMinAppVersionStored,
} from './min-app-version.schema.js';

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = minAppVersionSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

describe('minAppVersionSchema', () => {
  it('accepts its own default, 0.0.0 on both platforms', () => {
    expect(SETTING_DEFAULTS.minAppVersion).toEqual({ ios: '0.0.0', android: '0.0.0' });
    expect(minAppVersionSchema.parse(SETTING_DEFAULTS.minAppVersion)).toEqual({
      ok: true,
      value: SETTING_DEFAULTS.minAppVersion,
    });
  });

  it('is stored under min_app_version with the same field names', () => {
    const value = { ios: '1.2.3', android: '10.0.1' };

    expect(minAppVersionSchema.storageKey).toBe('min_app_version');
    expect(toMinAppVersionStored(value)).toEqual(value);
    expect(fromMinAppVersionStored(toMinAppVersionStored(value))).toEqual(value);
  });

  it.each(['0.0.0', '1.2.3', '10.20.300'])('accepts %s', (version) => {
    expect(errorsOf({ ios: version, android: version })).toEqual([]);
  });

  it.each(['1.2', '1.2.3.4', '01.2.3', 'v1.2.3', '1.2.3-beta', ''])(
    'reports %j as INVALID_FORMAT',
    (version) => {
      expect(errorsOf({ ios: version, android: '1.0.0' })).toEqual([
        { field: 'minAppVersion.ios', code: 'INVALID_FORMAT' },
      ]);
    },
  );

  it('reports a missing platform as REQUIRED', () => {
    expect(errorsOf({ ios: '1.0.0' })).toEqual([
      { field: 'minAppVersion.android', code: 'REQUIRED' },
    ]);
  });
});
