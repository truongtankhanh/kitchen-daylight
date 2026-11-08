import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import {
  featureFlagsSchema,
  fromFeatureFlagsStored,
  toFeatureFlagsStored,
} from './feature-flags.schema.js';

const DEFAULTS = SETTING_DEFAULTS.featureFlags;

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = featureFlagsSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

describe('featureFlagsSchema', () => {
  it('accepts its own defaults: ordering and delivery on, everything else off', () => {
    expect(DEFAULTS).toEqual({
      ordering: true,
      delivery: true,
      reservations: false,
      loyalty: false,
      vouchers: false,
      promotions: false,
      charts: false,
      einvoice: false,
    });
    expect(featureFlagsSchema.parse(DEFAULTS)).toEqual({ ok: true, value: DEFAULTS });
  });

  it('is stored under feature_flags with the same field names', () => {
    const value = { ...DEFAULTS, loyalty: true };

    expect(featureFlagsSchema.storageKey).toBe('feature_flags');
    expect(toFeatureFlagsStored(value)).toEqual(value);
    expect(fromFeatureFlagsStored(toFeatureFlagsStored(value))).toEqual(value);
  });

  it('reports a missing flag as REQUIRED', () => {
    const rest: Record<string, unknown> = { ...DEFAULTS };
    delete rest['einvoice'];

    expect(errorsOf(rest)).toEqual([{ field: 'featureFlags.einvoice', code: 'REQUIRED' }]);
  });

  it('reports a flag that is not a boolean as INVALID', () => {
    expect(errorsOf({ ...DEFAULTS, ordering: 'true' })).toEqual([
      { field: 'featureFlags.ordering', code: 'INVALID' },
    ]);
  });

  it('refuses a flag the key does not declare', () => {
    expect(errorsOf({ ...DEFAULTS, tables: true })).toEqual([
      { field: 'featureFlags.tables', code: 'INVALID' },
    ]);
  });
});
