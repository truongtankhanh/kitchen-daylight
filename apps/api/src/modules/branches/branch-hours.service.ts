import { Inject, Injectable } from '@nestjs/common';
import type { Paged } from '@kd/contracts';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import { assertRowVersion } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toOffset,
} from '../../common/pagination/page-query.dto.js';
import { Clock } from '../../common/time/clock.js';
import {
  addCalendarDays,
  BUSINESS_TIME_ZONE,
  formatVietnamDate,
} from '../../common/time/vietnam-time.js';
import type { BranchService } from './entities/branch-opening-period.entity.js';
import { historyOverlapErrors, validateHours } from './hours/hours-validation.js';
import type { SpecialRange } from './hours/hours-validation.js';
import { getSessionsForDate, isoDayOfWeek } from './hours/open-state.js';
import type { SpecialDay, WeeklyPeriod } from './hours/open-state.js';

/** How far back `includePast=true` reaches: special days that ended within 30 days (brief C17). */
export const SPECIAL_PAST_DAYS = 30;

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/branch-hours.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface BranchHoursPeriodView {
  readonly service: BranchService;
  readonly dayOfWeek: number;
  readonly openTime: string;
  readonly closeTime: string;
  readonly closesNextDay: boolean;
}

export interface BranchSpecialDayView {
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

/** `GET /admin/branches/{id}/hours`, also the body of `PUT`. */
export interface AdminBranchHoursView {
  readonly rowVersion: number;
  readonly periods: BranchHoursPeriodView[];
  readonly special: Paged<BranchSpecialDayView>;
}

/** One effective `STORE` session of today: `todayHours` of `AdminBranchRow` (D-139). */
export interface TodayHoursView {
  readonly openTime: string;
  readonly closeTime: string;
  readonly closesNextDay: boolean;
}

export interface BranchHoursQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly includePast?: boolean;
}

export interface BranchHoursInput {
  readonly rowVersion: number;
  readonly periods: readonly unknown[];
  readonly special: readonly unknown[];
}

// ---------------------------------------------------------------------------------------------
// SQL (times read as `HH:mm` and dates as `YYYY-MM-DD` text, never through the driver's parsers)
// ---------------------------------------------------------------------------------------------

const ROW_VERSION_SQL = `SELECT row_version FROM public.branches
 WHERE id = $1 AND deleted_at IS NULL`;

const LOCK_BRANCH_SQL = `SELECT b.row_version, b.updated_at, b.updated_by::text AS updated_by,
  u.display_name AS updated_by_name
  FROM public.branches b
  LEFT JOIN public.users u ON u.id = b.updated_by
 WHERE b.id = $1 AND b.deleted_at IS NULL
   FOR UPDATE OF b`;

/**
 * Sorted by the table columns (`p.`), not the text aliases: `service` sorts in enum order
 * (`STORE` first), `open_time` as a time.
 */
const PERIODS_SQL = `SELECT p.service::text AS service, p.day_of_week,
  to_char(p.open_time, 'HH24:MI') AS open_time, to_char(p.close_time, 'HH24:MI') AS close_time,
  p.closes_next_day
  FROM public.branch_opening_periods p
 WHERE p.branch_id = $1
 ORDER BY p.service, p.day_of_week, p.open_time, p.id`;

const SPECIAL_COLUMNS = `to_char(s.starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(s.ends_on, 'YYYY-MM-DD') AS ends_on, s.service::text AS service, s.is_closed,
  to_char(s.open_time, 'HH24:MI') AS open_time, to_char(s.close_time, 'HH24:MI') AS close_time,
  s.closes_next_day, s.note, s.display_note`;

/** Sorted by the table columns (`s.`), as `PERIODS_SQL`: same start date, `STORE` first. */
const SPECIAL_PAGE_SQL = `SELECT ${SPECIAL_COLUMNS}
  FROM public.branch_special_hours s
 WHERE s.branch_id = $1 AND s.ends_on >= $2::date
 ORDER BY s.starts_on, s.service, s.id
OFFSET $3 LIMIT $4`;

const SPECIAL_COUNT_SQL = `SELECT count(*)::int AS total
  FROM public.branch_special_hours
 WHERE branch_id = $1 AND ends_on >= $2::date`;

/** The kept history that a range starting on `$3` or later could overlap. */
const HISTORY_SQL = `SELECT service::text AS service, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(ends_on, 'YYYY-MM-DD') AS ends_on
  FROM public.branch_special_hours
 WHERE branch_id = $1 AND ends_on < $2::date AND ends_on >= $3::date`;

const DELETE_PERIODS_SQL = `DELETE FROM public.branch_opening_periods WHERE branch_id = $1`;

const INSERT_PERIODS_SQL = `INSERT INTO public.branch_opening_periods
  (branch_id, service, day_of_week, open_time, close_time, closes_next_day)
SELECT $1, t.service::public.branch_service, t.day_of_week, t.open_time::time, t.close_time::time,
       t.closes_next_day
  FROM unnest($2::text[], $3::integer[], $4::text[], $5::text[], $6::boolean[])
    AS t(service, day_of_week, open_time, close_time, closes_next_day)`;

/** The special days that end today or later; older ones are history and stay. */
const DELETE_CURRENT_SPECIAL_SQL = `DELETE FROM public.branch_special_hours
 WHERE branch_id = $1 AND ends_on >= $2::date`;

const INSERT_SPECIAL_SQL = `INSERT INTO public.branch_special_hours
  (branch_id, service, starts_on, ends_on, is_closed, open_time, close_time, closes_next_day,
   note, display_note)
SELECT $1, t.service::public.branch_service, t.starts_on::date, t.ends_on::date, t.is_closed,
       t.open_time::time, t.close_time::time, t.closes_next_day, t.note, t.display_note
  FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[], $7::text[],
              $8::boolean[], $9::text[], $10::text[])
    AS t(service, starts_on, ends_on, is_closed, open_time, close_time, closes_next_day, note,
         display_note)`;

/** `updated_by` fires the `row_version` and `updated_at` triggers of the branch (brief C10). */
const TOUCH_BRANCH_SQL = `UPDATE public.branches SET updated_by = $2 WHERE id = $1`;

const TODAY_PERIODS_SQL = `SELECT branch_id::text AS branch_id,
  to_char(open_time, 'HH24:MI') AS open_time, to_char(close_time, 'HH24:MI') AS close_time
  FROM public.branch_opening_periods
 WHERE branch_id = ANY($1::uuid[]) AND service = 'STORE' AND day_of_week = $2`;

const TODAY_SPECIAL_SQL = `SELECT branch_id::text AS branch_id,
  to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
  is_closed, to_char(open_time, 'HH24:MI') AS open_time, to_char(close_time, 'HH24:MI') AS close_time
  FROM public.branch_special_hours
 WHERE branch_id = ANY($1::uuid[]) AND service = 'STORE'
   AND starts_on <= $2::date AND ends_on >= $2::date`;

interface PeriodRecord {
  service: BranchService;
  day_of_week: number;
  open_time: string;
  close_time: string;
  closes_next_day: boolean;
}

interface SpecialRecord {
  starts_on: string;
  ends_on: string;
  service: BranchService;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  closes_next_day: boolean | null;
  note: string | null;
  display_note: string | null;
}

interface LockedBranch {
  row_version: number;
  updated_at: Date;
  updated_by: string | null;
  updated_by_name: string | null;
}

interface TodayPeriodRecord {
  branch_id: string;
  open_time: string;
  close_time: string;
}

interface TodaySpecialRecord {
  branch_id: string;
  starts_on: string;
  ends_on: string;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

function specialView(record: SpecialRecord): BranchSpecialDayView {
  return {
    startsOn: record.starts_on,
    endsOn: record.ends_on,
    service: record.service,
    isClosed: record.is_closed,
    openTime: record.open_time,
    closeTime: record.close_time,
    closesNextDay: record.closes_next_day,
    note: record.note,
    displayNote: record.display_note,
  };
}

/**
 * `/admin/branches/{id}/hours` (api-outline "Branches"; A5-T3) and the `todayHours` of the branch
 * list. Scoped as `BranchesService` (api-divergences D-132): a `MANAGER` reaches only the branches
 * of their `staff_branches`, any other id is `404`. No audit row: hours are not in the data-model
 * audit list (brief G7 candidate).
 */
@Injectable()
export class BranchHoursService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * The weekly periods and a page of special days: those ending today or later, plus with
   * `includePast` those that ended within the last 30 days (brief C17). One snapshot, so
   * `rowVersion` matches the lists.
   */
  async get(
    actor: Pick<RequestUser, 'id' | 'role'>,
    branchId: string,
    query: BranchHoursQuery,
  ): Promise<AdminBranchHoursView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    return this.read(branchId, query);
  }

  /**
   * Replaces the weekly periods and the special days that end today or later, in one transaction
   * with optimistic concurrency on the branch `rowVersion`. Special days that ended before today
   * are never touched. Writes `updated_by` on the branch, which raises its `rowVersion` (an open
   * branch editor becomes stale too). Returns the new `GET` body (first page, no past days).
   */
  async replace(
    actor: Pick<RequestUser, 'id' | 'role'>,
    branchId: string,
    input: BranchHoursInput,
  ): Promise<AdminBranchHoursView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    const today = this.today();
    const checked = validateHours(input, today);
    if (checked.errors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors: checked.errors });
    }

    await this.dataSource.transaction(async (em) => {
      const current = await this.lockBranch(em, branchId);
      assertRowVersion(input.rowVersion, {
        rowVersion: current.row_version,
        updatedBy:
          current.updated_by === null
            ? null
            : { id: current.updated_by, name: current.updated_by_name ?? '' },
        updatedAt: current.updated_at,
      });

      const earliest = checked.special.map((day) => day.startsOn).sort()[0];
      if (earliest !== undefined && earliest < today) {
        const history: SpecialRange[] = (
          await em.query<{ service: BranchService; starts_on: string; ends_on: string }[]>(
            HISTORY_SQL,
            [branchId, today, earliest],
          )
        ).map((row) => ({ service: row.service, startsOn: row.starts_on, endsOn: row.ends_on }));
        const overlaps = historyOverlapErrors(checked.special, history);
        if (overlaps.length > 0) {
          throw new ApiError('VALIDATION_FAILED', { errors: overlaps });
        }
      }

      await em.query(DELETE_PERIODS_SQL, [branchId]);
      if (checked.periods.length > 0) {
        await em.query(INSERT_PERIODS_SQL, [
          branchId,
          checked.periods.map((period) => period.service),
          checked.periods.map((period) => period.dayOfWeek),
          checked.periods.map((period) => period.openTime),
          checked.periods.map((period) => period.closeTime),
          checked.periods.map((period) => period.closesNextDay),
        ]);
      }
      await em.query(DELETE_CURRENT_SPECIAL_SQL, [branchId, today]);
      if (checked.special.length > 0) {
        await em.query(INSERT_SPECIAL_SQL, [
          branchId,
          checked.special.map((day) => day.service),
          checked.special.map((day) => day.startsOn),
          checked.special.map((day) => day.endsOn),
          checked.special.map((day) => day.isClosed),
          checked.special.map((day) => day.openTime),
          checked.special.map((day) => day.closeTime),
          checked.special.map((day) => day.closesNextDay),
          checked.special.map((day) => day.note),
          checked.special.map((day) => day.displayNote),
        ]);
      }
      await em.query(TOUCH_BRANCH_SQL, [branchId, actor.id]);
    });
    return this.read(branchId, { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });
  }

  /**
   * `todayHours` of each branch: the effective `STORE` sessions that start today (Vietnam date of
   * the `Clock`), special days applied; an empty list means closed today. A session of yesterday
   * that runs past midnight is yesterday's, so it is not listed.
   */
  async todayStoreHours(branchIds: readonly string[]): Promise<Map<string, TodayHoursView[]>> {
    const result = new Map<string, TodayHoursView[]>();
    if (branchIds.length === 0) {
      return result;
    }
    const today = this.today();
    const [periods, special] = await Promise.all([
      this.dataSource.query<TodayPeriodRecord[]>(TODAY_PERIODS_SQL, [
        branchIds,
        isoDayOfWeek(today),
      ]),
      this.dataSource.query<TodaySpecialRecord[]>(TODAY_SPECIAL_SQL, [branchIds, today]),
    ]);
    for (const branchId of branchIds) {
      const weekly: WeeklyPeriod[] = periods
        .filter((row) => row.branch_id === branchId)
        .map((row) => ({
          service: 'STORE',
          dayOfWeek: isoDayOfWeek(today),
          openTime: row.open_time,
          closeTime: row.close_time,
        }));
      const specialDays: SpecialDay[] = special
        .filter((row) => row.branch_id === branchId)
        .map((row) => ({
          service: 'STORE',
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          isClosed: row.is_closed,
          openTime: row.open_time,
          closeTime: row.close_time,
        }));
      const sessions = getSessionsForDate(
        { timeZone: BUSINESS_TIME_ZONE, periods: weekly, specialDays },
        today,
        'STORE',
      );
      result.set(
        branchId,
        sessions.map(({ openTime, closeTime, closesNextDay }) => ({
          openTime,
          closeTime,
          closesNextDay,
        })),
      );
    }
    return result;
  }

  /** Today's Vietnam date from the `Clock` (decision 0007 section 8). */
  private today(): string {
    return formatVietnamDate(this.clock.now());
  }

  private async read(branchId: string, query: BranchHoursQuery): Promise<AdminBranchHoursView> {
    const today = this.today();
    const from = query.includePast === true ? addCalendarDays(today, -SPECIAL_PAST_DAYS) : today;
    const { offset, limit } = toOffset(query);
    return this.dataSource.transaction('REPEATABLE READ', async (em) => {
      const branch = await em.query<{ row_version: number }[]>(ROW_VERSION_SQL, [branchId]);
      const rowVersion = branch[0]?.row_version;
      if (rowVersion === undefined) {
        throw new ApiError('NOT_FOUND');
      }
      const periods = await em.query<PeriodRecord[]>(PERIODS_SQL, [branchId]);
      const items = await em.query<SpecialRecord[]>(SPECIAL_PAGE_SQL, [
        branchId,
        from,
        offset,
        limit,
      ]);
      const counted = await em.query<{ total: number }[]>(SPECIAL_COUNT_SQL, [branchId, from]);
      return {
        rowVersion,
        periods: periods.map((record) => ({
          service: record.service,
          dayOfWeek: record.day_of_week,
          openTime: record.open_time,
          closeTime: record.close_time,
          closesNextDay: record.closes_next_day,
        })),
        special: {
          items: items.map(specialView),
          page: query.page,
          pageSize: query.pageSize,
          total: counted[0]?.total ?? 0,
        },
      };
    });
  }

  /** The live branch, locked for the transaction; `404` when missing or soft-deleted. */
  private async lockBranch(em: EntityManager, branchId: string): Promise<LockedBranch> {
    const rows = await em.query<LockedBranch[]>(LOCK_BRANCH_SQL, [branchId]);
    const branch = rows[0];
    if (branch === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return branch;
  }
}
