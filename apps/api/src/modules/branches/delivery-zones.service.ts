import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import { assertRowVersion } from '../../common/concurrency/row-version.js';
import type { RowVersionState } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { ORDERS_FACTS } from '../../common/orders-facts/orders-facts.port.js';
import type { OrdersFacts } from '../../common/orders-facts/orders-facts.port.js';
import { assertEntityLabel, AuditService } from '../audit/audit.service.js';

/** Audit codes of this service (catalogue in `@kd/contracts`; data-model `audit_logs`, brief C25). */
export const DELIVERY_ZONES_AUDIT = Object.freeze({
  create: 'delivery_zone.create',
  update: 'delivery_zone.update',
  delete: 'delivery_zone.delete',
} as const);

/** SQLSTATE `foreign_key_violation`: a row (an order, from A8-T2) still references the zone. */
const FOREIGN_KEY_VIOLATION = '23503';

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/delivery-zone.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface AdminDeliveryZoneView {
  readonly id: string;
  readonly name: string;
  readonly radiusM: number;
  readonly fee: number;
  readonly minOrder: number;
  readonly freeOver: number | null;
  readonly etaMinutes: number;
  readonly isActive: boolean;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

/** `GET /admin/branches/{id}/delivery-zones`: every ring, active or not (brief C27). */
export interface AdminDeliveryZoneListView {
  readonly items: AdminDeliveryZoneView[];
  readonly total: number;
}

/** `POST .../delivery-zones/check` (brief C24). */
export interface DeliveryZoneCheckView {
  readonly distanceM: number;
  readonly zone: AdminDeliveryZoneView | null;
  readonly outOfZone: boolean;
}

/** What `findZoneForPoint` answers; A8-T3 prices a delivery from `zone`. */
export interface ZoneForPoint {
  /** Straight-line distance (`ST_Distance` on `geography`), rounded to a whole metre. */
  readonly distanceM: number;
  /** The smallest active ring containing the point (boundary inclusive), or `null`. */
  readonly zone: AdminDeliveryZoneView | null;
}

/** The `usage` member of `IN_USE` (api-outline "Payloads added to existing codes"; D-142). */
export interface ZoneUsagePayload {
  readonly count: number;
  readonly sample: readonly { readonly id: string; readonly name: string }[];
  readonly filter: { readonly deliveryZoneId: string };
}

// ---------------------------------------------------------------------------------------------
// Inputs (validated by the DTOs of `dto/delivery-zone.dto.ts`)
// ---------------------------------------------------------------------------------------------

/** The editable values of a zone. */
export interface DeliveryZoneValues {
  readonly name: string;
  readonly radiusM: number;
  readonly fee: number;
  readonly minOrder: number;
  readonly freeOver: number | null;
  readonly etaMinutes: number;
  readonly isActive: boolean;
}

export interface DeliveryZoneCreateInput extends Omit<DeliveryZoneValues, 'freeOver'> {
  readonly freeOver?: number | null;
}

export interface DeliveryZoneUpdateInput extends Partial<DeliveryZoneValues> {
  readonly rowVersion: number;
}

export interface PointInput {
  readonly lat: number;
  readonly lng: number;
}

type Actor = Pick<RequestUser, 'id' | 'role'>;

// ---------------------------------------------------------------------------------------------
// Pure rules (unit-tested in `delivery-zones.service.spec.ts`)
// ---------------------------------------------------------------------------------------------

/** A ring as the order rule sees it: every ring of the branch counts, active or not (C19). */
export interface ZoneRing {
  readonly id: string;
  readonly radiusM: number;
}

function byRadius(a: ZoneRing, b: ZoneRing): number {
  return a.radiusM - b.radiusM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The ring order of brief C19. A new ring (`zoneId` absent) must be larger than the outermost
 * ring; an edited ring must stay strictly between the rings just below and just above it in the
 * current order. Equal radii break the order. Inactive rings count like active ones.
 */
export function radiusKeepsRingOrder(
  rings: readonly ZoneRing[],
  radiusM: number,
  zoneId?: string,
): boolean {
  const sorted = [...rings].sort(byRadius);
  if (zoneId === undefined) {
    const outermost = sorted.at(-1);
    return outermost === undefined || radiusM > outermost.radiusM;
  }
  const index = sorted.findIndex((ring) => ring.id === zoneId);
  if (index < 0) {
    throw new Error('radiusKeepsRingOrder: the edited ring is not one of the rings.');
  }
  const below = sorted[index - 1];
  const above = sorted[index + 1];
  return (
    (below === undefined || radiusM > below.radiusM) &&
    (above === undefined || radiusM < above.radiusM)
  );
}

function fieldError(field: string, code: ApiFieldError['code'], message: string): ApiFieldError {
  return { field, code, message };
}

/** `RADIUS_ORDER` on `radiusM` (brief C19). */
export const RADIUS_ORDER_ERROR: ApiFieldError = Object.freeze(
  fieldError('radiusM', 'RADIUS_ORDER', 'must keep the rings in order of radius'),
);

/** `free_over > min_order` (`delivery_zones_free_over_above_min_order`, brief C20). */
export const FREE_OVER_ERROR: ApiFieldError = Object.freeze(
  fieldError('freeOver', 'OUT_OF_RANGE', 'must be above minOrder'),
);

/** `LAST_ACTIVE_ZONE` (brief C21): `isActive` on `PATCH`, `id` on `DELETE`. */
export function lastActiveZoneError(field: 'isActive' | 'id'): ApiFieldError {
  return fieldError(
    field,
    'LAST_ACTIVE_ZONE',
    'is the last active zone of a branch that accepts delivery',
  );
}

export function freeOverKeepsAboveMinOrder(values: {
  readonly minOrder: number;
  readonly freeOver: number | null;
}): boolean {
  return values.freeOver === null || values.freeOver > values.minOrder;
}

/**
 * True when switching off or removing `zoneId` would leave a branch that accepts delivery with no
 * active zone (brief C21).
 */
export function removesLastActiveZone(
  zones: readonly { readonly id: string; readonly isActive: boolean }[],
  zoneId: string,
  acceptsDelivery: boolean,
): boolean {
  if (!acceptsDelivery) {
    return false;
  }
  const target = zones.find((zone) => zone.id === zoneId);
  return (
    target !== undefined &&
    target.isActive &&
    zones.every((zone) => zone.id === zoneId || !zone.isActive)
  );
}

/** The values of `PATCH`: the current ones with every field sent; `freeOver: null` clears it. */
export function mergeZoneValues(
  current: DeliveryZoneValues,
  input: Partial<DeliveryZoneValues>,
): DeliveryZoneValues {
  return {
    name: input.name ?? current.name,
    radiusM: input.radiusM ?? current.radiusM,
    fee: input.fee ?? current.fee,
    minOrder: input.minOrder ?? current.minOrder,
    freeOver: input.freeOver === undefined ? current.freeOver : input.freeOver,
    etaMinutes: input.etaMinutes ?? current.etaMinutes,
    isActive: input.isActive ?? current.isActive,
  };
}

const DIFF_KEYS: readonly (keyof DeliveryZoneValues)[] = [
  'name',
  'radiusM',
  'fee',
  'minOrder',
  'freeOver',
  'etaMinutes',
  'isActive',
];

/**
 * The audit diff `{ field: { from, to } }` (brief C25): every field on create (`from: null`) and
 * delete (`to: null`), the changed fields on update.
 */
export function zoneDiff(
  before: DeliveryZoneValues | null,
  after: DeliveryZoneValues | null,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of DIFF_KEYS) {
    const from = before === null ? null : before[key];
    const to = after === null ? null : after[key];
    if (before === null || after === null || from !== to) {
      diff[key] = { from, to };
    }
  }
  return diff;
}

/** The zone name as audit label; `"<radius> m"` when the name cannot be one (an email-like name). */
export function zoneAuditLabel(name: string, radiusM: number): string {
  try {
    assertEntityLabel(name);
    return name;
  } catch {
    return `${radiusM} m`;
  }
}

/** `IN_USE` (409) with `usage` (api-outline; brief C22). Orders have no name yet: `sample` is empty. */
export function zoneInUseError(zoneId: string, count: number): ApiError {
  const usage: ZoneUsagePayload = {
    count,
    sample: [],
    filter: { deliveryZoneId: zoneId },
  };
  return new ApiError('IN_USE', {
    detail: 'Orders reference the delivery zone; switch it off instead.',
    extras: { usage },
  });
}

function driverField(error: QueryFailedError, field: 'code' | 'constraint'): unknown {
  const failure = error as QueryFailedError & {
    readonly code?: unknown;
    readonly constraint?: unknown;
    readonly driverError?: { readonly code?: unknown; readonly constraint?: unknown };
  };
  return failure[field] ?? failure.driverError?.[field];
}

/** True for SQLSTATE 23503: the A8-T2 foreign key (`RESTRICT`) refuses the delete. */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof QueryFailedError && driverField(error, 'code') === FOREIGN_KEY_VIOLATION;
}

/** Constraints of migration 0013 that a write can still break (a concurrent edit, older data). */
const CONSTRAINT_ERRORS: Readonly<Record<string, ApiFieldError>> = {
  delivery_zones_branch_radius_active_key: RADIUS_ORDER_ERROR,
  delivery_zones_free_over_above_min_order: FREE_OVER_ERROR,
};

/** The API error of a known constraint violation, or `null`. */
export function zoneConstraintError(error: unknown): ApiError | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const name = driverField(error, 'constraint');
  const field = typeof name === 'string' ? CONSTRAINT_ERRORS[name] : undefined;
  return field === undefined ? null : new ApiError('VALIDATION_FAILED', { errors: [field] });
}

// ---------------------------------------------------------------------------------------------
// SQL (spatial code stays in SQL; coordinates are bound parameters, never interpolated)
// ---------------------------------------------------------------------------------------------

const ZONE_COLUMNS = `id::text AS id, name, radius_m, fee, min_order, free_over, eta_minutes,
  is_active, row_version, updated_at`;

const LIVE_BRANCH_SQL = `SELECT 1 AS found FROM public.branches
 WHERE id = $1 AND deleted_at IS NULL`;

/** The live branch, locked: zone writes of one branch run one at a time (ring order, C21). */
const LOCK_BRANCH_SQL = `SELECT b.accepts_delivery, b.updated_at, b.updated_by::text AS updated_by,
  u.display_name AS updated_by_name
  FROM public.branches b
  LEFT JOIN public.users u ON u.id = b.updated_by
 WHERE b.id = $1 AND b.deleted_at IS NULL
   FOR UPDATE OF b`;

const LIST_ZONES_SQL = `SELECT ${ZONE_COLUMNS}
  FROM public.delivery_zones
 WHERE branch_id = $1
 ORDER BY radius_m, id`;

const LOCK_ZONES_SQL = `${LIST_ZONES_SQL}
   FOR UPDATE`;

const INSERT_ZONE_SQL = `INSERT INTO public.delivery_zones
  (branch_id, name, radius_m, fee, min_order, free_over, eta_minutes, is_active)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING ${ZONE_COLUMNS}`;

/** In a CTE so `query()` returns plain rows (as `SOFT_DELETE_SQL` in `branches.service.ts`). */
const UPDATE_ZONE_SQL = `WITH updated AS (
  UPDATE public.delivery_zones
     SET name = $2, radius_m = $3, fee = $4, min_order = $5, free_over = $6, eta_minutes = $7,
         is_active = $8
   WHERE id = $1
  RETURNING *)
SELECT ${ZONE_COLUMNS} FROM updated`;

const DELETE_ZONE_SQL = `DELETE FROM public.delivery_zones WHERE id = $1`;

/** `updated_by` fires the `row_version` and `updated_at` triggers of the branch (brief C10). */
const TOUCH_BRANCH_SQL = `UPDATE public.branches SET updated_by = $2 WHERE id = $1`;

/**
 * `ST_Distance` and `ST_DWithin` on `geography` (spheroid): the smallest active ring whose radius
 * reaches the point, boundary inclusive. `$2` longitude, `$3` latitude.
 */
const ZONE_FOR_POINT_SQL = `SELECT ST_Distance(b.location, p.point) AS distance_m,
  z.id::text AS id, z.name, z.radius_m, z.fee, z.min_order, z.free_over, z.eta_minutes,
  z.is_active, z.row_version, z.updated_at
  FROM public.branches b
 CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326)
                      ::geography AS point) p
  LEFT JOIN LATERAL (
    SELECT dz.* FROM public.delivery_zones dz
     WHERE dz.branch_id = b.id AND dz.is_active AND ST_DWithin(b.location, p.point, dz.radius_m)
     ORDER BY dz.radius_m, dz.id
     LIMIT 1) z ON true
 WHERE b.id = $1 AND b.deleted_at IS NULL`;

interface ZoneRecord {
  id: string;
  name: string;
  radius_m: number;
  fee: number;
  min_order: number;
  free_over: number | null;
  eta_minutes: number;
  is_active: boolean;
  row_version: number;
  updated_at: Date;
}

interface LockedBranch {
  accepts_delivery: boolean;
  updated_at: Date;
  updated_by: string | null;
  updated_by_name: string | null;
}

type ZoneForPointRecord = { distance_m: number } & (ZoneRecord | { [K in keyof ZoneRecord]: null });

function zoneView(record: ZoneRecord): AdminDeliveryZoneView {
  return {
    id: record.id,
    name: record.name,
    radiusM: record.radius_m,
    fee: record.fee,
    minOrder: record.min_order,
    freeOver: record.free_over,
    etaMinutes: record.eta_minutes,
    isActive: record.is_active,
    rowVersion: record.row_version,
    updatedAt: record.updated_at.toISOString(),
  };
}

function zoneValues(zone: AdminDeliveryZoneView): DeliveryZoneValues {
  return {
    name: zone.name,
    radiusM: zone.radiusM,
    fee: zone.fee,
    minOrder: zone.minOrder,
    freeOver: zone.freeOver,
    etaMinutes: zone.etaMinutes,
    isActive: zone.isActive,
  };
}

/**
 * The zone's concurrency state. Zones have no `updated_by`; every zone write sets the branch's
 * `updated_by` in the same transaction, so when both `updated_at` match (one `now()`), the branch
 * editor is the zone editor. Otherwise `updatedBy` is `null` (D-142).
 */
function zoneRowVersionState(zone: ZoneRecord, branch: LockedBranch): RowVersionState {
  const sameWrite =
    branch.updated_by !== null && branch.updated_at.getTime() === zone.updated_at.getTime();
  return {
    rowVersion: zone.row_version,
    updatedBy: sameWrite
      ? { id: branch.updated_by ?? '', name: branch.updated_by_name ?? '' }
      : null,
    updatedAt: zone.updated_at,
  };
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/**
 * `/admin/branches/{id}/delivery-zones` (api-outline "Branches"; A5-T4). Scoped as
 * `BranchesService` (api-divergences D-132): a `MANAGER` or `STAFF` reaches only the branches of
 * their `staff_branches`, any other id is `404`. Every write locks the branch, so the ring order
 * and the last-active rule are checked against a stable set; it also sets the branch `updated_by`,
 * which raises the branch `row_version` and `updated_at` through their triggers (brief C10). The
 * `branch.updated` event of a zone change is A10-T5's (brief C26).
 */
@Injectable()
export class DeliveryZonesService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ORDERS_FACTS) private readonly orders: OrdersFacts,
  ) {}

  /** Every ring of the branch, active or not, by radius; no cap (brief C27). */
  async list(actor: Actor, branchId: string): Promise<AdminDeliveryZoneListView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    return this.dataSource.transaction('REPEATABLE READ', async (em) => {
      const live = await em.query<unknown[]>(LIVE_BRANCH_SQL, [branchId]);
      if (live.length === 0) {
        throw new ApiError('NOT_FOUND');
      }
      const records = await em.query<ZoneRecord[]>(LIST_ZONES_SQL, [branchId]);
      return { items: records.map(zoneView), total: records.length };
    });
  }

  /** A new outermost ring and its `delivery_zone.create` audit row. */
  async create(
    actor: Actor,
    branchId: string,
    input: DeliveryZoneCreateInput,
  ): Promise<AdminDeliveryZoneView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    const values: DeliveryZoneValues = { ...input, freeOver: input.freeOver ?? null };
    if (!freeOverKeepsAboveMinOrder(values)) {
      throw new ApiError('VALIDATION_FAILED', { errors: [FREE_OVER_ERROR] });
    }

    return this.dataSource.transaction(async (em) => {
      await this.lockBranch(em, branchId);
      const zones = await em.query<ZoneRecord[]>(LOCK_ZONES_SQL, [branchId]);
      if (!radiusKeepsRingOrder(zones.map(ring), values.radiusM)) {
        throw new ApiError('VALIDATION_FAILED', { errors: [RADIUS_ORDER_ERROR] });
      }

      const created = await this.write(em, INSERT_ZONE_SQL, [
        branchId,
        values.name,
        values.radiusM,
        values.fee,
        values.minOrder,
        values.freeOver,
        values.etaMinutes,
        values.isActive,
      ]);
      await this.recordChange(em, actor, branchId, DELIVERY_ZONES_AUDIT.create, created, {
        before: null,
        after: values,
      });
      return created;
    });
  }

  /**
   * A partial change with the zone `rowVersion`: `RADIUS_ORDER` when a new radius leaves its
   * place between the neighbouring rings, `LAST_ACTIVE_ZONE` on `isActive`, `OUT_OF_RANGE` on
   * `freeOver` against the resulting `minOrder`.
   */
  async update(
    actor: Actor,
    branchId: string,
    zoneId: string,
    input: DeliveryZoneUpdateInput,
  ): Promise<AdminDeliveryZoneView> {
    await this.scopes.assertBranchAccess(actor, branchId);

    return this.dataSource.transaction(async (em) => {
      const branch = await this.lockBranch(em, branchId);
      const zones = await em.query<ZoneRecord[]>(LOCK_ZONES_SQL, [branchId]);
      const current = findZone(zones, zoneId);
      assertRowVersion(input.rowVersion, zoneRowVersionState(current, branch));

      const before = zoneValues(zoneView(current));
      const after = mergeZoneValues(before, input);
      const errors: ApiFieldError[] = [];
      if (
        after.radiusM !== before.radiusM &&
        !radiusKeepsRingOrder(zones.map(ring), after.radiusM, current.id)
      ) {
        errors.push(RADIUS_ORDER_ERROR);
      }
      if (!freeOverKeepsAboveMinOrder(after)) {
        errors.push(FREE_OVER_ERROR);
      }
      if (
        !after.isActive &&
        removesLastActiveZone(zones.map(activity), current.id, branch.accepts_delivery)
      ) {
        errors.push(lastActiveZoneError('isActive'));
      }
      if (errors.length > 0) {
        throw new ApiError('VALIDATION_FAILED', { errors });
      }

      const updated = await this.write(em, UPDATE_ZONE_SQL, [
        current.id,
        after.name,
        after.radiusM,
        after.fee,
        after.minOrder,
        after.freeOver,
        after.etaMinutes,
        after.isActive,
      ]);
      await this.recordChange(em, actor, branchId, DELIVERY_ZONES_AUDIT.update, updated, {
        before,
        after,
      });
      return updated;
    });
  }

  /**
   * `DELETE .../{zoneId}?rowVersion=`: `LAST_ACTIVE_ZONE` on `id` (brief C21); `409 IN_USE` with
   * `usage` when orders reference the zone, from `OrdersFacts.zoneUsage` or from the foreign key
   * of A8-T2 (SQLSTATE 23503), "stop using" being `isActive: false` (brief C22).
   */
  async remove(actor: Actor, branchId: string, zoneId: string, rowVersion: number): Promise<void> {
    await this.scopes.assertBranchAccess(actor, branchId);

    await this.dataSource.transaction(async (em) => {
      const branch = await this.lockBranch(em, branchId);
      const zones = await em.query<ZoneRecord[]>(LOCK_ZONES_SQL, [branchId]);
      const current = findZone(zones, zoneId);
      assertRowVersion(rowVersion, zoneRowVersionState(current, branch));

      if (removesLastActiveZone(zones.map(activity), current.id, branch.accepts_delivery)) {
        throw new ApiError('VALIDATION_FAILED', { errors: [lastActiveZoneError('id')] });
      }
      const usage = await this.orders.zoneUsage(current.id);
      if (usage > 0) {
        throw zoneInUseError(current.id, usage);
      }

      try {
        await em.query(DELETE_ZONE_SQL, [current.id]);
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          // At least one row references the zone, whatever the bound port counted.
          throw zoneInUseError(current.id, Math.max(usage, 1));
        }
        throw error;
      }
      const view = zoneView(current);
      await this.recordChange(em, actor, branchId, DELIVERY_ZONES_AUDIT.delete, view, {
        before: zoneValues(view),
        after: null,
      });
    });
  }

  /** `POST .../check` (`staff`, brief C24): the zone check for one point, nothing stored. */
  async check(
    actor: Actor,
    branchId: string,
    location: PointInput,
  ): Promise<DeliveryZoneCheckView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    const { distanceM, zone } = await this.findZoneForPoint(branchId, location.lat, location.lng);
    return { distanceM, zone, outOfZone: zone === null };
  }

  /**
   * The ring that serves a point (data-model "Query patterns", "Delivery quote"; WA2): the active
   * ring with the smallest `radius_m` for which `ST_DWithin(branch.location, point, radius_m)`
   * holds, boundary inclusive; inactive rings are ignored. `distanceM` is `ST_Distance` on
   * `geography`, rounded to a whole metre. `404` for a missing or soft-deleted branch. No scoping:
   * the caller (this controller, A8-T3) checks access first. The coordinates are never logged or
   * put into an error.
   */
  async findZoneForPoint(branchId: string, lat: number, lng: number): Promise<ZoneForPoint> {
    const rows = await this.dataSource.query<ZoneForPointRecord[]>(ZONE_FOR_POINT_SQL, [
      branchId,
      lng,
      lat,
    ]);
    const row = rows[0];
    if (row === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return {
      distanceM: Math.round(row.distance_m),
      zone: row.id === null ? null : zoneView(row as ZoneRecord),
    };
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

  /** Runs an insert or update returning the zone; known constraint violations become `400`. */
  private async write(
    em: EntityManager,
    sql: string,
    parameters: unknown[],
  ): Promise<AdminDeliveryZoneView> {
    let rows: ZoneRecord[];
    try {
      rows = await em.query<ZoneRecord[]>(sql, parameters);
    } catch (error) {
      throw zoneConstraintError(error) ?? error;
    }
    const record = rows[0];
    if (record === undefined) {
      throw new Error('The delivery zone write returned no row.');
    }
    return zoneView(record);
  }

  /** The audit row and the branch `updated_by` of one zone change, in the caller's transaction. */
  private async recordChange(
    em: EntityManager,
    actor: Actor,
    branchId: string,
    action: (typeof DELIVERY_ZONES_AUDIT)[keyof typeof DELIVERY_ZONES_AUDIT],
    zone: AdminDeliveryZoneView,
    change: { before: DeliveryZoneValues | null; after: DeliveryZoneValues | null },
  ): Promise<void> {
    await em.query(TOUCH_BRANCH_SQL, [branchId, actor.id]);
    await this.audit.write(
      {
        actorUserId: actor.id,
        action,
        entityType: 'DELIVERY_ZONE',
        entityId: zone.id,
        entityLabel: zoneAuditLabel(zone.name, zone.radiusM),
        branchId,
        diff: zoneDiff(change.before, change.after),
      },
      em,
    );
  }
}

function ring(record: ZoneRecord): ZoneRing {
  return { id: record.id, radiusM: record.radius_m };
}

function activity(record: ZoneRecord): { id: string; isActive: boolean } {
  return { id: record.id, isActive: record.is_active };
}

/** The zone of this branch; `404` for an id of another branch or no zone. */
function findZone(zones: readonly ZoneRecord[], zoneId: string): ZoneRecord {
  const wanted = zoneId.toLowerCase();
  const zone = zones.find((record) => record.id === wanted);
  if (zone === undefined) {
    throw new ApiError('NOT_FOUND');
  }
  return zone;
}
