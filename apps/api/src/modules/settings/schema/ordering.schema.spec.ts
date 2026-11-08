import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import { fromOrderingStored, orderingSchema, toOrderingStored } from './ordering.schema.js';

const DEFAULTS = SETTING_DEFAULTS.ordering;

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = orderingSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

function withChanges(changes: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULTS, ...changes };
}

function withThresholds(accept: unknown, ready: unknown = DEFAULTS.boardThresholds.ready) {
  return withChanges({ boardThresholds: { accept, ready } });
}

describe('orderingSchema', () => {
  it('accepts its own defaults and returns them as a plain object', () => {
    const result = orderingSchema.parse(DEFAULTS);

    expect(result).toEqual({ ok: true, value: DEFAULTS });
    expect(result.ok && Object.getPrototypeOf(result.value)).toBe(Object.prototype);
  });

  it('holds the WA16 and data-model defaults', () => {
    expect(DEFAULTS).toEqual({
      maxItemQuantity: 20,
      maxCartLines: 30,
      itemNoteMax: 200,
      scheduleMinLeadMinutes: 30,
      scheduleMaxDaysAhead: 3,
      reviewWindowDays: 7,
      autoCancelUnacceptedMinutes: null,
      boardThresholds: { accept: { warn: 5, late: 10 }, ready: { warn: 15, late: 25 } },
      boardRefetchSeconds: 15,
      readyUnservedWarnMinutes: 5,
      readyUnservedLateMinutes: 10,
      callHintMinutes: 10,
      listMaxRangeDays: 92,
    });
  });

  it('maps to the snake_case names of data-model and back', () => {
    const stored = toOrderingStored(DEFAULTS);

    expect(stored).toEqual({
      max_item_quantity: 20,
      max_cart_lines: 30,
      item_note_max: 200,
      schedule_min_lead_minutes: 30,
      schedule_max_days_ahead: 3,
      review_window_days: 7,
      auto_cancel_unaccepted_minutes: null,
      board_thresholds: { accept: { warn: 5, late: 10 }, ready: { warn: 15, late: 25 } },
      board_refetch_seconds: 15,
      ready_unserved_warn_minutes: 5,
      ready_unserved_late_minutes: 10,
      call_hint_minutes: 10,
      list_max_range_days: 92,
    });
    expect(fromOrderingStored(stored)).toEqual(DEFAULTS);
    const custom = { ...DEFAULTS, autoCancelUnacceptedMinutes: 30 };
    expect(fromOrderingStored(toOrderingStored(custom))).toEqual(custom);
  });

  it.each([
    ['maxItemQuantity', 99],
    ['maxItemQuantity', 1],
    ['itemNoteMax', 200],
    ['autoCancelUnacceptedMinutes', 11],
  ])('accepts %s = %s', (field, value) => {
    expect(errorsOf(withChanges({ [field]: value }))).toEqual([]);
  });

  it('reports a missing field as REQUIRED with its camelCase path', () => {
    const rest: Record<string, unknown> = { ...DEFAULTS };
    delete rest['maxItemQuantity'];

    expect(errorsOf(rest)).toEqual([{ field: 'ordering.maxItemQuantity', code: 'REQUIRED' }]);
  });

  it('reports a missing autoCancelUnacceptedMinutes as REQUIRED (null turns it off)', () => {
    const rest: Record<string, unknown> = { ...DEFAULTS };
    delete rest['autoCancelUnacceptedMinutes'];

    expect(errorsOf(rest)).toEqual([
      { field: 'ordering.autoCancelUnacceptedMinutes', code: 'REQUIRED' },
    ]);
  });

  it.each([
    ['maxItemQuantity', 100],
    ['maxItemQuantity', 0],
    ['maxCartLines', 0],
    ['itemNoteMax', 201],
    ['scheduleMinLeadMinutes', -1],
    ['scheduleMaxDaysAhead', 31],
    ['reviewWindowDays', 0],
    ['boardRefetchSeconds', 4],
    ['callHintMinutes', 0],
    ['listMaxRangeDays', 367],
    ['autoCancelUnacceptedMinutes', 1441],
  ])('reports %s = %s as OUT_OF_RANGE', (field, value) => {
    expect(errorsOf(withChanges({ [field]: value }))).toEqual([
      { field: `ordering.${field}`, code: 'OUT_OF_RANGE' },
    ]);
  });

  it.each([
    ['a string', '20'],
    ['a fraction', 20.5],
  ])('reports %s as INVALID', (_case, value) => {
    expect(errorsOf(withChanges({ maxItemQuantity: value }))).toEqual([
      { field: 'ordering.maxItemQuantity', code: 'INVALID' },
    ]);
  });

  it('reports an accept warn not below its late as MUST_BE_LESS_THAN_LATE', () => {
    expect(errorsOf(withThresholds({ warn: 10, late: 10 }))).toEqual([
      { field: 'ordering.boardThresholds.accept.warn', code: 'MUST_BE_LESS_THAN_LATE' },
    ]);
  });

  it('reports a ready warn not below its late as MUST_BE_LESS_THAN_LATE', () => {
    expect(
      errorsOf(withThresholds(DEFAULTS.boardThresholds.accept, { warn: 30, late: 25 })),
    ).toEqual([{ field: 'ordering.boardThresholds.ready.warn', code: 'MUST_BE_LESS_THAN_LATE' }]);
  });

  it('reports a ready-unserved warn not below its late as MUST_BE_LESS_THAN_LATE', () => {
    expect(
      errorsOf(withChanges({ readyUnservedWarnMinutes: 10, readyUnservedLateMinutes: 10 })),
    ).toEqual([{ field: 'ordering.readyUnservedWarnMinutes', code: 'MUST_BE_LESS_THAN_LATE' }]);
  });

  it('reports a threshold out of range before the warn and late rule', () => {
    expect(errorsOf(withThresholds({ warn: 0, late: 10 }))).toEqual([
      { field: 'ordering.boardThresholds.accept.warn', code: 'OUT_OF_RANGE' },
    ]);
  });

  it('reports an auto-cancel not above the accept late threshold as MUST_EXCEED_ACCEPT_LATE', () => {
    expect(errorsOf(withChanges({ autoCancelUnacceptedMinutes: 10 }))).toEqual([
      { field: 'ordering.autoCancelUnacceptedMinutes', code: 'MUST_EXCEED_ACCEPT_LATE' },
    ]);
  });

  it('reports a missing nested threshold with its full path', () => {
    expect(errorsOf(withThresholds({ late: 10 }))).toEqual([
      { field: 'ordering.boardThresholds.accept.warn', code: 'REQUIRED' },
    ]);
    expect(errorsOf(withChanges({ boardThresholds: undefined }))).toEqual([
      { field: 'ordering.boardThresholds', code: 'REQUIRED' },
    ]);
  });

  it('refuses a property the key does not declare', () => {
    expect(errorsOf(withChanges({ reservations: 1 }))).toEqual([
      { field: 'ordering.reservations', code: 'INVALID' },
    ]);
  });
});
