/**
 * The business time zone (decision 0007 section 8): one constant, never an environment variable,
 * because it defines stored values (`business_date`, the date in `order_number`, report days).
 * SQL that needs a Vietnam date receives it as a parameter (`AT TIME ZONE $n`).
 */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Wall-clock fields of an instant in the business time zone; `month` is 1 to 12. */
export interface VietnamDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

// Built once; `Intl` with the IANA zone, no time library (decision 0007 section 8).
const WALL_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function assertInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Expected a valid instant.');
  }
}

export function vietnamDateParts(instant: Date): VietnamDateParts {
  assertInstant(instant);
  const parts = WALL_CLOCK.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The Vietnam calendar date of an instant, `YYYY-MM-DD`. */
export function formatVietnamDate(instant: Date): string {
  const { year, month, day } = vietnamDateParts(instant);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The `yyMMdd` stamp of `order_number` (`{branch code}-{yyMMdd}-{seq}`, Vietnam date). */
export function formatOrderDateStamp(instant: Date): string {
  const { year, month, day } = vietnamDateParts(instant);
  return `${pad(year % 100)}${pad(month)}${pad(day)}`;
}

function parseCalendarDate(date: string): { year: number; month: number; day: number } {
  const match = CALENDAR_DATE.exec(date);
  if (match !== null) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day
    ) {
      return { year, month, day };
    }
  }
  throw new RangeError('Expected a calendar date YYYY-MM-DD.');
}

/** A `YYYY-MM-DD` calendar date moved by whole days (month, year and leap days included). */
export function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = parseCalendarDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

// Offset of the zone from UTC at an instant, in milliseconds (to the second).
function zoneOffset(millis: number): number {
  const wall = vietnamDateParts(new Date(millis));
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(millis / 1000) * 1000;
}

/** The instant of 00:00 in Vietnam on a `YYYY-MM-DD` calendar date. */
export function startOfVietnamDay(date: string): Date {
  const { year, month, day } = parseCalendarDate(date);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  // The offset is read at the guess, then once more at the result, so a zone rule change
  // between the two instants is still honoured.
  const guess = midnightAsUtc - zoneOffset(midnightAsUtc);
  return new Date(midnightAsUtc - zoneOffset(guess));
}
