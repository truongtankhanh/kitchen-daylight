import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { assertRowVersion } from '../../common/concurrency/row-version.js';
import type { RowVersionState } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { toOffset } from '../../common/pagination/page-query.dto.js';
import {
  isReferenceViolation,
  normalizeNames,
  searchFragment,
  slugForNew,
} from './tags.service.js';

/** How many items `IN_USE` names in `usage.sample` (as tags, api-divergences D-160). */
export const CATEGORY_USAGE_SAMPLE_SIZE = 5;

/**
 * `icon`: a lower-case key of letters, digits and hyphens, 1 to 40 characters (mobile G6). Only the
 * shape is checked: the list of keys is not written yet (data-model `menu_categories` row), so
 * membership is not (api-divergences D-163).
 */
export const CATEGORY_ICON_PATTERN = /^[a-z0-9-]{1,40}$/u;

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/category.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface CategoryNamesView {
  readonly vi: string;
  readonly en?: string;
}

export interface AdminCategoryView {
  readonly id: string;
  readonly slug: string;
  readonly names: CategoryNamesView;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly itemCount: number;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface AdminCategoryPageView {
  readonly items: AdminCategoryView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** `POST /admin/menu-categories/reorder`: every category in the new order. */
export interface AdminCategoryListView {
  readonly items: AdminCategoryView[];
  readonly total: number;
}

/** One item of `PUT .../items-order`, with the version its trigger raised. */
export interface MenuItemPositionView {
  readonly id: string;
  readonly sortOrder: number;
  readonly rowVersion: number;
}

export interface CategoryItemsOrderView {
  readonly items: MenuItemPositionView[];
}

/** The `usage` member of `IN_USE` (api-outline "Payloads added to existing codes"). */
export interface CategoryUsagePayload {
  readonly count: number;
  readonly sample: readonly { readonly id: string; readonly name: string }[];
  readonly filter: { readonly categoryId: string };
}

// ---------------------------------------------------------------------------------------------
// Inputs (validated by the DTOs of `dto/category.dto.ts`)
// ---------------------------------------------------------------------------------------------

export interface CategoryListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
}

export interface CategoryCreateInput {
  readonly names: CategoryNamesView;
  readonly slug?: string;
  readonly icon?: string | null;
  readonly sortOrder?: number;
  readonly isActive: boolean;
}

export interface CategoryUpdateInput {
  readonly rowVersion: number;
  readonly names?: CategoryNamesView;
  /** `null` clears it. */
  readonly icon?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

export interface CategoryReorderInput {
  readonly ids: readonly string[];
  readonly rowVersions: readonly number[];
}

type Actor = Pick<RequestUser, 'id'>;

// ---------------------------------------------------------------------------------------------
// Pure rules (unit-tested in `categories.service.spec.ts`)
// ---------------------------------------------------------------------------------------------

/** True for a key of the icon shape (`CATEGORY_ICON_PATTERN`); membership is not checked. */
export function isCategoryIconKey(value: unknown): value is string {
  return typeof value === 'string' && CATEGORY_ICON_PATTERN.test(value);
}

/**
 * True when `ids` holds every id of `all` exactly once and nothing else (UUIDs compared in lower
 * case). A missing, unknown or repeated id is not a permutation.
 */
export function isPermutationOf(ids: readonly string[], all: readonly string[]): boolean {
  if (ids.length !== all.length) {
    return false;
  }
  const expected = new Set(all.map((id) => id.toLowerCase()));
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.toLowerCase();
    if (!expected.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return true;
}

/** The `sort_order` of a new category sent without one: after the last (1 when none). */
export function nextSortOrder(maxSortOrder: number | null): number {
  return maxSortOrder === null ? 1 : maxSortOrder + 1;
}

function fieldError(field: string, code: ApiFieldError['code'], message: string): ApiFieldError {
  return { field, code, message };
}

/** `ids` of a reorder that is not a permutation of every category. */
export const REORDER_IDS_ERROR: ApiFieldError = Object.freeze(
  fieldError('ids', 'INVALID', 'must list every category exactly once'),
);

/** `rowVersions` of a reorder that is not parallel to `ids`. */
export const REORDER_VERSIONS_ERROR: ApiFieldError = Object.freeze(
  fieldError('rowVersions', 'INVALID', 'must have one version per id'),
);

/** `itemIds` that are not exactly the non-deleted items of the category. */
export const ITEMS_ORDER_ERROR: ApiFieldError = Object.freeze(
  fieldError('itemIds', 'INVALID', 'must list every item of the category exactly once'),
);

/** `IN_USE` (409) with `usage`: the delete of a category that items, even deleted, reference. */
export function categoryInUseError(usage: CategoryUsagePayload): ApiError {
  return new ApiError('IN_USE', {
    detail: 'Items reference the category; move or delete them first.',
    extras: { usage },
  });
}

/** `ALREADY_EXISTS` for the slug's unique constraint (`menu_categories_slug_unique`), or `null`. */
export function categoryConstraintError(error: unknown): ApiError | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const failure = error as QueryFailedError & {
    readonly constraint?: unknown;
    readonly driverError?: { readonly constraint?: unknown };
  };
  const name = failure.constraint ?? failure.driverError?.constraint;
  return name === 'menu_categories_slug_unique'
    ? new ApiError('ALREADY_EXISTS', { detail: 'The category slug is already in use.' })
    : null;
}

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

/** `$1` the escaped `q` (or `null`), `$2` ids (or `null`); `kd_unaccent` as in `tags.service.ts`. */
const CATEGORY_FILTER = `($1::text IS NULL
        OR lower(public.kd_unaccent(c.names->>'vi'))
           LIKE '%' || lower(public.kd_unaccent($1::text)) || '%' ESCAPE '\\')
   AND ($2::uuid[] IS NULL OR c.id = ANY($2::uuid[]))`;

/**
 * One row per category with its live items. Sorted by `sort_order`, the unaccented `vi` name,
 * then `id`, so pages are stable. `$3` limit (`null`: all), `$4` offset.
 */
const LIST_CATEGORIES_SQL = `SELECT c.id::text AS id, c.slug, c.names, c.icon, c.sort_order,
       c.is_active, c.row_version, c.updated_at,
       (SELECT count(*)::int FROM public.menu_items mi
         WHERE mi.category_id = c.id AND mi.deleted_at IS NULL) AS item_count
  FROM public.menu_categories c
 WHERE ${CATEGORY_FILTER}
 ORDER BY c.sort_order, lower(public.kd_unaccent(c.names->>'vi')), c.id
 LIMIT $3 OFFSET $4`;

const COUNT_CATEGORIES_SQL = `SELECT count(*)::int AS total FROM public.menu_categories c
 WHERE ${CATEGORY_FILTER}`;

const LOCK_CATEGORY_COLUMNS = `c.id::text AS id, c.names, c.icon, c.sort_order, c.is_active,
       c.row_version, c.updated_at, c.updated_by::text AS updated_by,
       u.display_name AS updated_by_name
  FROM public.menu_categories c
  LEFT JOIN public.users u ON u.id = c.updated_by`;

/** The category, locked: an item insert or move (`FOR KEY SHARE`) waits for this write. */
const LOCK_CATEGORY_SQL = `SELECT ${LOCK_CATEGORY_COLUMNS}
 WHERE c.id = $1
   FOR UPDATE OF c`;

/** Every category, locked, for a reorder. */
const LOCK_ALL_CATEGORIES_SQL = `SELECT ${LOCK_CATEGORY_COLUMNS}
 ORDER BY c.id
   FOR UPDATE OF c`;

/** A new category without a `sort_order` goes after the last one. */
const MAX_SORT_ORDER_SQL = `SELECT max(sort_order) AS max FROM public.menu_categories`;

/**
 * Every item of the category, soft-deleted ones included (the foreign key counts them too): the
 * total and the first items, live ones first, by unaccented `vi` name (the slug when the item has
 * no `vi` translation yet).
 */
const CATEGORY_USAGE_SQL = `SELECT count(*) OVER ()::int AS total, mi.id::text AS id,
       COALESCE(tr.name, mi.slug) AS name
  FROM public.menu_items mi
  LEFT JOIN public.menu_item_translations tr ON tr.menu_item_id = mi.id AND tr.locale = 'vi'
 WHERE mi.category_id = $1
 ORDER BY mi.deleted_at IS NOT NULL, lower(public.kd_unaccent(COALESCE(tr.name, mi.slug))), mi.id
 LIMIT $2`;

const INSERT_CATEGORY_SQL = `INSERT INTO public.menu_categories
  (slug, names, icon, sort_order, is_active, updated_by)
VALUES ($1, $2::jsonb, $3, $4, $5, $6)
RETURNING id::text AS id`;

/** `updated_by` fires the `row_version` and `updated_at` triggers (migration 0015). */
const UPDATE_CATEGORY_SQL = `UPDATE public.menu_categories
   SET names = $2::jsonb, icon = $3, sort_order = $4, is_active = $5, updated_by = $6
 WHERE id = $1`;

const DELETE_CATEGORY_SQL = `DELETE FROM public.menu_categories WHERE id = $1`;

/** `sort_order` 1 to N in the order of `$1`; every row's version is raised by its trigger. */
const REORDER_CATEGORIES_SQL = `UPDATE public.menu_categories c
   SET sort_order = t.position, updated_by = $2
  FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, position)
 WHERE c.id = t.id`;

/** The live items of a category, locked, for an items reorder. */
const LOCK_CATEGORY_ITEMS_SQL = `SELECT id::text AS id FROM public.menu_items
 WHERE category_id = $1 AND deleted_at IS NULL
 ORDER BY id
   FOR UPDATE`;

/**
 * `sort_order` 1 to N in the order of `$1`, with the editor (brief B1). The `row_version` and
 * `updated_at` triggers of `menu_items` raise every touched item; they are not bypassed.
 */
const REORDER_ITEMS_SQL = `WITH updated AS (
  UPDATE public.menu_items mi
     SET sort_order = t.position, updated_by = $2
    FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, position)
   WHERE mi.id = t.id
  RETURNING mi.id, mi.sort_order, mi.row_version)
SELECT id::text AS id, sort_order, row_version FROM updated ORDER BY sort_order`;

interface CategoryRecord {
  id: string;
  slug: string;
  names: CategoryNamesView;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  row_version: number;
  updated_at: Date;
  item_count: number;
}

interface LockedCategory {
  id: string;
  names: CategoryNamesView;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  row_version: number;
  updated_at: Date;
  updated_by: string | null;
  updated_by_name: string | null;
}

function categoryView(record: CategoryRecord): AdminCategoryView {
  return {
    id: record.id,
    slug: record.slug,
    names: record.names,
    icon: record.icon,
    sortOrder: record.sort_order,
    isActive: record.is_active,
    itemCount: record.item_count,
    rowVersion: record.row_version,
    updatedAt: record.updated_at.toISOString(),
  };
}

function rowVersionState(category: LockedCategory): RowVersionState {
  return {
    rowVersion: category.row_version,
    updatedBy:
      category.updated_by === null
        ? null
        : { id: category.updated_by, name: category.updated_by_name ?? '' },
    updatedAt: category.updated_at,
  };
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/**
 * `/admin/menu-categories` (api-outline "Menu and stock"; A6-T6; brief B4, B25 to B28, B31; mobile
 * G6). Categories are brand-wide: no branch scoping. Writes lock the rows they change. A hidden
 * category (`isActive: false`) is only a flag here; hiding its items from customers is A7-T2.
 * Not audited (not in the data-model audit list).
 */
@Injectable()
export class CategoriesService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** A page with `total` and the live `itemCount` of each row. */
  async list(query: CategoryListQuery): Promise<AdminCategoryPageView> {
    const { offset, limit } = toOffset(query);
    const filter = [searchFragment(query.q), null];
    return this.dataSource.transaction('REPEATABLE READ', async (em) => {
      const records = await em.query<CategoryRecord[]>(LIST_CATEGORIES_SQL, [
        ...filter,
        limit,
        offset,
      ]);
      const [count] = await em.query<{ total: number }[]>(COUNT_CATEGORIES_SQL, filter);
      return {
        items: records.map(categoryView),
        page: query.page,
        pageSize: query.pageSize,
        total: count?.total ?? 0,
      };
    });
  }

  /** A new category, after the last one unless `sortOrder` is sent; `ALREADY_EXISTS` on the slug. */
  async create(actor: Actor, input: CategoryCreateInput): Promise<AdminCategoryView> {
    const names = normalizeNames(input.names);
    const slug = slugForNew(names.vi, input.slug);
    if (slug === null) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [
          fieldError('slug', 'REQUIRED', 'is required when the name has no letter or digit'),
        ],
      });
    }
    try {
      return await this.dataSource.transaction(async (em) => {
        let sortOrder = input.sortOrder;
        if (sortOrder === undefined) {
          const [max] = await em.query<{ max: number | null }[]>(MAX_SORT_ORDER_SQL);
          sortOrder = nextSortOrder(max?.max ?? null);
        }
        const [created] = await em.query<{ id: string }[]>(INSERT_CATEGORY_SQL, [
          slug,
          JSON.stringify(names),
          input.icon ?? null,
          sortOrder,
          input.isActive,
          actor.id,
        ]);
        if (created === undefined) {
          throw new Error('INSERT INTO menu_categories returned no row.');
        }
        return this.view(em, created.id);
      });
    } catch (error) {
      throw categoryConstraintError(error) ?? error;
    }
  }

  /** `names`, `icon` (`null` clears), `sortOrder` and `isActive` with the `rowVersion`. */
  async update(actor: Actor, id: string, input: CategoryUpdateInput): Promise<AdminCategoryView> {
    return this.dataSource.transaction(async (em) => {
      const current = await this.lock(em, id);
      assertRowVersion(input.rowVersion, rowVersionState(current));
      await em.query(UPDATE_CATEGORY_SQL, [
        id,
        JSON.stringify(input.names === undefined ? current.names : normalizeNames(input.names)),
        input.icon === undefined ? current.icon : input.icon,
        input.sortOrder ?? current.sort_order,
        input.isActive ?? current.is_active,
        actor.id,
      ]);
      return this.view(em, id);
    });
  }

  /**
   * Hard delete with the `rowVersion`, only when no item references the category, soft-deleted
   * ones included (`menu_items.category_id` is `RESTRICT`; brief B25, B26); `IN_USE` otherwise.
   */
  async remove(id: string, rowVersion: number): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        const current = await this.lock(em, id);
        assertRowVersion(rowVersion, rowVersionState(current));
        const usage = await this.usage(em, id);
        if (usage.count > 0) {
          throw categoryInUseError(usage);
        }
        await em.query(DELETE_CATEGORY_SQL, [id]);
      });
    } catch (error) {
      if (!isReferenceViolation(error)) {
        throw error;
      }
      // An item written between the check and the delete: answer with the usage as it is now.
      throw categoryInUseError(await this.usage(this.dataSource.manager, id));
    }
  }

  /**
   * `sort_order` 1 to N in the order of `ids`, which must list every category once
   * (`VALIDATION_FAILED` on `ids`); `rowVersions[i]` is the version of `ids[i]`, and the first
   * mismatch is `STALE_VERSION` with nothing changed (brief B28).
   */
  async reorder(actor: Actor, input: CategoryReorderInput): Promise<AdminCategoryListView> {
    if (input.rowVersions.length !== input.ids.length) {
      throw new ApiError('VALIDATION_FAILED', { errors: [REORDER_VERSIONS_ERROR] });
    }
    const ids = input.ids.map((id) => id.toLowerCase());
    return this.dataSource.transaction(async (em) => {
      const locked = await em.query<LockedCategory[]>(LOCK_ALL_CATEGORIES_SQL);
      if (
        !isPermutationOf(
          ids,
          locked.map((category) => category.id),
        )
      ) {
        throw new ApiError('VALIDATION_FAILED', { errors: [REORDER_IDS_ERROR] });
      }
      const byId = new Map(locked.map((category) => [category.id, category]));
      ids.forEach((id, index) => {
        const current = byId.get(id);
        if (current !== undefined) {
          assertRowVersion(input.rowVersions[index] ?? 0, rowVersionState(current));
        }
      });
      await em.query(REORDER_CATEGORIES_SQL, [ids, actor.id]);
      const records = await em.query<CategoryRecord[]>(LIST_CATEGORIES_SQL, [null, null, null, 0]);
      return { items: records.map(categoryView), total: records.length };
    });
  }

  /**
   * `sort_order` 1 to N of the category's live items in the order of `itemIds`, which must list
   * them all once (`VALIDATION_FAILED` on `itemIds`; brief B4). Every touched item gets a new
   * `rowVersion` from its trigger, returned here.
   */
  async reorderItems(
    actor: Actor,
    categoryId: string,
    itemIds: readonly string[],
  ): Promise<CategoryItemsOrderView> {
    const ids = itemIds.map((id) => id.toLowerCase());
    return this.dataSource.transaction(async (em) => {
      await this.lock(em, categoryId);
      const items = await em.query<{ id: string }[]>(LOCK_CATEGORY_ITEMS_SQL, [categoryId]);
      if (
        !isPermutationOf(
          ids,
          items.map((item) => item.id),
        )
      ) {
        throw new ApiError('VALIDATION_FAILED', { errors: [ITEMS_ORDER_ERROR] });
      }
      const rows = await em.query<{ id: string; sort_order: number; row_version: number }[]>(
        REORDER_ITEMS_SQL,
        [ids, actor.id],
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          sortOrder: row.sort_order,
          rowVersion: row.row_version,
        })),
      };
    });
  }

  private async lock(em: EntityManager, id: string): Promise<LockedCategory> {
    const [current] = await em.query<LockedCategory[]>(LOCK_CATEGORY_SQL, [id]);
    if (current === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return current;
  }

  private async view(em: EntityManager, id: string): Promise<AdminCategoryView> {
    const [record] = await em.query<CategoryRecord[]>(LIST_CATEGORIES_SQL, [null, [id], 1, 0]);
    if (record === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return categoryView(record);
  }

  private async usage(em: EntityManager, id: string): Promise<CategoryUsagePayload> {
    const rows = await em.query<{ total: number; id: string; name: string }[]>(CATEGORY_USAGE_SQL, [
      id,
      CATEGORY_USAGE_SAMPLE_SIZE,
    ]);
    return {
      count: rows[0]?.total ?? 0,
      sample: rows.map((row) => ({ id: row.id, name: row.name })),
      filter: { categoryId: id },
    };
  }
}
