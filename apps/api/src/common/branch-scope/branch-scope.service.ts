import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { RequestUser } from '../auth/request-user.js';
import { ApiError } from '../errors/api-error.js';

/**
 * The branches a request may see:
 *
 * - `ALL`: every branch (`ADMIN` without requested ids). A query adds no branch filter.
 * - `BRANCHES`: exactly `branchIds` (lower-case UUIDs, no duplicates). A query filters
 *   `branch_id = ANY($n::uuid[])`; an empty list matches nothing.
 *
 * Soft-deleted branches are not removed here: list endpoints filter `branches.deleted_at`
 * themselves.
 */
export type BranchScope =
  { readonly kind: 'ALL' } | { readonly kind: 'BRANCHES'; readonly branchIds: readonly string[] };

/** The part of the request user the scope depends on: the token's id and role. */
export type ScopedUser = Pick<RequestUser, 'id' | 'role'>;

/** The branches of a `STAFF` or `MANAGER`, read on every call (never from the token). */
export const STAFF_BRANCH_IDS_SQL = `SELECT branch_id::text AS branch_id
  FROM public.staff_branches
 WHERE user_id = $1
 ORDER BY branch_id`;

/** The requested ids that are branches, soft-deleted or not (an `ADMIN` request). */
export const EXISTING_BRANCH_IDS_SQL = `SELECT id::text AS id
  FROM public.branches
 WHERE id = ANY($1::uuid[])`;

/** One `staff_branches` row, for `assertBranchAccess`. */
export const HAS_STAFF_BRANCH_SQL = `SELECT 1 AS found
  FROM public.staff_branches
 WHERE user_id = $1 AND branch_id = $2`;

const ALL_BRANCHES: BranchScope = Object.freeze({ kind: 'ALL' });

function isStaffOrManager(role: ScopedUser['role']): boolean {
  return role === 'STAFF' || role === 'MANAGER';
}

/** Lower case, first occurrence kept. */
function normalise(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

function branches(branchIds: readonly string[]): BranchScope {
  return Object.freeze({ kind: 'BRANCHES', branchIds: Object.freeze([...branchIds]) });
}

/**
 * Branch scoping (api-outline, Conventions, "Branch scoping"; foundation.md section 5; A3-T5): the
 * one place that turns a staff user into the branches they may see. `staff_branches` is read from
 * the database on every call, so a branch removed from a person takes effect on their next
 * request, whatever their access token says. A branch outside the caller's set answers
 * `404 NOT_FOUND`, never `403 FORBIDDEN`, so nothing tells a branch-B record from a missing one.
 */
@Injectable()
export class BranchScopeService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /**
   * - `ADMIN`: `ALL` without requested ids; otherwise the requested ids, each of which must be a
   *   branch (`NOT_FOUND` otherwise).
   * - `STAFF`, `MANAGER`: their `staff_branches` without requested ids (empty when they have no
   *   row); otherwise the requested ids, each of which must be one of theirs (`NOT_FOUND`).
   * - Any other role: `FORBIDDEN` (the role guard refuses customers on staff routes first).
   *
   * An empty `requested` list counts as no requested ids.
   */
  async resolve(user: ScopedUser, requested?: readonly string[]): Promise<BranchScope> {
    const wanted =
      requested === undefined || requested.length === 0 ? undefined : normalise(requested);

    if (user.role === 'ADMIN') {
      if (wanted === undefined) {
        return ALL_BRANCHES;
      }
      const rows = await this.dataSource.query<{ id: string }[]>(EXISTING_BRANCH_IDS_SQL, [wanted]);
      if (rows.length !== wanted.length) {
        throw new ApiError('NOT_FOUND');
      }
      return branches(wanted);
    }

    if (!isStaffOrManager(user.role)) {
      throw new ApiError('FORBIDDEN');
    }
    const own = await this.staffBranchIds(user.id);
    if (wanted === undefined) {
      return branches(own);
    }
    const ownSet = new Set(own);
    if (wanted.some((id) => !ownSet.has(id))) {
      throw new ApiError('NOT_FOUND');
    }
    return branches(wanted);
  }

  /**
   * For a service that loads a record first (an order, a reservation, a stock row) and must answer
   * `NOT_FOUND` when the record's branch is not the caller's. `ADMIN` passes (the record exists);
   * `STAFF` and `MANAGER` need a `staff_branches` row for `branchId`, read now; any other role is
   * `FORBIDDEN`.
   */
  async assertBranchAccess(user: ScopedUser, branchId: string): Promise<void> {
    if (user.role === 'ADMIN') {
      return;
    }
    if (!isStaffOrManager(user.role)) {
      throw new ApiError('FORBIDDEN');
    }
    const rows = await this.dataSource.query<unknown[]>(HAS_STAFF_BRANCH_SQL, [user.id, branchId]);
    if (rows.length === 0) {
      throw new ApiError('NOT_FOUND');
    }
  }

  private async staffBranchIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ branch_id: string }[]>(STAFF_BRANCH_IDS_SQL, [
      userId,
    ]);
    return rows.map((row) => row.branch_id.toLowerCase());
  }
}
