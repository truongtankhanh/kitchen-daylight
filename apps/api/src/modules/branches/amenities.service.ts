import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { assertRowVersion } from '../../common/concurrency/row-version.js';
import type { RowVersionState } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import {
  isReferenceViolation,
  listWindow,
  normalizeNames,
  searchFragment,
  slugForNew,
} from '../menu/tags.service.js';
import type { AmenityIcon } from './amenity-icons.js';

/** How many branches `IN_USE` names in `usage.sample` (api-divergences D-160). */
export const AMENITY_USAGE_SAMPLE_SIZE = 5;

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/amenity.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface AmenityNamesView {
  readonly vi: string;
  readonly en?: string;
}

export interface AdminAmenityView {
  readonly id: string;
  readonly code: string;
  readonly names: AmenityNamesView;
  readonly icon: AmenityIcon;
  readonly branchCount: number;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface AdminAmenityPageView {
  readonly items: AdminAmenityView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** The `usage` member of `IN_USE` (api-outline "Payloads added to existing codes"; D-160). */
export interface AmenityUsagePayload {
  readonly count: number;
  readonly sample: readonly { readonly id: string; readonly name: string }[];
  readonly filter: { readonly amenityId: string };
}

// ---------------------------------------------------------------------------------------------
// Inputs (validated by the DTOs of `dto/amenity.dto.ts`)
// ---------------------------------------------------------------------------------------------

export interface AmenityListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
  readonly limit?: number;
  readonly ids?: readonly string[];
}

export interface AmenityCreateInput {
  readonly code?: string;
  readonly names: AmenityNamesView;
  readonly icon: AmenityIcon;
}

export interface AmenityUpdateInput {
  readonly rowVersion: number;
  readonly names?: AmenityNamesView;
  readonly icon?: AmenityIcon;
}

/** `IN_USE` (409) with `usage`: the delete of an amenity that a branch shows (brief B24). */
export function amenityInUseError(usage: AmenityUsagePayload): ApiError {
  return new ApiError('IN_USE', {
    detail: 'Branches show the amenity; remove it from them first.',
    extras: { usage },
  });
}

/** `ALREADY_EXISTS` for the code's unique constraint (`amenities_code_unique`), or `null`. */
export function amenityConstraintError(error: unknown): ApiError | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const failure = error as QueryFailedError & {
    readonly constraint?: unknown;
    readonly driverError?: { readonly constraint?: unknown };
  };
  const name = failure.constraint ?? failure.driverError?.constraint;
  return name === 'amenities_code_unique'
    ? new ApiError('ALREADY_EXISTS', { detail: 'The amenity code is already in use.' })
    : null;
}

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

/** `$1` the escaped `q` (or `null`), `$2` ids (or `null`); `kd_unaccent` as in `tags.service.ts`. */
const AMENITY_FILTER = `($1::text IS NULL
        OR lower(public.kd_unaccent(a.names->>'vi'))
           LIKE '%' || lower(public.kd_unaccent($1::text)) || '%' ESCAPE '\\')
   AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))`;

/**
 * One row per amenity with the live branches that show it. Sorted by the unaccented `vi` name,
 * then `id` (amenities have no group), so pages are stable. `$3` limit, `$4` offset.
 */
const LIST_AMENITIES_SQL = `SELECT a.id::text AS id, a.code, a.names, a.icon, a.row_version,
       a.updated_at,
       (SELECT count(*)::int
          FROM public.branch_amenities ba
          JOIN public.branches b ON b.id = ba.branch_id AND b.deleted_at IS NULL
         WHERE ba.amenity_id = a.id) AS branch_count
  FROM public.amenities a
 WHERE ${AMENITY_FILTER}
 ORDER BY lower(public.kd_unaccent(a.names->>'vi')), a.id
 LIMIT $3 OFFSET $4`;

const COUNT_AMENITIES_SQL = `SELECT count(*)::int AS total FROM public.amenities a
 WHERE ${AMENITY_FILTER}`;

/** The amenity, locked: a branch link insert (`FOR KEY SHARE`) waits for this write. */
const LOCK_AMENITY_SQL = `SELECT id::text AS id, names, icon, row_version, updated_at
  FROM public.amenities
 WHERE id = $1
   FOR UPDATE`;

/**
 * Every branch that shows the amenity, soft-deleted ones included (the foreign key counts them
 * too): the total and the first branches, live ones first, by unaccented name.
 */
const AMENITY_USAGE_SQL = `SELECT count(*) OVER ()::int AS total, b.id::text AS id, b.name
  FROM public.branch_amenities ba
  JOIN public.branches b ON b.id = ba.branch_id
 WHERE ba.amenity_id = $1
 ORDER BY b.deleted_at IS NOT NULL, lower(public.kd_unaccent(b.name)), b.id
 LIMIT $2`;

const INSERT_AMENITY_SQL = `INSERT INTO public.amenities (code, names, icon)
VALUES ($1, $2::jsonb, $3)
RETURNING id::text AS id`;

const UPDATE_AMENITY_SQL = `UPDATE public.amenities SET names = $2::jsonb, icon = $3 WHERE id = $1`;

const DELETE_AMENITY_SQL = `DELETE FROM public.amenities WHERE id = $1`;

interface AmenityRecord {
  id: string;
  code: string;
  names: AmenityNamesView;
  icon: AmenityIcon;
  row_version: number;
  updated_at: Date;
  branch_count: number;
}

interface LockedAmenity {
  id: string;
  names: AmenityNamesView;
  icon: AmenityIcon;
  row_version: number;
  updated_at: Date;
}

function amenityView(record: AmenityRecord): AdminAmenityView {
  return {
    id: record.id,
    code: record.code,
    names: record.names,
    icon: record.icon,
    branchCount: record.branch_count,
    rowVersion: record.row_version,
    updatedAt: record.updated_at.toISOString(),
  };
}

/** `amenities` has no `updated_by` (migration 0013, D-129): `updatedBy` is always `null` (D-162). */
function rowVersionState(amenity: LockedAmenity): RowVersionState {
  return { rowVersion: amenity.row_version, updatedBy: null, updatedAt: amenity.updated_at };
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/**
 * `/admin/amenities` (api-outline "Menu and stock"; A6-T5; brief B24, B32). `ADMIN` only.
 * Amenities are brand-wide; a branch picks its own through `PATCH /admin/branches/{id}` (A5-T2).
 * Writes lock the amenity row, so the `IN_USE` check holds until the commit. Not audited (not in
 * the data-model audit list; brief G7).
 */
@Injectable()
export class AmenitiesService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** A page, or the first `limit` rows for a select, with `total` and `branchCount` per row. */
  async list(query: AmenityListQuery): Promise<AdminAmenityPageView> {
    const window = listWindow(query);
    const filter = [searchFragment(query.q), query.ids ?? null];
    return this.dataSource.transaction('REPEATABLE READ', async (em) => {
      const records = await em.query<AmenityRecord[]>(LIST_AMENITIES_SQL, [
        ...filter,
        window.limit,
        window.offset,
      ]);
      const [count] = await em.query<{ total: number }[]>(COUNT_AMENITIES_SQL, filter);
      return {
        items: records.map(amenityView),
        page: window.page,
        pageSize: window.pageSize,
        total: count?.total ?? 0,
      };
    });
  }

  /** A new amenity; `ALREADY_EXISTS` when the code is taken. */
  async create(input: AmenityCreateInput): Promise<AdminAmenityView> {
    const names = normalizeNames(input.names);
    const code = slugForNew(names.vi, input.code);
    if (code === null) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [
          {
            field: 'code',
            code: 'REQUIRED',
            message: 'is required when the name has no letter or digit',
          },
        ],
      });
    }
    try {
      return await this.dataSource.transaction(async (em) => {
        const [created] = await em.query<{ id: string }[]>(INSERT_AMENITY_SQL, [
          code,
          JSON.stringify(names),
          input.icon,
        ]);
        if (created === undefined) {
          throw new Error('INSERT INTO amenities returned no row.');
        }
        return this.view(em, created.id);
      });
    } catch (error) {
      throw amenityConstraintError(error) ?? error;
    }
  }

  /** `names` and `icon` with the amenity `rowVersion`. */
  async update(id: string, input: AmenityUpdateInput): Promise<AdminAmenityView> {
    return this.dataSource.transaction(async (em) => {
      const current = await this.lock(em, id);
      assertRowVersion(input.rowVersion, rowVersionState(current));
      const names = input.names === undefined ? current.names : normalizeNames(input.names);
      await em.query(UPDATE_AMENITY_SQL, [id, JSON.stringify(names), input.icon ?? current.icon]);
      return this.view(em, id);
    });
  }

  /** Hard delete with the `rowVersion`; `IN_USE` while a branch, even soft-deleted, shows it. */
  async remove(id: string, rowVersion: number): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        const current = await this.lock(em, id);
        assertRowVersion(rowVersion, rowVersionState(current));
        const usage = await this.usage(em, id);
        if (usage.count > 0) {
          throw amenityInUseError(usage);
        }
        await em.query(DELETE_AMENITY_SQL, [id]);
      });
    } catch (error) {
      if (!isReferenceViolation(error)) {
        throw error;
      }
      // A link written between the check and the delete: answer with the usage as it is now.
      throw amenityInUseError(await this.usage(this.dataSource.manager, id));
    }
  }

  private async lock(em: EntityManager, id: string): Promise<LockedAmenity> {
    const [current] = await em.query<LockedAmenity[]>(LOCK_AMENITY_SQL, [id]);
    if (current === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return current;
  }

  private async view(em: EntityManager, id: string): Promise<AdminAmenityView> {
    const [record] = await em.query<AmenityRecord[]>(LIST_AMENITIES_SQL, [null, [id], 1, 0]);
    if (record === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return amenityView(record);
  }

  private async usage(em: EntityManager, id: string): Promise<AmenityUsagePayload> {
    const rows = await em.query<{ total: number; id: string; name: string }[]>(AMENITY_USAGE_SQL, [
      id,
      AMENITY_USAGE_SAMPLE_SIZE,
    ]);
    return {
      count: rows[0]?.total ?? 0,
      sample: rows.map((row) => ({ id: row.id, name: row.name })),
      filter: { amenityId: id },
    };
  }
}
