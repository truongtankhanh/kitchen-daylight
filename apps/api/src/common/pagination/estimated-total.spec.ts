import { describe, expect, it } from 'vitest';

import { ESTIMATED_TOTAL_CAP, toEstimatedTotal } from './estimated-total.js';

describe('toEstimatedTotal', () => {
  it('returns the exact count up to the cap', () => {
    expect(toEstimatedTotal(0)).toEqual({ value: 0, capped: false });
    expect(toEstimatedTotal(42)).toEqual({ value: 42, capped: false });
    expect(toEstimatedTotal(1000)).toEqual({ value: 1000, capped: false });
  });

  it('caps at 1000 when the bounded count found 1001 rows', () => {
    expect(ESTIMATED_TOTAL_CAP).toBe(1000);
    expect(toEstimatedTotal(1001)).toEqual({ value: 1000, capped: true });
  });

  it('accepts the bigint string of the pg driver', () => {
    expect(toEstimatedTotal('7')).toEqual({ value: 7, capped: false });
    expect(toEstimatedTotal('1001')).toEqual({ value: 1000, capped: true });
  });

  it('takes another cap', () => {
    expect(toEstimatedTotal(11, 10)).toEqual({ value: 10, capped: true });
    expect(toEstimatedTotal(10, 10)).toEqual({ value: 10, capped: false });
  });

  it.each([-1, 1.5, Number.NaN, 'x', '', ' ', '-1', '1.5'])('rejects the count %j', (count) => {
    expect(() => toEstimatedTotal(count)).toThrow(RangeError);
  });
});
