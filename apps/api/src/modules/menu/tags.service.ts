import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { assertRowVersion } from '../../common/concurrency/row-version.js';
import type { RowVersionState } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import { toOffset } from '../../common/pagination/page-query.dto.js';
import { slugify } from '../../common/text/slugify.js';
import { escapeLike } from '../users/admin-users.service.js';
import type { TagKind } from './entities/tag.entity.js';

/** How many items `IN_USE` names in `usage.sample` (api-divergences D-160). */
export const TAG_USAGE_SAMPLE_SIZE = 5;
/** The bound of a derived slug (`TAG_SLUG_MAX_LENGTH` of the DTO). */
export const SLUG_MAX_LENGTH = 60;

/**
 * SQLSTATEs of a delete that a reference refuses: `foreign_key_violation` (NO ACTION) and
 * `restrict_violation`, which PostgreSQL 18 raises for `ON DELETE RESTRICT`
 * (`menu_item_tags.tag_id`; menu-schema.int-spec.ts).
 */
const REFERENCE_VIOLATIONS: readonly string[] = ['23503', '23001'];

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/tag.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface TagNamesView {
  readonly vi: string;
  readonly en?: string;
}

export interface AdminTagView {
  readonly id: string;
  readonly kind: TagKind;
  readonly slug: string;
  readonly names: TagNamesView;
  readonly itemCount: number;
  readonly unverifiedCount: number;
  readonly branchCount: number;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface AdminTagPageView {
  readonly items: AdminTagView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** The `usage` member of `IN_USE` (api-outline "Payloads added to existing codes"; D-160). */
export interface TagUsagePayload {
  readonly count: number;
  readonly sample: readonly { readonly id: string; readonly name: string }[];
  readonly filter: { readonly tagId: string };
}

// ---------------------------------------------------------------------------------------------
// Inputs (validated by the DTOs of `dto/tag.dto.ts`)
// ---------------------------------------------------------------------------------------------

export interface TagListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
  readonly kind?: TagKind;
  readonly limit?: number;
  readonly ids?: readonly string[];
}

export interface TagCreateInput {
  readonly kind: TagKind;
  readonly slug?: string;
  readonly names: TagNamesView;
}

export interface TagUpdateInput {
  readonly rowVersion: number;
  readonly kind?: TagKind;
  readonly names?: TagNamesView;
}

type Actor = Pick<RequestUser, 'id'>;

// ---------------------------------------------------------------------------------------------
// Pure rules (unit-tested in `tags.service.spec.ts`)
// ---------------------------------------------------------------------------------------------

/** `DIETARY` and `ALLERGEN` tags are claims a manager confirms (brief B13); a `LABEL` is not. */
export function tagNeedsVerification(kind: TagKind): boolean {
  return kind === 'DIETARY' || kind === 'ALLERGEN';
}

/**
 * `unverifiedCount` of a list row: the links with no `verified_at` for a tag that needs
 * verification, 0 for a `LABEL` tag (nothing to verify).
 */
export function unverifiedCountFor(kind: TagKind, unverifiedLinks: number): number {
  return tagNeedsVerification(kind) ? unverifiedLinks : 0;
}

/**
 * The rows a list query reads: a page (`page`, `pageSize`), or in select mode the first `limit`
 * rows, reported as page 1 of size `limit` (api-divergences D-159).
 */
export function listWindow(query: {
  readonly page: number;
  readonly pageSize: number;
  readonly limit?: number;
}): { page: number; pageSize: number; offset: number; limit: number } {
  if (query.limit !== undefined) {
    return { page: 1, pageSize: query.limit, offset: 0, limit: query.limit };
  }
  return { page: query.page, pageSize: query.pageSize, ...toOffset(query) };
}

/** `q` for `LIKE`: trimmed, `\`, `%`, `_` escaped; `null` when blank. */
export function searchFragment(q: string | undefined): string | null {
  const value = q?.trim() ?? '';
  return value === '' ? null : escapeLike(value);
}

/**
 * The slug of a new tag (or the code of a new amenity): the one sent, else `slugify(names.vi)` cut
 * to 60 characters. `null` when the name leaves nothing (only symbols): the caller asks for one.
 */
export function slugForNew(name: string, slug: string | undefined): string | null {
  if (slug !== undefined) {
    return slug;
  }
  const derived = slugify(name).slice(0, SLUG_MAX_LENGTH).replace(/-+$/u, '');
  return derived === '' ? null : derived;
}

/** The stored `names` of a tag or an amenity: `vi`, and `en` only when it is not blank. */
export function normalizeNames(names: TagNamesView): TagNamesView {
  const en = names.en?.trim() ?? '';
  return en === '' ? { vi: names.vi.trim() } : { vi: names.vi.trim(), en };
}

/** `IN_USE` (409) with `usage`: a delete, or a `kind` change, of a tag that items carry. */
export function tagInUseError(usage: TagUsagePayload, detail: string): ApiError {
  return new ApiError('IN_USE', { detail, extras: { usage } });
}

function driverField(error: QueryFailedError, field: 'code' | 'constraint'): unknown {
  const failure = error as QueryFailedError & {
    readonly code?: unknown;
    readonly constraint?: unknown;
    readonly driverError?: { readonly code?: unknown; readonly constraint?: unknown };
  };
  return failure[field] ?? failure.driverError?.[field];
}

/** True for SQLSTATE 23503 or 23001: a link still references the row being deleted. */
export function isReferenceViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const code = driverField(error, 'code');
  return typeof code === 'string' && REFERENCE_VIOLATIONS.includes(code);
}

/** `ALREADY_EXISTS` for the slug's unique constraint (`tags_slug_unique`), or `null`. */
export function tagConstraintError(error: unknown): ApiError | null {
  if (
    error instanceof QueryFailedError &&
    driverField(error, 'constraint') === 'tags_slug_unique'
  ) {
    return new ApiError('ALREADY_EXISTS', { detail: 'The tag slug is already in use.' });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

/**
 * `$1` kind, `$2` the escaped `q` (or `null`), `$3` ids (or `null`). The name and `q` both go
 * through `kd_unaccent` (migration 0001) and `lower`, so `dau phong` finds `Đậu phộng`.
 */
const TAG_FILTER = `($1::public.tag_kind IS NULL OR t.kind = $1::public.tag_kind)
   AND ($2::text IS NULL
        OR lower(public.kd_unaccent(t.names->>'vi'))
           LIKE '%' || lower(public.kd_unaccent($2::text)) || '%' ESCAPE '\\')
   AND ($3::uuid[] IS NULL OR t.id = ANY($3::uuid[]))`;

/**
 * One row per tag with its counts. `item_count` and `unverified_links` count the links of items
 * that are not soft-deleted; `branch_count` the live branches that sell one of those items. Sorted
 * by `kind` (the enum order `DIETARY`, `ALLERGEN`, `LABEL`), the unaccented `vi` name, then `id`,
 * so pages are stable. `$4` limit, `$5` offset.
 */
const LIST_TAGS_SQL = `WITH links AS (
  SELECT mit.tag_id,
         count(*) FILTER (WHERE mi.deleted_at IS NULL)::int AS item_count,
         count(*) FILTER (WHERE mi.deleted_at IS NULL AND mit.verified_at IS NULL)::int
           AS unverified_links
    FROM public.menu_item_tags mit
    JOIN public.menu_items mi ON mi.id = mit.menu_item_id
   GROUP BY mit.tag_id),
selling AS (
  SELECT mit.tag_id, count(DISTINCT bmi.branch_id)::int AS branch_count
    FROM public.menu_item_tags mit
    JOIN public.menu_items mi ON mi.id = mit.menu_item_id AND mi.deleted_at IS NULL
    JOIN public.branch_menu_items bmi ON bmi.menu_item_id = mi.id
    JOIN public.branches b ON b.id = bmi.branch_id AND b.deleted_at IS NULL
   GROUP BY mit.tag_id)
SELECT t.id::text AS id, t.kind::text AS kind, t.slug, t.names, t.row_version, t.updated_at,
       COALESCE(l.item_count, 0) AS item_count,
       COALESCE(l.unverified_links, 0) AS unverified_links,
       COALESCE(s.branch_count, 0) AS branch_count
  FROM public.tags t
  LEFT JOIN links l ON l.tag_id = t.id
  LEFT JOIN selling s ON s.tag_id = t.id
 WHERE ${TAG_FILTER}
 ORDER BY t.kind, lower(public.kd_unaccent(t.names->>'vi')), t.id
 LIMIT $4 OFFSET $5`;

const COUNT_TAGS_SQL = `SELECT count(*)::int AS total FROM public.tags t WHERE ${TAG_FILTER}`;

/** The tag, locked: a link insert (`FOR KEY SHARE` of its foreign key) waits for this write. */
const LOCK_TAG_SQL = `SELECT t.id::text AS id, t.kind::text AS kind, t.names, t.row_version, t.updated_at,
       t.updated_by::text AS updated_by, u.display_name AS updated_by_name
  FROM public.tags t
  LEFT JOIN public.users u ON u.id = t.updated_by
 WHERE t.id = $1
   FOR UPDATE OF t`;

/**
 * Every link of the tag, soft-deleted items included (the foreign key counts them too): the total
 * and the first items, live ones first, by unaccented `vi` name (the slug when the item has no
 * `vi` translation yet).
 */
const TAG_USAGE_SQL = `SELECT count(*) OVER ()::int AS total, mi.id::text AS id,
       COALESCE(tr.name, mi.slug) AS name
  FROM public.menu_item_tags mit
  JOIN public.menu_items mi ON mi.id = mit.menu_item_id
  LEFT JOIN public.menu_item_translations tr ON tr.menu_item_id = mi.id AND tr.locale = 'vi'
 WHERE mit.tag_id = $1
 ORDER BY mi.deleted_at IS NOT NULL, lower(public.kd_unaccent(COALESCE(tr.name, mi.slug))), mi.id
 LIMIT $2`;

const INSERT_TAG_SQL = `INSERT INTO public.tags (kind, slug, names, updated_by)
VALUES ($1::public.tag_kind, $2, $3::jsonb, $4)
RETURNING id::text AS id`;

/** `updated_by` fires the `row_version` and `updated_at` triggers (migration 0015). */
const UPDATE_TAG_SQL = `UPDATE public.tags
   SET kind = $2::public.tag_kind, names = $3::jsonb, updated_by = $4
 WHERE id = $1`;

const DELETE_TAG_SQL = `DELETE FROM public.tags WHERE id = $1`;

interface TagRecord {
  id: string;
  kind: TagKind;
  slug: string;
  names: TagNamesView;
  row_version: number;
  updated_at: Date;
  item_count: number;
  unverified_links: number;
  branch_count: number;
}

interface LockedTag {
  id: string;
  kind: TagKind;
  names: TagNamesView;
  row_version: number;
  updated_at: Date;
  updated_by: string | null;
  updated_by_name: string | null;
}

interface UsageRecord {
  total: number;
  id: string;
  name: string;
}

function tagView(record: TagRecord): AdminTagView {
  return {
    id: record.id,
    kind: record.kind,
    slug: record.slug,
    names: record.names,
    itemCount: record.item_count,
    unverifiedCount: unverifiedCountFor(record.kind, record.unverified_links),
    branchCount: record.branch_count,
    rowVersion: record.row_version,
    updatedAt: record.updated_at.toISOString(),
  };
}

function rowVersionState(tag: LockedTag): RowVersionState {
  return {
    rowVersion: tag.row_version,
    updatedBy:
      tag.updated_by === null ? null : { id: tag.updated_by, name: tag.updated_by_name ?? '' },
    updatedAt: tag.updated_at,
  };
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/**
 * `/admin/tags` (api-outline "Menu and stock"; A6-T5; brief B24, B27, B30, B31). Tags are
 * brand-wide: the list and its counts cover every branch, whatever the caller's `staff_branches`.
 * Writes lock the tag row, so a link added by the item editor (A6-T7) waits, and the `IN_USE`
 * checks hold until the commit. Tag changes are not audited (not in the data-model audit list;
 * brief G7).
 */
@Injectable()
export class TagsService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** A page, or the first `limit` rows for a select, with `total` and the counts of each row. */
  async list(query: TagListQuery): Promise<AdminTagPageView> {
    const window = listWindow(query);
    const filter = [query.kind ?? null, searchFragment(query.q), query.ids ?? null];
    return this.dataSource.transaction('REPEATABLE READ', async (em) => {
      const records = await em.query<TagRecord[]>(LIST_TAGS_SQL, [
        ...filter,
        window.limit,
        window.offset,
      ]);
      const [count] = await em.query<{ total: number }[]>(COUNT_TAGS_SQL, filter);
      return {
        items: records.map(tagView),
        page: window.page,
        pageSize: window.pageSize,
        total: count?.total ?? 0,
      };
    });
  }

  /** A new tag; `ALREADY_EXISTS` when the slug is taken. */
  async create(actor: Actor, input: TagCreateInput): Promise<AdminTagView> {
    const names = normalizeNames(input.names);
    const slug = slugForNew(names.vi, input.slug);
    if (slug === null) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [
          {
            field: 'slug',
            code: 'REQUIRED',
            message: 'is required when the name has no letter or digit',
          },
        ],
      });
    }
    try {
      return await this.dataSource.transaction(async (em) => {
        const [created] = await em.query<{ id: string }[]>(INSERT_TAG_SQL, [
          input.kind,
          slug,
          JSON.stringify(names),
          actor.id,
        ]);
        if (created === undefined) {
          throw new Error('INSERT INTO tags returned no row.');
        }
        return this.view(em, created.id);
      });
    } catch (error) {
      throw tagConstraintError(error) ?? error;
    }
  }

  /** A partial change with the tag `rowVersion`; a new `kind` on a used tag is `IN_USE` (B30). */
  async update(actor: Actor, id: string, input: TagUpdateInput): Promise<AdminTagView> {
    return this.dataSource.transaction(async (em) => {
      const current = await this.lock(em, id);
      assertRowVersion(input.rowVersion, rowVersionState(current));
      const kind = input.kind ?? current.kind;
      if (kind !== current.kind) {
        const usage = await this.usage(em, id);
        if (usage.count > 0) {
          throw tagInUseError(usage, 'Items carry the tag; its group cannot change.');
        }
      }
      const names = input.names === undefined ? current.names : normalizeNames(input.names);
      await em.query(UPDATE_TAG_SQL, [id, kind, JSON.stringify(names), actor.id]);
      return this.view(em, id);
    });
  }

  /** Hard delete with the tag `rowVersion`; `IN_USE` while an item, even soft-deleted, carries it. */
  async remove(id: string, rowVersion: number): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        const current = await this.lock(em, id);
        assertRowVersion(rowVersion, rowVersionState(current));
        const usage = await this.usage(em, id);
        if (usage.count > 0) {
          throw tagInUseError(usage, 'Items carry the tag; remove it from them first.');
        }
        await em.query(DELETE_TAG_SQL, [id]);
      });
    } catch (error) {
      if (!isReferenceViolation(error)) {
        throw error;
      }
      // A link written between the check and the delete: answer with the usage as it is now.
      const usage = await this.usage(this.dataSource.manager, id);
      throw tagInUseError(usage, 'Items carry the tag; remove it from them first.');
    }
  }

  private async lock(em: EntityManager, id: string): Promise<LockedTag> {
    const [current] = await em.query<LockedTag[]>(LOCK_TAG_SQL, [id]);
    if (current === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return current;
  }

  private async view(em: EntityManager, id: string): Promise<AdminTagView> {
    const [record] = await em.query<TagRecord[]>(LIST_TAGS_SQL, [null, null, [id], 1, 0]);
    if (record === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return tagView(record);
  }

  private async usage(em: EntityManager, id: string): Promise<TagUsagePayload> {
    const rows = await em.query<UsageRecord[]>(TAG_USAGE_SQL, [id, TAG_USAGE_SAMPLE_SIZE]);
    return {
      count: rows[0]?.total ?? 0,
      sample: rows.map((row) => ({ id: row.id, name: row.name })),
      filter: { tagId: id },
    };
  }
}
