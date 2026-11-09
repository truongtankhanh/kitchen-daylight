import { Inject, Injectable } from '@nestjs/common';
import { outboxEvent } from '@kd/contracts';
import { DataSource } from 'typeorm';

import { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import type { ScopedUser } from '../../common/branch-scope/branch-scope.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../realtime/outbox.service.js';
import { branchAuditLabel } from './branches.service.js';
import type { BranchStatus } from './entities/branch.entity.js';

/** Audit code of the pause switch (catalogue in `@kd/contracts`; brief G7, A25). */
export const BRANCH_PAUSE_AUDIT = 'branch.pause';

/** `outbox_events.entity_type` of `branch.updated`, in the lower case of the other outbox rows. */
export const BRANCH_UPDATED_ENTITY_TYPE = 'branch';

/** `{ id, status, rowVersion }`, the answer of the pause route. */
export interface BranchPauseView {
  readonly id: string;
  readonly status: BranchStatus;
  readonly rowVersion: number;
}

/** The only two moves of the switch: `ACTIVE` ↔ `TEMPORARILY_CLOSED` (data-model `branches`). */
export function pauseTransition(paused: boolean): {
  readonly from: BranchStatus;
  readonly to: BranchStatus;
} {
  return paused
    ? { from: 'ACTIVE', to: 'TEMPORARILY_CLOSED' }
    : { from: 'TEMPORARILY_CLOSED', to: 'ACTIVE' };
}

/**
 * What a call that updated no row means, from the status read after it:
 * - `UNCHANGED`: the branch already has the asked state (answer it, write nothing);
 * - `CLOSED`: only `PATCH` by a manager or an admin changes a `CLOSED` branch (`INVALID_STATE`);
 * - `RACED`: the status left the expected value and came back between the update and the read
 *   (two other writers in that instant); the caller retries.
 */
export function unchangedOutcome(
  current: BranchStatus,
  paused: boolean,
): 'UNCHANGED' | 'CLOSED' | 'RACED' {
  if (current === 'CLOSED') {
    return 'CLOSED';
  }
  return current === pauseTransition(paused).to ? 'UNCHANGED' : 'RACED';
}

/** The `branch.updated` signal of a changed branch: ids and version only (ADR-0007). */
export function branchUpdatedEvent(branchId: string, rowVersion: number) {
  return outboxEvent({
    type: 'branch.updated',
    audience: 'PUBLIC',
    entityType: BRANCH_UPDATED_ENTITY_TYPE,
    entityId: branchId,
    version: rowVersion,
    payload: { branchId, rowVersion },
  });
}

/**
 * One conditional update: it changes the row only while `status` is the expected one, so two
 * people pressing the switch at once cannot both move it (the second one's `UPDATE` waits for the
 * first, then finds the new status and matches nothing). `updated_by` is the token's user; the
 * triggers of migration 0007 raise `row_version` and set `updated_at`. In a CTE so `query()`
 * returns rows (see `SOFT_DELETE_SQL` in `branches.service.ts`).
 */
const PAUSE_SQL = `WITH changed AS (
  UPDATE public.branches
     SET status = $3::public.branch_status, updated_by = $4::uuid
   WHERE id = $1::uuid AND deleted_at IS NULL AND status = $2::public.branch_status
  RETURNING id::text AS id, code, name, status::text AS status, row_version)
SELECT id, code, name, status, row_version FROM changed`;

/** The live branch after an update that matched nothing. */
const CURRENT_SQL = `SELECT id::text AS id, status::text AS status, row_version
  FROM public.branches
 WHERE id = $1::uuid AND deleted_at IS NULL`;

interface ChangedRecord {
  id: string;
  code: string;
  name: string;
  status: BranchStatus;
  row_version: number;
}

interface CurrentRecord {
  id: string;
  status: BranchStatus;
  row_version: number;
}

/**
 * `POST /admin/branches/{id}/pause` (api-outline "Branches"; data-model `branches`; A5-T5): the
 * staff "pause orders" switch. Scoped here through `BranchScopeService` as the other branch routes
 * (api-divergences D-132): `STAFF` and `MANAGER` on their own branches, `ADMIN` on every branch,
 * `404` otherwise. A change writes one `branch.pause` audit row and one `branch.updated` outbox
 * row in its transaction; a call that changes nothing writes neither. Orders are never read: a
 * pause leaves orders in progress as they are.
 */
@Injectable()
export class BranchPauseService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async setPaused(actor: ScopedUser, branchId: string, paused: boolean): Promise<BranchPauseView> {
    await this.scopes.assertBranchAccess(actor, branchId);
    const { from, to } = pauseTransition(paused);

    return this.dataSource.transaction(async (em) => {
      const changed: ChangedRecord[] = await em.query(PAUSE_SQL, [branchId, from, to, actor.id]);
      const branch = changed[0];
      if (branch !== undefined) {
        await this.audit.write(
          {
            actorUserId: actor.id,
            action: BRANCH_PAUSE_AUDIT,
            entityType: 'BRANCH',
            entityId: branch.id,
            entityLabel: branchAuditLabel(branch.name, branch.code),
            branchId: branch.id,
            diff: { status: { from, to } },
          },
          em,
        );
        await this.outbox.add(em, branchUpdatedEvent(branch.id, branch.row_version));
        return { id: branch.id, status: branch.status, rowVersion: branch.row_version };
      }

      const rows: CurrentRecord[] = await em.query(CURRENT_SQL, [branchId]);
      const current = rows[0];
      if (current === undefined) {
        throw new ApiError('NOT_FOUND');
      }
      switch (unchangedOutcome(current.status, paused)) {
        case 'UNCHANGED':
          return { id: current.id, status: current.status, rowVersion: current.row_version };
        case 'CLOSED':
          throw new ApiError('INVALID_STATE', {
            detail: 'A closed branch cannot be paused or reopened here.',
          });
        case 'RACED':
          throw new ApiError('INVALID_STATE', {
            detail: 'The branch status changed meanwhile; try again.',
          });
      }
    });
  }
}
