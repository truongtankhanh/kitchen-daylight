import {
  addCalendarDays,
  formatVietnamDate,
  startOfVietnamDay,
  vietnamDateParts,
} from './vietnam-time.js';

// Business day of the restaurant (data-model, `orders.business_date` and `app_settings.reports`):
// the Vietnam date of an instant minus the cutoff `reports.business_day_starts_at`, so an order
// finished at 00:30 with a 04:00 cutoff belongs to the previous day. The caller reads the setting
// (A4); these functions are pure.

const CUTOFF = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE = 60_000;

/** Minutes after midnight of an `HH:mm` cutoff (`00:00` to `23:59`). */
function cutoffMinutes(cutoff: string): number {
  const match = CUTOFF.exec(cutoff);
  if (match === null) {
    throw new RangeError('Expected a business-day cutoff HH:mm.');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The business date (`YYYY-MM-DD`) of an instant: its Vietnam date, or the day before when its
 * Vietnam time is before the cutoff. A cutoff of `00:00` gives calendar days.
 */
export function businessDateOf(instant: Date, cutoff: string): string {
  const minutes = cutoffMinutes(cutoff);
  const { hour, minute } = vietnamDateParts(instant);
  const date = formatVietnamDate(instant);
  return hour * 60 + minute < minutes ? addCalendarDays(date, -1) : date;
}

/** The instants `[start, end)` of one business date. */
export interface BusinessDayWindow {
  readonly start: Date;
  readonly end: Date;
}

/**
 * The window of a business date: from the cutoff on that Vietnam date to the cutoff on the next,
 * end excluded. The zone has a fixed offset, so adding the cutoff minutes to the start of the
 * Vietnam day is exact.
 */
export function businessDayWindow(date: string, cutoff: string): BusinessDayWindow {
  const offset = cutoffMinutes(cutoff) * MINUTE;
  return {
    start: new Date(startOfVietnamDay(date).getTime() + offset),
    end: new Date(startOfVietnamDay(addCalendarDays(date, 1)).getTime() + offset),
  };
}
