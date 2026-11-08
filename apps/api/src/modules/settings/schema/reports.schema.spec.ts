import { describe, expect, it } from 'vitest';

import { businessDateOf } from '../../../common/time/business-date.js';
import { SETTING_DEFAULTS } from '../settings-defaults.js';
import { fromReportsStored, reportsSchema, toReportsStored } from './reports.schema.js';

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = reportsSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

describe('reportsSchema', () => {
  it('accepts its own default, 04:00 (WA14)', () => {
    expect(SETTING_DEFAULTS.reports).toEqual({ businessDayStartsAt: '04:00' });
    expect(reportsSchema.parse(SETTING_DEFAULTS.reports)).toEqual({
      ok: true,
      value: SETTING_DEFAULTS.reports,
    });
  });

  it('maps to the snake_case name of data-model and back', () => {
    expect(toReportsStored({ businessDayStartsAt: '04:00' })).toEqual({
      business_day_starts_at: '04:00',
    });
    expect(fromReportsStored(toReportsStored({ businessDayStartsAt: '00:00' }))).toEqual({
      businessDayStartsAt: '00:00',
    });
  });

  it.each(['00:00', '04:00', '12:30', '23:59'])(
    'accepts %s, which the business-day helper accepts too',
    (cutoff) => {
      expect(errorsOf({ businessDayStartsAt: cutoff })).toEqual([]);
      expect(() => businessDateOf(new Date('2026-11-08T00:00:00.000Z'), cutoff)).not.toThrow();
    },
  );

  it.each(['24:00', '4:00', '04:60', '04:00:00', ' 04:00'])(
    'reports %s as INVALID_TIME',
    (cutoff) => {
      expect(errorsOf({ businessDayStartsAt: cutoff })).toEqual([
        { field: 'reports.businessDayStartsAt', code: 'INVALID_TIME' },
      ]);
    },
  );

  it('reports a missing cutoff as REQUIRED', () => {
    expect(errorsOf({})).toEqual([{ field: 'reports.businessDayStartsAt', code: 'REQUIRED' }]);
  });
});
