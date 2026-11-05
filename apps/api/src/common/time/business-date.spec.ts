import { describe, expect, it } from 'vitest';

import { businessDateOf, businessDayWindow } from './business-date.js';

// Vietnam wall clock → UTC instant (UTC+7).
function vn(wallClock: string): Date {
  return new Date(`${wallClock}+07:00`);
}

describe('businessDateOf (testing-strategy, "Business day")', () => {
  it.each([
    ['00:30 with a 04:00 cutoff is the previous day', '2026-10-27T00:30:00', '04:00', '2026-10-26'],
    ['04:30 with a 04:00 cutoff is the same day', '2026-10-27T04:30:00', '04:00', '2026-10-27'],
    ['exactly 04:00 is the same day', '2026-10-27T04:00:00', '04:00', '2026-10-27'],
    ['03:59:59 is the previous day', '2026-10-27T03:59:59', '04:00', '2026-10-26'],
    [
      'the first of a month goes back to the last of the previous',
      '2026-11-01T01:00:00',
      '04:00',
      '2026-10-31',
    ],
    ['New Year goes back to 31 December', '2027-01-01T02:00:00', '04:00', '2026-12-31'],
    [
      '1 March of a leap year goes back to 29 February',
      '2028-03-01T03:00:00',
      '04:00',
      '2028-02-29',
    ],
    [
      '1 March of a common year goes back to 28 February',
      '2027-03-01T03:00:00',
      '04:00',
      '2027-02-28',
    ],
    ['29 February itself, after the cutoff', '2028-02-29T12:00:00', '04:00', '2028-02-29'],
    ['00:00 means calendar days, at midnight', '2026-10-27T00:00:00', '00:00', '2026-10-27'],
    [
      '00:00 means calendar days, just before midnight',
      '2026-10-27T23:59:59',
      '00:00',
      '2026-10-27',
    ],
  ])('%s', (_case, wallClock, cutoff, date) => {
    expect(businessDateOf(vn(wallClock), cutoff)).toBe(date);
  });

  it('uses the Vietnam date, not the UTC date', () => {
    // 2026-10-26T20:00Z is 03:00 on 27 October in Vietnam.
    expect(businessDateOf(new Date('2026-10-26T20:00:00Z'), '04:00')).toBe('2026-10-26');
    expect(businessDateOf(new Date('2026-10-26T21:00:00Z'), '04:00')).toBe('2026-10-27');
  });

  it.each(['4:00', '24:00', '04:60', '04:00:00', ''])('rejects the cutoff %j', (cutoff) => {
    expect(() => businessDateOf(vn('2026-10-27T12:00:00'), cutoff)).toThrow(RangeError);
  });
});

describe('businessDayWindow', () => {
  it('runs from the cutoff on the date to the cutoff on the next date', () => {
    const window = businessDayWindow('2026-10-26', '04:00');
    expect(window.start.toISOString()).toBe(vn('2026-10-26T04:00:00').toISOString());
    expect(window.end.toISOString()).toBe(vn('2026-10-27T04:00:00').toISOString());
  });

  it('is a calendar day with a 00:00 cutoff', () => {
    const window = businessDayWindow('2026-10-27', '00:00');
    expect(window.start.toISOString()).toBe('2026-10-26T17:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-27T17:00:00.000Z');
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(businessDayWindow('2026-12-31', '04:00').end.toISOString()).toBe(
      vn('2027-01-01T04:00:00').toISOString(),
    );
    expect(businessDayWindow('2028-02-28', '04:00').end.toISOString()).toBe(
      vn('2028-02-29T04:00:00').toISOString(),
    );
    expect(businessDayWindow('2028-02-29', '04:00').end.toISOString()).toBe(
      vn('2028-03-01T04:00:00').toISOString(),
    );
  });

  it('agrees with businessDateOf: start is in the day, end is not', () => {
    const window = businessDayWindow('2026-10-26', '04:00');
    expect(businessDateOf(window.start, '04:00')).toBe('2026-10-26');
    expect(businessDateOf(new Date(window.end.getTime() - 1), '04:00')).toBe('2026-10-26');
    expect(businessDateOf(window.end, '04:00')).toBe('2026-10-27');
  });

  it('rejects an invalid date', () => {
    expect(() => businessDayWindow('2026-02-29', '04:00')).toThrow(RangeError);
  });
});
