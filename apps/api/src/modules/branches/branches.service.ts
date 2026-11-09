import { Inject, Injectable } from '@nestjs/common';
import type { Paged } from '@kd/contracts';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import type { ScopedUser } from '../../common/branch-scope/branch-scope.service.js';
import { assertRowVersion } from '../../common/concurrency/row-version.js';
import type { RowVersionState } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { EMPTY_TODAY_STATS, ORDERS_FACTS } from '../../common/orders-facts/orders-facts.port.js';
import type { OrdersFacts } from '../../common/orders-facts/orders-facts.port.js';
import { toOffset } from '../../common/pagination/page-query.dto.js';
import { slugify } from '../../common/text/slugify.js';
import { assertEntityLabel, AuditService } from '../audit/audit.service.js';
import { escapeLike } from '../users/admin-users.service.js';
import { BranchHoursService } from './branch-hours.service.js';
import type { TodayHoursView } from './branch-hours.service.js';
import {
  BRANCH_SLUG_MAX_LENGTH,
  RESERVATION_DURATION,
  RESERVATION_SLOT_STEPS,
} from './dto/admin-branch-input.dto.js';
import type { BranchDescription, BranchStatus } from './entities/branch.entity.js';

/** Audit codes of this service (catalogue in `@kd/contracts`; data-model `audit_logs`, brief C9, G7). */
export const BRANCHES_AUDIT = Object.freeze({
  create: 'branch.create',
  delete: 'branch.delete',
  locationConfirm: 'branch.location_confirm',
} as const);

/** `reservation_duration_minutes` default of migration 0007 (brief P19). */
const RESERVATION_DURATION_DEFAULT = 90;

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/admin-branch.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface AdminBranchLocationView {
  readonly lat: number;
  readonly lng: number;
}

/** `AdminBranchRow` (brief C2). */
export interface AdminBranchRowView {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly name: string;
  readonly addressLine: string;
  readonly provinceCode: string;
  readonly wardCode: string | null;
  readonly location: AdminBranchLocationView;
  readonly phone: string;
  readonly status: BranchStatus;
  readonly acceptsPickup: boolean;
  readonly acceptsDelivery: boolean;
  readonly acceptsReservations: boolean;
  readonly sortOrder: number;
  readonly staffCount: number;
  readonly ratingAverage: number | null;
  readonly reviewCount: number;
  readonly activeZoneCount: number;
  readonly codeLocked: boolean;
  readonly ordersToday: number;
  readonly activeOrders: number;
  /** Today's effective `STORE` sessions, special days applied; `[]` when closed today (A5-T3). */
  readonly todayHours: readonly TodayHoursView[];
}

/** The detail of one branch: the row plus the edit form's fields. */
export interface AdminBranchDetailView extends AdminBranchRowView {
  readonly rowVersion: number;
  readonly description: BranchDescription | null;
  readonly websiteUrl: string | null;
  readonly pauseMessage: string | null;
  readonly defaultPrepMinutes: number;
  readonly orderCutoffMinutes: number;
  readonly reservationDurationMinutes: number;
  readonly reservationSlotStepMinutes: number;
  readonly reservationMaxParty: number;
  readonly reservationLeadMinutes: number;
  readonly reservationMaxDaysAhead: number;
  readonly amenityIds: string[];
  readonly updatedAt: string;
}

export type AdminBranchPage = Paged<AdminBranchRowView>;

// ---------------------------------------------------------------------------------------------
// Inputs (validated by the DTOs of `dto/admin-branch-input.dto.ts`)
// ---------------------------------------------------------------------------------------------

export interface BranchesListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
  readonly status?: BranchStatus;
}

interface DescriptionInput {
  readonly vi: string;
  readonly en?: string;
}

/** The fields shared by create and update, every one optional here. */
export interface BranchFieldsInput {
  readonly code?: string;
  readonly name?: string;
  readonly description?: DescriptionInput | null;
  readonly addressLine?: string;
  readonly provinceCode?: string;
  readonly wardCode?: string | null;
  readonly location?: AdminBranchLocationView;
  readonly phone?: string;
  readonly status?: BranchStatus;
  readonly acceptsPickup?: boolean;
  readonly acceptsDelivery?: boolean;
  readonly acceptsReservations?: boolean;
  readonly defaultPrepMinutes?: number;
  readonly orderCutoffMinutes?: number;
  readonly reservationDurationMinutes?: number;
  readonly reservationSlotStepMinutes?: number;
  readonly reservationMaxParty?: number;
  readonly reservationLeadMinutes?: number;
  readonly reservationMaxDaysAhead?: number;
  readonly websiteUrl?: string | null;
  readonly pauseMessage?: string | null;
}

export interface BranchCreateInput extends BranchFieldsInput {
  readonly code: string;
  readonly slug?: string;
  readonly name: string;
  readonly addressLine: string;
  readonly provinceCode: string;
  readonly location: AdminBranchLocationView;
  readonly phone: string;
  readonly status: BranchStatus;
  readonly acceptsPickup: boolean;
  readonly acceptsDelivery: boolean;
  readonly acceptsReservations: boolean;
  readonly defaultPrepMinutes: number;
  readonly orderCutoffMinutes: number;
  readonly reservationSlotStepMinutes: number;
  readonly reservationMaxParty: number;
  readonly reservationLeadMinutes: number;
  readonly reservationMaxDaysAhead: number;
}

export interface BranchUpdateInput extends BranchFieldsInput {
  readonly rowVersion: number;
  readonly amenityIds?: readonly string[];
}

type Actor = Pick<RequestUser, 'id' | 'role'>;

// ---------------------------------------------------------------------------------------------
// Pure rules (unit-tested in `branches.service.spec.ts`)
// ---------------------------------------------------------------------------------------------

/** Same pattern as the `e164_phone` domain of migration `0001_database_helpers.sql`. */
export const E164_PATTERN = /^\+[1-9][0-9]{1,14}$/;

/** Spaces, dots and hyphens a person types inside a phone number. */
const PHONE_SEPARATORS = /[\s.-]/gu;

/**
 * The E.164 form of a branch phone, or `null`. A branch phone may be a landline (data-model
 * Conventions), so the Vietnamese mobile rule of customer phones does not apply; a national number
 * (`028…`) is not accepted while brief C34 is open (api-divergences D-135).
 */
export function normalizeBranchPhone(input: string): string | null {
  const compact = input.replace(PHONE_SEPARATORS, '');
  return E164_PATTERN.test(compact) ? compact : null;
}

/** One https URL with a host and no whitespace (brief C28; `branches_website_url_https`). */
export function isHttpsUrl(value: string): boolean {
  if (!value.startsWith('https://') || /\s/u.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

function fieldError(field: string, code: ApiFieldError['code'], message: string): ApiFieldError {
  return { field, code, message };
}

/**
 * The rules the DTO decorators cannot express with the field code the outline asks for: the phone
 * (`INVALID_PHONE`), the https link (`INVALID`), the reservation duration step and the slot step
 * (`OUT_OF_RANGE`, data-model `branches` CHECKs, brief P21). Ranges and lengths are the DTO's.
 */
export function branchFieldErrors(input: BranchFieldsInput): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  if (input.phone !== undefined && normalizeBranchPhone(input.phone) === null) {
    errors.push(fieldError('phone', 'INVALID_PHONE', 'must be an E.164 phone number'));
  }
  if (
    input.websiteUrl !== undefined &&
    input.websiteUrl !== null &&
    input.websiteUrl !== '' &&
    !isHttpsUrl(input.websiteUrl)
  ) {
    errors.push(fieldError('websiteUrl', 'INVALID', 'must be an https link'));
  }
  if (
    input.reservationDurationMinutes !== undefined &&
    input.reservationDurationMinutes % RESERVATION_DURATION.step !== 0
  ) {
    errors.push(fieldError('reservationDurationMinutes', 'OUT_OF_RANGE', 'is out of range'));
  }
  if (
    input.reservationSlotStepMinutes !== undefined &&
    !(RESERVATION_SLOT_STEPS as readonly number[]).includes(input.reservationSlotStepMinutes)
  ) {
    errors.push(fieldError('reservationSlotStepMinutes', 'OUT_OF_RANGE', 'is out of range'));
  }
  return errors;
}

/** `acceptsDelivery` switched on without an active delivery zone (brief C8). */
export const NO_ACTIVE_ZONE_ERROR: ApiFieldError = Object.freeze({
  field: 'acceptsDelivery',
  code: 'INVALID',
  message: 'needs an active delivery zone',
});

/**
 * `rating_sum / review_count` rounded to one decimal (half up), `null` without reviews. A plain
 * average (api-outline open item 7). Integers in, so `sum * 10 / count` is exact enough to round.
 */
export function ratingAverage(ratingSum: number, reviewCount: number): number | null {
  if (reviewCount <= 0) {
    return null;
  }
  return Math.round((ratingSum * 10) / reviewCount) / 10;
}

/**
 * The slug of a new branch: the one sent, else `slugify(name)` cut to the maximum length. `null`
 * when the name leaves nothing (only symbols): the caller asks for a slug.
 */
export function slugForNewBranch(name: string, slug: string | undefined): string | null {
  if (slug !== undefined) {
    return slug;
  }
  const derived = slugify(name).slice(0, BRANCH_SLUG_MAX_LENGTH).replace(/-+$/u, '');
  return derived === '' ? null : derived;
}

/** The `description` column value: `null`, or the translations without empty optional keys. */
export function descriptionValue(input: DescriptionInput | null): BranchDescription | null {
  if (input === null) {
    return null;
  }
  return input.en === undefined || input.en === ''
    ? { vi: input.vi }
    : { vi: input.vi, en: input.en };
}

/** Empty text stored as `null`, so "no value" has one form. */
function blankToNull(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}

/** The branch name as audit label; the code when the name cannot be one (an email-like name). */
export function branchAuditLabel(name: string, code: string): string {
  try {
    assertEntityLabel(name);
    return name;
  } catch {
    return code;
  }
}

/** Constraint names of migrations 0007, 0009 and 0013 that a write can break with valid input. */
const CONSTRAINT_ERRORS: Readonly<Record<string, () => ApiError>> = {
  branches_code_unique: () =>
    new ApiError('ALREADY_EXISTS', { detail: 'The branch code is already in use.' }),
  branches_slug_unique: () =>
    new ApiError('ALREADY_EXISTS', { detail: 'The branch slug is already in use.' }),
  branches_province_fkey: () =>
    new ApiError('VALIDATION_FAILED', {
      errors: [fieldError('provinceCode', 'NOT_FOUND', 'does not exist')],
    }),
  // Composite key (ward_code, province_code): also a ward of another province.
  branches_ward_fkey: () =>
    new ApiError('VALIDATION_FAILED', {
      errors: [fieldError('wardCode', 'NOT_FOUND', 'is not a ward of the province')],
    }),
  branch_amenities_amenity_fkey: () =>
    new ApiError('VALIDATION_FAILED', {
      errors: [fieldError('amenityIds', 'NOT_FOUND', 'names an amenity that does not exist')],
    }),
};

/** The API error of a known constraint violation, or `null`. */
export function constraintError(error: unknown): ApiError | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const failure = error as QueryFailedError & {
    readonly constraint?: unknown;
    readonly driverError?: { readonly constraint?: unknown };
  };
  const name = failure.constraint ?? failure.driverError?.constraint;
  const build = typeof name === 'string' ? CONSTRAINT_ERRORS[name] : undefined;
  return build === undefined ? null : build();
}

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

/** Columns of a row; spatial code stays in SQL (`ST_X`/`ST_Y` of the geometry cast). */
const ROW_COLUMNS = `b.id::text AS id, b.code, b.slug, b.name, b.address_line, b.province_code,
  b.ward_code, ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
  b.phone::text AS phone, b.status::text AS status, b.accepts_pickup, b.accepts_delivery,
  b.accepts_reservations, b.sort_order, b.review_count, b.rating_sum,
  (SELECT count(*)::int FROM public.staff_branches sb WHERE sb.branch_id = b.id) AS staff_count,
  (SELECT count(*)::int FROM public.delivery_zones z
    WHERE z.branch_id = b.id AND z.is_active) AS active_zone_count`;

/** One live (not soft-deleted) branch with every field of the detail. */
const DETAIL_SQL = `SELECT ${ROW_COLUMNS}, b.description, b.website_url, b.pause_message,
  b.default_prep_minutes, b.order_cutoff_minutes, b.reservation_duration_minutes,
  b.reservation_slot_step_minutes, b.reservation_max_party, b.reservation_lead_minutes,
  b.reservation_max_days_ahead, b.row_version, b.updated_at,
  ARRAY(SELECT ba.amenity_id::text FROM public.branch_amenities ba
         WHERE ba.branch_id = b.id ORDER BY ba.amenity_id) AS amenity_ids
  FROM public.branches b
 WHERE b.id = $1 AND b.deleted_at IS NULL`;

/** Every live branch, locked, with what a write checks: the target and, for delete, the others. */
const LOCK_LIVE_BRANCHES_SQL = `SELECT b.id::text AS id, b.code, b.name, b.status::text AS status,
  b.accepts_delivery, ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
  b.row_version, b.updated_at, b.updated_by::text AS updated_by, u.display_name AS updated_by_name
  FROM public.branches b
  LEFT JOIN public.users u ON u.id = b.updated_by
 WHERE b.deleted_at IS NULL AND ($1::uuid IS NULL OR b.id = $1)
 ORDER BY b.id
   FOR UPDATE OF b`;

const ACTIVE_ZONE_COUNT_SQL = `SELECT count(*)::int AS total
  FROM public.delivery_zones WHERE branch_id = $1 AND is_active`;

const EXISTING_AMENITY_IDS_SQL = `SELECT id::text AS id FROM public.amenities WHERE id = ANY($1::uuid[])`;

const DELETE_BRANCH_AMENITIES_SQL = `DELETE FROM public.branch_amenities WHERE branch_id = $1`;

const INSERT_BRANCH_AMENITIES_SQL = `INSERT INTO public.branch_amenities (branch_id, amenity_id)
SELECT $1, amenity_id FROM unnest($2::uuid[]) AS t(amenity_id)`;

/**
 * A new branch, placed after every other one (`sort_order` max + 1; api-divergences D-133). The
 * pin is written as `geography(Point, 4326)` from longitude and latitude.
 */
const INSERT_BRANCH_SQL = `INSERT INTO public.branches
  (code, slug, name, description, address_line, province_code, ward_code, location, phone, status,
   accepts_pickup, accepts_delivery, accepts_reservations, default_prep_minutes,
   order_cutoff_minutes, reservation_duration_minutes, reservation_slot_step_minutes,
   reservation_max_party, reservation_lead_minutes, reservation_max_days_ahead, sort_order,
   updated_by)
SELECT $1, $2, $3, $4::jsonb, $5, $6, $7,
       ST_SetSRID(ST_MakePoint($8::double precision, $9::double precision), 4326)::geography,
       $10, $11::public.branch_status, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
       COALESCE(max(sort_order), 0) + 1, $22::uuid
  FROM public.branches
RETURNING id::text AS id`;

/**
 * Wrapped in a CTE so the statement is a `SELECT`: TypeORM's `query()` returns `[rows, rowCount]`
 * for a bare `UPDATE`, and plain rows for a `SELECT`.
 */
const SOFT_DELETE_SQL = `WITH deleted AS (
  UPDATE public.branches SET deleted_at = now(), updated_by = $2
   WHERE id = $1
  RETURNING deleted_at)
SELECT deleted_at FROM deleted`;

interface RowRecord {
  id: string;
  code: string;
  slug: string;
  name: string;
  address_line: string;
  province_code: string;
  ward_code: string | null;
  lat: number;
  lng: number;
  phone: string;
  status: BranchStatus;
  accepts_pickup: boolean;
  accepts_delivery: boolean;
  accepts_reservations: boolean;
  sort_order: number;
  review_count: number;
  rating_sum: number;
  staff_count: number;
  active_zone_count: number;
}

interface DetailRecord extends RowRecord {
  description: BranchDescription | null;
  website_url: string | null;
  pause_message: string | null;
  default_prep_minutes: number;
  order_cutoff_minutes: number;
  reservation_duration_minutes: number;
  reservation_slot_step_minutes: number;
  reservation_max_party: number;
  reservation_lead_minutes: number;
  reservation_max_days_ahead: number;
  row_version: number;
  updated_at: Date;
  amenity_ids: string[];
}

interface LockedBranch {
  id: string;
  code: string;
  name: string;
  status: BranchStatus;
  accepts_delivery: boolean;
  lat: number;
  lng: number;
  row_version: number;
  updated_at: Date;
  updated_by: string | null;
  updated_by_name: string | null;
}

/** The scalar fields of `PATCH` and their columns; `location` and `description` are separate. */
const UPDATE_COLUMNS: readonly (readonly [keyof BranchFieldsInput, string, string?])[] = [
  ['code', 'code'],
  ['name', 'name'],
  ['addressLine', 'address_line'],
  ['provinceCode', 'province_code'],
  ['wardCode', 'ward_code'],
  ['phone', 'phone'],
  ['status', 'status', 'public.branch_status'],
  ['acceptsPickup', 'accepts_pickup'],
  ['acceptsDelivery', 'accepts_delivery'],
  ['acceptsReservations', 'accepts_reservations'],
  ['defaultPrepMinutes', 'default_prep_minutes'],
  ['orderCutoffMinutes', 'order_cutoff_minutes'],
  ['reservationDurationMinutes', 'reservation_duration_minutes'],
  ['reservationSlotStepMinutes', 'reservation_slot_step_minutes'],
  ['reservationMaxParty', 'reservation_max_party'],
  ['reservationLeadMinutes', 'reservation_lead_minutes'],
  ['reservationMaxDaysAhead', 'reservation_max_days_ahead'],
  ['websiteUrl', 'website_url'],
  ['pauseMessage', 'pause_message'],
];

/** The value a field is written with: phone in E.164, empty optional text as `null`. */
function columnValue(field: keyof BranchFieldsInput, value: unknown): unknown {
  if (field === 'phone' && typeof value === 'string') {
    return normalizeBranchPhone(value);
  }
  if (
    (field === 'websiteUrl' || field === 'pauseMessage') &&
    (value === null || typeof value === 'string')
  ) {
    return blankToNull(value);
  }
  return value;
}

/**
 * The `UPDATE` of a `PATCH`: every field sent, plus `updated_by` (always, so `row_version` and
 * `updated_at` move through their triggers even for an amenities-only change; brief C10).
 */
export function buildBranchUpdate(
  branchId: string,
  actorId: string,
  input: BranchFieldsInput,
): { sql: string; parameters: unknown[] } {
  const parameters: unknown[] = [];
  const bind = (value: unknown, cast?: string): string => {
    parameters.push(value);
    return cast === undefined ? `$${parameters.length}` : `$${parameters.length}::${cast}`;
  };
  const assignments: string[] = [];
  for (const [field, column, cast] of UPDATE_COLUMNS) {
    const value = input[field];
    if (value !== undefined) {
      assignments.push(`${column} = ${bind(columnValue(field, value), cast)}`);
    }
  }
  if (input.description !== undefined) {
    const value = descriptionValue(input.description);
    assignments.push(
      `description = ${bind(value === null ? null : JSON.stringify(value), 'jsonb')}`,
    );
  }
  if (input.location !== undefined) {
    const lng = bind(input.location.lng, 'double precision');
    const lat = bind(input.location.lat, 'double precision');
    assignments.push(`location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`);
  }
  assignments.push(`updated_by = ${bind(actorId, 'uuid')}`);
  const id = bind(branchId, 'uuid');
  return {
    sql: `UPDATE public.branches SET ${assignments.join(', ')} WHERE id = ${id}`,
    parameters,
  };
}

function rowVersionState(branch: LockedBranch): RowVersionState {
  return {
    rowVersion: branch.row_version,
    updatedBy:
      branch.updated_by === null
        ? null
        : { id: branch.updated_by, name: branch.updated_by_name ?? '' },
    updatedAt: branch.updated_at,
  };
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/**
 * `/admin/branches` (api-outline "Branches"; A5-T2). Branch scoping is applied here through
 * `BranchScopeService` (api-divergences D-132): a `MANAGER` sees and edits only the branches of
 * their `staff_branches`, and any other id is `404 NOT_FOUND`; an `ADMIN` sees every branch.
 * Soft-deleted branches are `404` for everyone. Order and reservation facts come from the
 * `ORDERS_FACTS` port, never from the orders slice.
 */
@Injectable()
export class BranchesService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ORDERS_FACTS) private readonly orders: OrdersFacts,
    @Inject(BranchHoursService) private readonly hours: BranchHoursService,
  ) {}

  /**
   * `GET /admin/branches`: `q` matches the name or the code, accent and case insensitive
   * (`kd_unaccent` first, so `Đ` matches `d` under any collation); sorted by `sort_order`, then
   * name.
   */
  async list(actor: ScopedUser, query: BranchesListQuery): Promise<AdminBranchPage> {
    const scope = await this.scopes.resolve(actor);
    const parameters: unknown[] = [];
    const bind = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const conditions = ['b.deleted_at IS NULL'];
    if (scope.kind === 'BRANCHES') {
      conditions.push(`b.id = ANY(${bind(scope.branchIds)}::uuid[])`);
    }
    if (query.status !== undefined) {
      conditions.push(`b.status = ${bind(query.status)}::public.branch_status`);
    }
    const q = query.q?.trim() ?? '';
    if (q !== '') {
      const fragment = `lower(public.kd_unaccent(${bind(escapeLike(q))}))`;
      conditions.push(`(lower(public.kd_unaccent(b.name)) LIKE '%' || ${fragment} || '%' ESCAPE '\\'
        OR lower(b.code) LIKE '%' || ${fragment} || '%' ESCAPE '\\')`);
    }
    const where = conditions.join(' AND ');
    const countParameters = [...parameters];
    const { offset, limit } = toOffset(query);
    const rows: RowRecord[] = await this.dataSource.query(
      `SELECT ${ROW_COLUMNS} FROM public.branches b WHERE ${where}
        ORDER BY b.sort_order, b.name, b.id OFFSET ${bind(offset)} LIMIT ${bind(limit)}`,
      parameters,
    );
    const counted: { total: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM public.branches b WHERE ${where}`,
      countParameters,
    );
    return {
      items: await this.rowViews(rows),
      page: query.page,
      pageSize: query.pageSize,
      total: counted[0]?.total ?? 0,
    };
  }

  /** `GET /admin/branches/{id}`: `404` outside the caller's branches or once soft-deleted. */
  async detail(actor: ScopedUser, branchId: string): Promise<AdminBranchDetailView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    return this.detailView(branchId);
  }

  /** `POST /admin/branches` (`ADMIN`): the branch and its `branch.create` audit row. */
  async create(actor: Actor, input: BranchCreateInput): Promise<AdminBranchDetailView> {
    const errors = branchFieldErrors(input);
    const slug = slugForNewBranch(input.name, input.slug);
    if (slug === null) {
      errors.push(
        fieldError('slug', 'REQUIRED', 'is required when the name has no letter or digit'),
      );
    }
    if (input.acceptsDelivery) {
      // A new branch has no delivery zone (brief C8).
      errors.push(NO_ACTIVE_ZONE_ERROR);
    }
    if (errors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors });
    }

    const id = await this.dataSource.transaction(async (em) => {
      let inserted: { id: string }[];
      try {
        inserted = await em.query(INSERT_BRANCH_SQL, [
          input.code,
          slug,
          input.name,
          input.description === undefined || input.description === null
            ? null
            : JSON.stringify(descriptionValue(input.description)),
          input.addressLine,
          input.provinceCode,
          input.wardCode ?? null,
          input.location.lng,
          input.location.lat,
          normalizeBranchPhone(input.phone),
          input.status,
          input.acceptsPickup,
          input.acceptsDelivery,
          input.acceptsReservations,
          input.defaultPrepMinutes,
          input.orderCutoffMinutes,
          input.reservationDurationMinutes ?? RESERVATION_DURATION_DEFAULT,
          input.reservationSlotStepMinutes,
          input.reservationMaxParty,
          input.reservationLeadMinutes,
          input.reservationMaxDaysAhead,
          actor.id,
        ]);
      } catch (error) {
        throw constraintError(error) ?? error;
      }
      const branchId = inserted[0]?.id;
      if (branchId === undefined) {
        throw new Error('INSERT INTO branches returned no id.');
      }
      await this.audit.write(
        {
          actorUserId: actor.id,
          action: BRANCHES_AUDIT.create,
          entityType: 'BRANCH',
          entityId: branchId,
          entityLabel: branchAuditLabel(input.name, input.code),
          branchId,
          diff: {
            branchCode: { from: null, to: input.code },
            name: { from: null, to: input.name },
            status: { from: null, to: input.status },
          },
        },
        em,
      );
      return branchId;
    });
    return this.detailView(id);
  }

  /**
   * `PATCH /admin/branches/{id}`: optimistic concurrency on `rowVersion`, the `code` lock (C6),
   * the delivery switch (C8), the amenity list replaced in the same transaction, and
   * `branch.location_confirm` when `location` is sent (C9). No general update audit row.
   */
  async update(
    actor: Actor,
    branchId: string,
    input: BranchUpdateInput,
  ): Promise<AdminBranchDetailView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    const fieldErrors = branchFieldErrors(input);
    if (fieldErrors.length > 0) {
      throw new ApiError('VALIDATION_FAILED', { errors: fieldErrors });
    }

    await this.dataSource.transaction(async (em) => {
      const current = await this.lockBranch(em, branchId);
      assertRowVersion(input.rowVersion, rowVersionState(current));

      const errors: ApiFieldError[] = [];
      if (
        input.code !== undefined &&
        input.code !== current.code &&
        (await this.orders.branchHasAnyOrder(current.id))
      ) {
        errors.push(fieldError('code', 'LOCKED', 'cannot change once the branch has an order'));
      }
      if (
        input.acceptsDelivery === true &&
        !current.accepts_delivery &&
        (await this.activeZoneCount(em, current.id)) === 0
      ) {
        errors.push(NO_ACTIVE_ZONE_ERROR);
      }
      const amenityIds =
        input.amenityIds === undefined
          ? undefined
          : [...new Set(input.amenityIds.map((amenityId) => amenityId.toLowerCase()))];
      if (amenityIds !== undefined && !(await this.amenitiesExist(em, amenityIds))) {
        errors.push(fieldError('amenityIds', 'NOT_FOUND', 'names an amenity that does not exist'));
      }
      if (errors.length > 0) {
        throw new ApiError('VALIDATION_FAILED', { errors });
      }

      const update = buildBranchUpdate(current.id, actor.id, input);
      try {
        await em.query(update.sql, update.parameters);
        if (amenityIds !== undefined) {
          await em.query(DELETE_BRANCH_AMENITIES_SQL, [current.id]);
          if (amenityIds.length > 0) {
            await em.query(INSERT_BRANCH_AMENITIES_SQL, [current.id, amenityIds]);
          }
        }
      } catch (error) {
        throw constraintError(error) ?? error;
      }

      if (input.location !== undefined) {
        await this.audit.write(
          {
            actorUserId: actor.id,
            action: BRANCHES_AUDIT.locationConfirm,
            entityType: 'BRANCH',
            entityId: current.id,
            entityLabel: branchAuditLabel(input.name ?? current.name, input.code ?? current.code),
            branchId: current.id,
            diff: {
              location: {
                from: { lat: current.lat, lng: current.lng },
                to: { lat: input.location.lat, lng: input.location.lng },
              },
            },
          },
          em,
        );
      }
    });
    return this.detailView(branchId);
  }

  /**
   * `DELETE /admin/branches/{id}?rowVersion=` (`ADMIN`): soft delete. Refused with
   * `HAS_ACTIVE_ORDERS { details { orders, reservations } }` while work is open (brief C1), and
   * with `INVALID_STATE` for the last live branch that is not `CLOSED` (api-divergences D-131).
   * Every live branch is locked, so two deletes cannot both remove "the other" last branch.
   */
  async remove(actor: Actor, branchId: string, rowVersion: number): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const live: LockedBranch[] = await em.query(LOCK_LIVE_BRANCHES_SQL, [null]);
      const target = live.find((branch) => branch.id === branchId.toLowerCase());
      if (target === undefined) {
        throw new ApiError('NOT_FOUND');
      }
      assertRowVersion(rowVersion, rowVersionState(target));

      const work = await this.orders.branchActiveWork(target.id);
      if (work.orders > 0 || work.reservations > 0) {
        throw new ApiError('HAS_ACTIVE_ORDERS', {
          detail: 'The branch has orders in progress or upcoming reservations.',
          extras: { details: { orders: work.orders, reservations: work.reservations } },
        });
      }
      const othersInOperation = live.some(
        (branch) => branch.id !== target.id && branch.status !== 'CLOSED',
      );
      if (target.status !== 'CLOSED' && !othersInOperation) {
        throw new ApiError('INVALID_STATE', {
          detail: 'The last branch in operation cannot be deleted.',
        });
      }

      const deleted: { deleted_at: Date }[] = await em.query(SOFT_DELETE_SQL, [
        target.id,
        actor.id,
      ]);
      await this.audit.write(
        {
          actorUserId: actor.id,
          action: BRANCHES_AUDIT.delete,
          entityType: 'BRANCH',
          entityId: target.id,
          entityLabel: branchAuditLabel(target.name, target.code),
          branchId: target.id,
          diff: {
            branchCode: target.code,
            deletedAt: { from: null, to: deleted[0]?.deleted_at.toISOString() ?? null },
          },
        },
        em,
      );
    });
  }

  /** The live branch, locked for the transaction; `404` when missing or soft-deleted. */
  private async lockBranch(em: EntityManager, branchId: string): Promise<LockedBranch> {
    const rows: LockedBranch[] = await em.query(LOCK_LIVE_BRANCHES_SQL, [branchId]);
    const branch = rows[0];
    if (branch === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return branch;
  }

  private async activeZoneCount(em: EntityManager, branchId: string): Promise<number> {
    const rows: { total: number }[] = await em.query(ACTIVE_ZONE_COUNT_SQL, [branchId]);
    return rows[0]?.total ?? 0;
  }

  private async amenitiesExist(em: EntityManager, amenityIds: readonly string[]): Promise<boolean> {
    if (amenityIds.length === 0) {
      return true;
    }
    const rows: { id: string }[] = await em.query(EXISTING_AMENITY_IDS_SQL, [amenityIds]);
    return rows.length === amenityIds.length;
  }

  private async detailView(branchId: string): Promise<AdminBranchDetailView> {
    const rows: DetailRecord[] = await this.dataSource.query(DETAIL_SQL, [branchId]);
    const record = rows[0];
    if (record === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    const [row] = await this.rowViews([record]);
    if (row === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return {
      ...row,
      rowVersion: record.row_version,
      description: record.description,
      websiteUrl: record.website_url,
      pauseMessage: record.pause_message,
      defaultPrepMinutes: record.default_prep_minutes,
      orderCutoffMinutes: record.order_cutoff_minutes,
      reservationDurationMinutes: record.reservation_duration_minutes,
      reservationSlotStepMinutes: record.reservation_slot_step_minutes,
      reservationMaxParty: record.reservation_max_party,
      reservationLeadMinutes: record.reservation_lead_minutes,
      reservationMaxDaysAhead: record.reservation_max_days_ahead,
      amenityIds: record.amenity_ids,
      updatedAt: record.updated_at.toISOString(),
    };
  }

  /**
   * Rows with the figures of the orders-facts port (one stats call, one lock check per row) and
   * today's hours (one read for all rows).
   */
  private async rowViews(records: readonly RowRecord[]): Promise<AdminBranchRowView[]> {
    if (records.length === 0) {
      return [];
    }
    const ids = records.map((record) => record.id);
    const [stats, locked, todayHours] = await Promise.all([
      this.orders.branchTodayStats(ids),
      Promise.all(ids.map((id) => this.orders.branchHasAnyOrder(id))),
      this.hours.todayStoreHours(ids),
    ]);
    return records.map((record, index) => {
      const today = stats.get(record.id) ?? EMPTY_TODAY_STATS;
      return {
        id: record.id,
        code: record.code,
        slug: record.slug,
        name: record.name,
        addressLine: record.address_line,
        provinceCode: record.province_code,
        wardCode: record.ward_code,
        location: { lat: record.lat, lng: record.lng },
        phone: record.phone,
        status: record.status,
        acceptsPickup: record.accepts_pickup,
        acceptsDelivery: record.accepts_delivery,
        acceptsReservations: record.accepts_reservations,
        sortOrder: record.sort_order,
        staffCount: record.staff_count,
        ratingAverage: ratingAverage(record.rating_sum, record.review_count),
        reviewCount: record.review_count,
        activeZoneCount: record.active_zone_count,
        codeLocked: locked[index] ?? false,
        ordersToday: today.ordersToday,
        activeOrders: today.activeOrders,
        todayHours: todayHours.get(record.id) ?? [],
      };
    });
  }
}
