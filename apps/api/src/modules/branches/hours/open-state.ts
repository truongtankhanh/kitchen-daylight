import { addCalendarDays } from '../../../common/time/vietnam-time.js';
import type { BranchService } from '../entities/branch-opening-period.entity.js';
import type { BranchStatus } from '../entities/branch.entity.js';

// The open-state calculator (A5-T3; data-model "Query patterns", "Open now"; brief C12). Pure: no
// I/O, no clock, no machine time zone. The caller passes the instant and the zone (normally
// `BUSINESS_TIME_ZONE`). Reused by the public `openState` (A7-T1) and the order checks (A8-T3,
// A8-T4).
//
// Rules:
// - A session belongs to the date it starts on; one that crosses midnight runs to its end the
//   next day, whatever that next day's own hours are.
// - A special day replaces the weekly periods of its service for every date it covers; a closed
//   special day removes the sessions that start on those dates.
// - Effective `DELIVERY` hours are the delivery hours (weekly or special) intersected with the
//   effective `STORE` hours. Without any weekly `DELIVERY` period, delivery follows `STORE`.
// - `CLOSED` and `TEMPORARILY_CLOSED` branches are shut, with no next change.
// - Orders stop `orderCutoffMinutes` before the end of a session.

const MINUTE = 60_000;
/** How far `nextChangeAt` looks ahead. */
export const LOOK_AHEAD_DAYS = 14;
const LOOK_AHEAD_MS = LOOK_AHEAD_DAYS * 24 * 60 * MINUTE;

/** `HH:mm`, or `HH:mm:ss` as PostgreSQL returns a `time`. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One row of `branch_opening_periods`; `dayOfWeek` 1 to 7, Monday = 1. */
export interface WeeklyPeriod {
  readonly service: BranchService;
  readonly dayOfWeek: number;
  readonly openTime: string;
  readonly closeTime: string;
}

/** One row of `branch_special_hours`; the times are null on a closed range. */
export interface SpecialDay {
  readonly service: BranchService;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly isClosed: boolean;
  readonly openTime: string | null;
  readonly closeTime: string | null;
}

/** The hours of one branch: what `getSessionsForDate` reads. */
export interface BranchHours {
  /** IANA zone the periods are written in, for example `BUSINESS_TIME_ZONE`. */
  readonly timeZone: string;
  readonly periods: readonly WeeklyPeriod[];
  readonly specialDays: readonly SpecialDay[];
}

export interface OpenStateInput extends BranchHours {
  readonly status: BranchStatus;
  readonly acceptsPickup: boolean;
  readonly acceptsDelivery: boolean;
  /** Not read by the order states; kept so reservations (A14) take the same input. */
  readonly acceptsReservations: boolean;
  readonly orderCutoffMinutes: number;
}

/** One effective session; `date` is the date it starts on, in the input zone. */
export interface Session {
  readonly date: string;
  readonly openTime: string;
  readonly closeTime: string;
  readonly closesNextDay: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** The `reason` members of `BRANCH_CLOSED` (api-outline, "Payloads added to existing codes"). */
export type ClosedReason = 'CLOSED' | 'PAUSED' | 'PAST_CUTOFF' | 'SERVICE_OFF';

export interface ServiceState {
  /** Inside a session of the service's effective hours (and the branch is `ACTIVE`). */
  readonly isOpen: boolean;
  readonly acceptingOrders: boolean;
  /** End of the session minus the cutoff, while open and the service is on; else null. */
  readonly acceptingUntil: Date | null;
  /** End of the current session, or start of the next one within 14 days; else null. */
  readonly nextChangeAt: Date | null;
  /** Why orders are refused; absent while accepting. */
  readonly reason?: ClosedReason;
}

export type OpenStateValue = 'OPEN' | 'CLOSED' | 'TEMPORARILY_CLOSED';

/** The `openState` of `BranchSummary` (api-outline "Response shapes"; mobile G4, G5). */
export interface OpenState {
  readonly state: OpenStateValue;
  readonly nextChangeAt: Date | null;
  readonly acceptingOrders: boolean;
  readonly acceptingUntil: Date | null;
  readonly delivery: { readonly state: OpenStateValue; readonly nextChangeAt: Date | null };
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------------------------
// Wall clock in a given zone (`Intl`, as `common/time/vietnam-time.ts`, but for any zone)
// ---------------------------------------------------------------------------------------------

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

interface WallClock {
  readonly date: string;
  readonly minuteOfDay: number;
  /** The wall-clock fields read as if they were UTC, in milliseconds. */
  readonly asUtc: number;
}

function wallClock(millis: number, timeZone: string): WallClock {
  const parts = formatterOf(timeZone).formatToParts(new Date(millis));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const [year, month, day] = [read('year'), read('month'), read('day')];
  const [hour, minute, second] = [read('hour'), read('minute'), read('second')];
  return {
    date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    minuteOfDay: hour * 60 + minute,
    asUtc: Date.UTC(year, month - 1, day, hour, minute, second),
  };
}

function zoneOffset(millis: number, timeZone: string): number {
  return wallClock(millis, timeZone).asUtc - Math.floor(millis / 1000) * 1000;
}

function calendarParts(date: string): { year: number; month: number; day: number } {
  addCalendarDays(date, 0); // Throws a RangeError on anything but a real calendar date.
  const match = CALENDAR_DATE.exec(date);
  return { year: Number(match?.[1]), month: Number(match?.[2]), day: Number(match?.[3]) };
}

/** The instant of a wall-clock minute on a date in the zone. */
function zonedInstant(date: string, minuteOfDay: number, timeZone: string): number {
  const { year, month, day } = calendarParts(date);
  const wall = Date.UTC(year, month - 1, day) + minuteOfDay * MINUTE;
  // Offset read at the guess, then at the result, as `startOfVietnamDay`.
  const guess = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(guess, timeZone);
}

/** ISO day of week of a calendar date: Monday = 1 to Sunday = 7. */
export function isoDayOfWeek(date: string): number {
  const { year, month, day } = calendarParts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Minutes after midnight of `HH:mm` or `HH:mm:ss` (seconds ignored). */
export function minutesOf(time: string): number {
  const match = TIME.exec(time);
  if (match === null) {
    throw new RangeError('Expected a time HH:mm.');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `HH:mm` of minutes after midnight. */
export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The local date of an instant in the zone, `YYYY-MM-DD`. */
export function localDateOf(instant: Date, timeZone: string): string {
  return wallClock(instant.getTime(), timeZone).date;
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

function sessionOf(date: string, openTime: string, closeTime: string, timeZone: string): Session {
  const open = minutesOf(openTime);
  const close = minutesOf(closeTime);
  const closesNextDay = close <= open;
  return {
    date,
    openTime: formatMinutes(open),
    closeTime: formatMinutes(close),
    closesNextDay,
    startsAt: new Date(zonedInstant(date, open, timeZone)),
    endsAt: new Date(
      zonedInstant(closesNextDay ? addCalendarDays(date, 1) : date, close, timeZone),
    ),
  };
}

function sessionFromInterval(date: string, interval: Interval, timeZone: string): Session {
  const start = wallClock(interval.start, timeZone);
  const end = wallClock(interval.end, timeZone);
  return {
    date,
    openTime: formatMinutes(start.minuteOfDay),
    closeTime: formatMinutes(end.minuteOfDay),
    closesNextDay: end.date !== date,
    startsAt: new Date(interval.start),
    endsAt: new Date(interval.end),
  };
}

function byStart(a: Session, b: Session): number {
  return a.startsAt.getTime() - b.startsAt.getTime();
}

function specialFor(
  input: BranchHours,
  date: string,
  service: BranchService,
): SpecialDay | undefined {
  return input.specialDays.find(
    (special) => special.service === service && special.startsOn <= date && date <= special.endsOn,
  );
}

/** The sessions of one service's own rows (special day first, else weekly) starting on `date`. */
function ownSessions(input: BranchHours, date: string, service: BranchService): Session[] {
  const special = specialFor(input, date, service);
  if (special !== undefined) {
    return special.isClosed || special.openTime === null || special.closeTime === null
      ? []
      : [sessionOf(date, special.openTime, special.closeTime, input.timeZone)];
  }
  const dayOfWeek = isoDayOfWeek(date);
  return input.periods
    .filter((period) => period.service === service && period.dayOfWeek === dayOfWeek)
    .map((period) => sessionOf(date, period.openTime, period.closeTime, input.timeZone))
    .sort(byStart);
}

/** Delivery's own hours on `date`: its special day, its weekly periods, or the store's. */
function deliveryOwnSessions(input: BranchHours, date: string): Session[] {
  const hasOwnRows =
    specialFor(input, date, 'DELIVERY') !== undefined ||
    input.periods.some((period) => period.service === 'DELIVERY');
  return ownSessions(input, date, hasOwnRows ? 'DELIVERY' : 'STORE');
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

function toInterval(session: Session): Interval {
  return { start: session.startsAt.getTime(), end: session.endsAt.getTime() };
}

/**
 * The effective sessions of a service that start on `date` (a local date of the input zone), with
 * special days applied. `STORE`: its own rows. `DELIVERY`: the delivery hours intersected with the
 * store hours, each piece kept on the date it starts on (brief C12).
 */
export function getSessionsForDate(
  input: BranchHours,
  date: string,
  service: BranchService,
): Session[] {
  if (service === 'STORE') {
    return ownSessions(input, date, 'STORE');
  }
  // A session lasts less than a day: delivery pieces starting on `date` come from delivery
  // sessions of the day before or of `date`, which can only meet store sessions of `date - 2`
  // (crossing into `date - 1`) to `date + 1`.
  const store = mergeIntervals(
    [-2, -1, 0, 1].flatMap((offset) =>
      ownSessions(input, addCalendarDays(date, offset), 'STORE').map(toInterval),
    ),
  );
  const delivery = [-1, 0].flatMap((offset) =>
    deliveryOwnSessions(input, addCalendarDays(date, offset)).map(toInterval),
  );
  const pieces: Interval[] = [];
  for (const wanted of delivery) {
    for (const open of store) {
      const start = Math.max(wanted.start, open.start);
      const end = Math.min(wanted.end, open.end);
      if (start < end) {
        pieces.push({ start, end });
      }
    }
  }
  return mergeIntervals(pieces)
    .filter((piece) => wallClock(piece.start, input.timeZone).date === date)
    .map((piece) => sessionFromInterval(date, piece, input.timeZone));
}

/** Merged effective intervals of a service from the day before `instant` to the look-ahead. */
function effectiveIntervals(
  input: OpenStateInput,
  instant: Date,
  service: BranchService,
): Interval[] {
  const today = localDateOf(instant, input.timeZone);
  const sessions: Session[] = [];
  for (let offset = -1; offset <= LOOK_AHEAD_DAYS; offset += 1) {
    sessions.push(...getSessionsForDate(input, addCalendarDays(today, offset), service));
  }
  return mergeIntervals(sessions.map(toInterval));
}

function shut(reason: ClosedReason): ServiceState {
  return {
    isOpen: false,
    acceptingOrders: false,
    acceptingUntil: null,
    nextChangeAt: null,
    reason,
  };
}

/**
 * The state of one service at `instant`. `STORE` is pickup (its switch is `acceptsPickup`);
 * `DELIVERY` uses `acceptsDelivery`. Reasons, first match: branch `CLOSED` → `CLOSED`, branch
 * `TEMPORARILY_CLOSED` → `PAUSED` (no next change for either), service switched off →
 * `SERVICE_OFF`, outside the hours → `CLOSED`, inside but past the cutoff → `PAST_CUTOFF`.
 * Adjacent sessions (a 02:00 close and a 02:00 open) count as one.
 */
export function getServiceState(
  input: OpenStateInput,
  instant: Date,
  service: BranchService,
): ServiceState {
  if (input.status === 'CLOSED') {
    return shut('CLOSED');
  }
  if (input.status === 'TEMPORARILY_CLOSED') {
    return shut('PAUSED');
  }
  const offered = service === 'STORE' ? input.acceptsPickup : input.acceptsDelivery;
  const now = instant.getTime();
  const intervals = effectiveIntervals(input, instant, service);
  const current = intervals.find((interval) => interval.start <= now && now < interval.end);

  if (current === undefined) {
    const next = intervals.find(
      (interval) => interval.start > now && interval.start <= now + LOOK_AHEAD_MS,
    );
    return {
      isOpen: false,
      acceptingOrders: false,
      acceptingUntil: null,
      nextChangeAt: next === undefined ? null : new Date(next.start),
      reason: offered ? 'CLOSED' : 'SERVICE_OFF',
    };
  }

  const nextChangeAt = new Date(current.end);
  if (!offered) {
    return {
      isOpen: true,
      acceptingOrders: false,
      acceptingUntil: null,
      nextChangeAt,
      reason: 'SERVICE_OFF',
    };
  }
  const until = current.end - input.orderCutoffMinutes * MINUTE;
  const accepting = now < until;
  const state: ServiceState = {
    isOpen: true,
    acceptingOrders: accepting,
    acceptingUntil: new Date(until),
    nextChangeAt,
  };
  return accepting ? state : { ...state, reason: 'PAST_CUTOFF' };
}

/**
 * The `openState` of `BranchSummary`: `state` and `nextChangeAt` from the effective `STORE` hours;
 * `acceptingOrders` when pickup or delivery accepts an order now, `acceptingUntil` the later of
 * their cutoffs; `delivery` from the effective `DELIVERY` hours (`CLOSED` with no next change
 * while `acceptsDelivery` is off).
 */
export function getOpenState(input: OpenStateInput, instant: Date): OpenState {
  if (input.status !== 'ACTIVE') {
    const state: OpenStateValue = input.status === 'CLOSED' ? 'CLOSED' : 'TEMPORARILY_CLOSED';
    return {
      state,
      nextChangeAt: null,
      acceptingOrders: false,
      acceptingUntil: null,
      delivery: { state, nextChangeAt: null },
    };
  }
  const store = getServiceState(input, instant, 'STORE');
  const delivery = getServiceState(input, instant, 'DELIVERY');
  const accepting = [store, delivery].filter((serviceState) => serviceState.acceptingOrders);
  const until = accepting
    .map((serviceState) => serviceState.acceptingUntil?.getTime() ?? Number.NEGATIVE_INFINITY)
    .reduce((latest, value) => Math.max(latest, value), Number.NEGATIVE_INFINITY);
  return {
    state: store.isOpen ? 'OPEN' : 'CLOSED',
    nextChangeAt: store.nextChangeAt,
    acceptingOrders: accepting.length > 0,
    acceptingUntil: accepting.length > 0 ? new Date(until) : null,
    delivery: input.acceptsDelivery
      ? { state: delivery.isOpen ? 'OPEN' : 'CLOSED', nextChangeAt: delivery.nextChangeAt }
      : { state: 'CLOSED', nextChangeAt: null },
  };
}
