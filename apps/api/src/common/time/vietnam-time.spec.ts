import { describe, expect, it } from 'vitest';

import {
  BUSINESS_TIME_ZONE,
  addCalendarDays,
  formatOrderDateStamp,
  formatVietnamDate,
  startOfVietnamDay,
  vietnamDateParts,
} from './vietnam-time.js';

describe('BUSINESS_TIME_ZONE', () => {
  it('is the Vietnam zone of decision 0007', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Ho_Chi_Minh');
  });
});

describe('vietnamDateParts', () => {
  it('reads the wall clock at UTC+7', () => {
    expect(vietnamDateParts(new Date('2026-10-26T17:30:05Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 27,
      hour: 0,
      minute: 30,
      second: 5,
    });
  });

  it('gives hour 0, never 24, at midnight', () => {
    expect(vietnamDateParts(new Date('2026-10-26T17:00:00Z')).hour).toBe(0);
  });

  it('rejects an invalid instant', () => {
    expect(() => vietnamDateParts(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('formatVietnamDate and formatOrderDateStamp', () => {
  it.each([
    ['2026-10-27T03:00:00Z', '2026-10-27', '261027'],
    ['2026-10-26T16:59:59Z', '2026-10-26', '261026'],
    ['2026-10-26T17:00:00Z', '2026-10-27', '261027'],
    ['2026-12-31T17:00:00Z', '2027-01-01', '270101'],
    ['2028-02-28T17:00:00Z', '2028-02-29', '280229'],
    ['2030-01-05T00:00:00Z', '2030-01-05', '300105'],
  ])('%s is %s in Vietnam (stamp %s)', (instant, date, stamp) => {
    expect(formatVietnamDate(new Date(instant))).toBe(date);
    expect(formatOrderDateStamp(new Date(instant))).toBe(stamp);
  });
});

describe('startOfVietnamDay', () => {
  it.each([
    ['2026-10-27', '2026-10-26T17:00:00.000Z'],
    ['2027-01-01', '2026-12-31T17:00:00.000Z'],
    ['2028-02-29', '2028-02-28T17:00:00.000Z'],
  ])('00:00 of %s is %s', (date, instant) => {
    expect(startOfVietnamDay(date).toISOString()).toBe(instant);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-1-1', '27/10/2026', ''])('rejects %j', (date) => {
    expect(() => startOfVietnamDay(date)).toThrow(RangeError);
  });
});

describe('addCalendarDays', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addCalendarDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addCalendarDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});
