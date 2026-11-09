import type { FieldErrorCode } from '@kd/contracts';

import type { ApiFieldError } from '../../../common/errors/api-error.js';
import { addCalendarDays } from '../../../common/time/vietnam-time.js';
import { BRANCH_SERVICES } from '../entities/branch-opening-period.entity.js';
import type { BranchService } from '../entities/branch-opening-period.entity.js';

// Validation of `PUT /admin/branches/{id}/hours` (A5-T3; api-outline "Branches" row, brief C14,
// C15, C16; data-model `branch_opening_periods`, `branch_special_hours`). Pure: no I/O, no clock.
// It checks every item of `periods[]` and `special[]` itself, so all item errors carry one path
// style, `periods[2].openTime` (api-divergences D-137); the DTO checks the top level only.

/** `note` of a special day: internal, at most 200 characters (brief C13). */
export const SPECIAL_NOTE_MAX_LENGTH = 200;
/**
 * `displayNote` of a special day: customer-facing (mobile G12). The limit is not decided by the
 * documents; 80 is a proposal (api-divergences D-138). The one place the figure lives.
 */
export const SPECIAL_DISPLAY_NOTE_MAX_LENGTH = 80;
/** Bounds on the lists of one `PUT`, far above a real week or season (api-divergences D-138). */
export const HOURS_PERIODS_MAX = 100;
export const HOURS_SPECIAL_MAX = 100;

/** `HH:mm`, 00:00 to 23:59. A 24-hour day is 00:00 to 23:59 (brief C11, open). */
export const HOURS_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PERIOD_KEYS: ReadonlySet<string> = new Set(['service', 'dayOfWeek', 'openTime', 'closeTime']);
const SPECIAL_KEYS: ReadonlySet<string> = new Set([
  'startsOn',
  'endsOn',
  'service',
  'isClosed',
  'openTime',
  'closeTime',
  'note',
  'displayNote',
]);

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** A weekly period ready to store; `closesNextDay` is derived, never sent. */
export interface PeriodValue {
  readonly service: BranchService;
  readonly dayOfWeek: number;
  readonly openTime: string;
  readonly closeTime: string;
  readonly closesNextDay: boolean;
}

/** A special day ready to store; times and `closesNextDay` are null exactly when closed. */
export interface SpecialValue {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly service: BranchService;
  readonly isClosed: boolean;
  readonly openTime: string | null;
  readonly closeTime: string | null;
  readonly closesNextDay: boolean | null;
  readonly note: string | null;
  readonly displayNote: string | null;
}

/** A stored special range kept by the `PUT` (ended before today). */
export interface SpecialRange {
  readonly service: BranchService;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface HoursInput {
  readonly periods: readonly unknown[];
  readonly special: readonly unknown[];
}

/**
 * The result: every error found, and the values in the order sent. The values are complete only
 * when `errors` is empty.
 */
export interface HoursValidation {
  readonly errors: ApiFieldError[];
  readonly periods: PeriodValue[];
  readonly special: SpecialValue[];
}

const MESSAGES: Readonly<Partial<Record<FieldErrorCode, string>>> = {
  REQUIRED: 'is required',
  INVALID_TIME: 'must be a time HH:mm from 00:00 to 23:59',
  EQUAL_TIMES: 'must differ from the opening time',
  RANGE_INVALID: 'must be on or after the start date',
  TOO_LONG: 'is too long',
};

function error(field: string, code: FieldErrorCode, message?: string): ApiFieldError {
  return { field, code, message: message ?? MESSAGES[code] ?? 'is invalid' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

function minutesOf(time: string): number {
  const match = HOURS_TIME_PATTERN.exec(time);
  return Number(match?.[1]) * 60 + Number(match?.[2]);
}

/** True for a real `YYYY-MM-DD` calendar date. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) {
    return false;
  }
  try {
    addCalendarDays(value, 0);
    return true;
  } catch {
    return false;
  }
}

/** Collects the errors of one item; `ok` stays true while none was added. */
class ItemCheck {
  ok = true;

  constructor(
    private readonly errors: ApiFieldError[],
    private readonly path: string,
  ) {}

  add(key: string, code: FieldErrorCode, message?: string): void {
    this.errors.push(error(`${this.path}.${key}`, code, message));
    this.ok = false;
  }

  unknownKeys(item: Record<string, unknown>, allowed: ReadonlySet<string>): void {
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) {
        this.add(key, 'INVALID', 'is not allowed');
      }
    }
  }

  service(value: unknown): BranchService | undefined {
    if (isMissing(value)) {
      this.add('service', 'REQUIRED');
      return undefined;
    }
    if (!(BRANCH_SERVICES as readonly unknown[]).includes(value)) {
      this.add('service', 'INVALID', 'must be STORE or DELIVERY');
      return undefined;
    }
    return value as BranchService;
  }

  time(key: string, value: unknown): string | undefined {
    if (isMissing(value)) {
      this.add(key, 'REQUIRED');
      return undefined;
    }
    if (typeof value !== 'string' || !HOURS_TIME_PATTERN.test(value)) {
      this.add(key, 'INVALID_TIME');
      return undefined;
    }
    return value;
  }

  date(key: string, value: unknown): string | undefined {
    if (isMissing(value)) {
      this.add(key, 'REQUIRED');
      return undefined;
    }
    if (!isCalendarDate(value)) {
      this.add(key, 'INVALID', 'must be a date YYYY-MM-DD');
      return undefined;
    }
    return value;
  }

  /** Optional text: trimmed, blank stored as null, at most `max` code points. */
  text(key: string, value: unknown, max: number): string | null {
    if (isMissing(value)) {
      return null;
    }
    if (typeof value !== 'string') {
      this.add(key, 'INVALID', 'must be a string');
      return null;
    }
    const trimmed = value.trim();
    if ([...trimmed].length > max) {
      this.add(key, 'TOO_LONG');
      return null;
    }
    return trimmed === '' ? null : trimmed;
  }
}

function periodOf(errors: ApiFieldError[], raw: unknown, index: number): PeriodValue | undefined {
  const path = `periods[${index}]`;
  if (!isRecord(raw)) {
    errors.push(error(path, 'INVALID', 'must be an object'));
    return undefined;
  }
  const check = new ItemCheck(errors, path);
  check.unknownKeys(raw, PERIOD_KEYS);
  const service = check.service(raw['service']);
  const day = raw['dayOfWeek'];
  if (isMissing(day)) {
    check.add('dayOfWeek', 'REQUIRED');
  } else if (typeof day !== 'number' || !Number.isInteger(day)) {
    check.add('dayOfWeek', 'INVALID', 'must be an integer');
  } else if (day < 1 || day > 7) {
    check.add('dayOfWeek', 'OUT_OF_RANGE', 'must be 1 (Monday) to 7 (Sunday)');
  }
  const openTime = check.time('openTime', raw['openTime']);
  const closeTime = check.time('closeTime', raw['closeTime']);
  if (openTime !== undefined && closeTime !== undefined && openTime === closeTime) {
    check.add('closeTime', 'EQUAL_TIMES');
  }
  if (!check.ok || service === undefined || openTime === undefined || closeTime === undefined) {
    return undefined;
  }
  return {
    service,
    dayOfWeek: day as number,
    openTime,
    closeTime,
    closesNextDay: minutesOf(closeTime) <= minutesOf(openTime),
  };
}

function specialOf(
  errors: ApiFieldError[],
  raw: unknown,
  index: number,
  today: string,
): SpecialValue | undefined {
  const path = `special[${index}]`;
  if (!isRecord(raw)) {
    errors.push(error(path, 'INVALID', 'must be an object'));
    return undefined;
  }
  const check = new ItemCheck(errors, path);
  check.unknownKeys(raw, SPECIAL_KEYS);
  const startsOn = check.date('startsOn', raw['startsOn']);
  const endsOn = check.date('endsOn', raw['endsOn']);
  if (startsOn !== undefined && endsOn !== undefined) {
    if (startsOn > endsOn) {
      check.add('endsOn', 'RANGE_INVALID');
    } else if (endsOn < today) {
      // Days that ended before today are history: a `PUT` neither writes nor removes them.
      check.add('endsOn', 'OUT_OF_RANGE', 'must be today or later');
    }
  }
  const service = check.service(raw['service']);
  const isClosed = raw['isClosed'];
  if (isMissing(isClosed)) {
    check.add('isClosed', 'REQUIRED');
  } else if (typeof isClosed !== 'boolean') {
    check.add('isClosed', 'INVALID', 'must be a boolean');
  }
  let openTime: string | undefined;
  let closeTime: string | undefined;
  if (isClosed === true) {
    for (const key of ['openTime', 'closeTime']) {
      if (!isMissing(raw[key])) {
        check.add(key, 'INVALID', 'must be empty on a closed day');
      }
    }
  } else if (isClosed === false) {
    openTime = check.time('openTime', raw['openTime']);
    closeTime = check.time('closeTime', raw['closeTime']);
    if (openTime !== undefined && closeTime !== undefined && openTime === closeTime) {
      check.add('closeTime', 'EQUAL_TIMES');
    }
  }
  const note = check.text('note', raw['note'], SPECIAL_NOTE_MAX_LENGTH);
  const displayNote = check.text(
    'displayNote',
    raw['displayNote'],
    SPECIAL_DISPLAY_NOTE_MAX_LENGTH,
  );
  if (
    !check.ok ||
    startsOn === undefined ||
    endsOn === undefined ||
    service === undefined ||
    typeof isClosed !== 'boolean'
  ) {
    return undefined;
  }
  const times =
    isClosed || openTime === undefined || closeTime === undefined
      ? { openTime: null, closeTime: null, closesNextDay: null }
      : { openTime, closeTime, closesNextDay: minutesOf(closeTime) <= minutesOf(openTime) };
  return { startsOn, endsOn, service, isClosed, ...times, note, displayNote };
}

/** Minutes of the week a period covers, Monday 00:00 = 0; the end may pass the week's end. */
function weekSpan(period: PeriodValue): { start: number; end: number } {
  const open = minutesOf(period.openTime);
  const close = minutesOf(period.closeTime);
  const start = (period.dayOfWeek - 1) * MINUTES_PER_DAY + open;
  const length = period.closesNextDay ? close + MINUTES_PER_DAY - open : close - open;
  return { start, end: start + length };
}

/** Two periods share a minute, Sunday night into Monday included. */
function periodsOverlap(a: PeriodValue, b: PeriodValue): boolean {
  const first = weekSpan(a);
  const second = weekSpan(b);
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some(
    (shift) => first.start < second.end + shift && second.start + shift < first.end,
  );
}

function rangesOverlap(a: SpecialRange, b: SpecialRange): boolean {
  return a.service === b.service && a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
}

/**
 * Validates the lists of a `PUT` against the rules of brief C14 to C16. `today` is the Vietnam
 * date of the request (`YYYY-MM-DD`). Overlaps are reported once, on the later item of a pair.
 */
export function validateHours(input: HoursInput, today: string): HoursValidation {
  const errors: ApiFieldError[] = [];
  const periods = input.periods.map((raw, index) => periodOf(errors, raw, index));
  const special = input.special.map((raw, index) => specialOf(errors, raw, index, today));

  periods.forEach((period, index) => {
    if (period === undefined) {
      return;
    }
    const clash = periods
      .slice(0, index)
      .some(
        (earlier) =>
          earlier !== undefined &&
          earlier.service === period.service &&
          periodsOverlap(earlier, period),
      );
    if (clash) {
      errors.push(error(`periods[${index}].openTime`, 'OVERLAP', 'overlaps another period'));
    }
  });
  special.forEach((day, index) => {
    if (day === undefined) {
      return;
    }
    const clash = special
      .slice(0, index)
      .some((earlier) => earlier !== undefined && rangesOverlap(earlier, day));
    if (clash) {
      errors.push(error(`special[${index}].startsOn`, 'OVERLAP', 'overlaps another special day'));
    }
  });

  return {
    errors,
    periods: periods.filter((period): period is PeriodValue => period !== undefined),
    special: special.filter((day): day is SpecialValue => day !== undefined),
  };
}

/**
 * Overlaps of the special days sent with the history the `PUT` keeps (ranges of the same service
 * that ended before today). Call with the `special` values of an error-free `validateHours`, so
 * the indexes are the ones sent.
 */
export function historyOverlapErrors(
  special: readonly SpecialValue[],
  history: readonly SpecialRange[],
): ApiFieldError[] {
  return special.flatMap((day, index) =>
    history.some((kept) => rangesOverlap(kept, day))
      ? [error(`special[${index}].startsOn`, 'OVERLAP', 'overlaps a past special day')]
      : [],
  );
}
