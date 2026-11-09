import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../realtime/outbox.service.js';
import {
  BRANCH_PAUSE_AUDIT,
  BranchPauseService,
  branchUpdatedEvent,
  pauseTransition,
  unchangedOutcome,
} from './branch-pause.service.js';
import type { BranchStatus } from './entities/branch.entity.js';

// Fictional ids only.
const BRANCH = '01930000-0000-7000-8000-0000000055b1';
const STAFF = '01930000-0000-7000-8000-000000005501';

describe('pauseTransition', () => {
  it('pauses from ACTIVE to TEMPORARILY_CLOSED', () => {
    expect(pauseTransition(true)).toEqual({ from: 'ACTIVE', to: 'TEMPORARILY_CLOSED' });
  });

  it('reopens from TEMPORARILY_CLOSED to ACTIVE', () => {
    expect(pauseTransition(false)).toEqual({ from: 'TEMPORARILY_CLOSED', to: 'ACTIVE' });
  });
});

describe('unchangedOutcome', () => {
  it.each([
    ['TEMPORARILY_CLOSED', true],
    ['ACTIVE', false],
  ] as const)('a %s branch asked paused=%s is UNCHANGED', (status, paused) => {
    expect(unchangedOutcome(status, paused)).toBe('UNCHANGED');
  });

  it.each([true, false])('a CLOSED branch is CLOSED whatever is asked (paused=%s)', (paused) => {
    expect(unchangedOutcome('CLOSED', paused)).toBe('CLOSED');
  });

  it.each([
    ['ACTIVE', true],
    ['TEMPORARILY_CLOSED', false],
  ] as const)('a %s branch that the update missed (paused=%s) RACED', (status, paused) => {
    expect(unchangedOutcome(status, paused)).toBe('RACED');
  });
});

describe('branchUpdatedEvent', () => {
  it('is a PUBLIC signal with the branch id and the new version only', () => {
    expect(branchUpdatedEvent(BRANCH, 7)).toEqual({
      type: 'branch.updated',
      audience: 'PUBLIC',
      entityType: 'branch',
      entityId: BRANCH,
      version: 7,
      payload: { branchId: BRANCH, rowVersion: 7 },
    });
  });

  it('passes the outbox checks (audience scope, no personal data)', async () => {
    const insert = vi.fn(async () => undefined);
    const manager = { insert } as unknown as EntityManager;

    await new OutboxService().add(manager, branchUpdatedEvent(BRANCH, 7));

    expect(insert).toHaveBeenCalledOnce();
  });
});

interface Scripted {
  /** Rows of the conditional update; empty when it matched nothing. */
  readonly changed: readonly Record<string, unknown>[];
  /** Rows of the read after an update that matched nothing. */
  readonly current?: readonly Record<string, unknown>[];
}

function harness(script: Scripted) {
  const query = vi.fn(async (sql: string) =>
    sql.includes('UPDATE public.branches') ? script.changed : (script.current ?? []),
  );
  const em = { query } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(em)),
  } as unknown as DataSource;
  const assertBranchAccess = vi.fn(async () => undefined);
  const scopes = { assertBranchAccess } as unknown as BranchScopeService;
  const write = vi.fn(async () => undefined);
  const audit = { write } as unknown as AuditService;
  const add = vi.fn(async () => undefined);
  const outbox = { add } as unknown as OutboxService;
  return {
    service: new BranchPauseService(dataSource, scopes, audit, outbox),
    query,
    em,
    assertBranchAccess,
    write,
    add,
  };
}

const ACTOR = { id: STAFF, role: 'STAFF' } as const;

function changedRow(status: BranchStatus, rowVersion: number): Record<string, unknown> {
  return { id: BRANCH, code: 'MA', name: 'Chi nhánh Mẫu', status, row_version: rowVersion };
}

describe('BranchPauseService.setPaused', () => {
  it('checks the branch scope before any write', async () => {
    const h = harness({ changed: [] });
    h.assertBranchAccess.mockRejectedValueOnce(new ApiError('NOT_FOUND'));

    await expect(h.service.setPaused(ACTOR, BRANCH, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(h.assertBranchAccess).toHaveBeenCalledWith(ACTOR, BRANCH);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('updates only from the expected status, with the actor as updated_by', async () => {
    const h = harness({ changed: [changedRow('TEMPORARILY_CLOSED', 4)] });

    await h.service.setPaused(ACTOR, BRANCH, true);

    expect(h.query).toHaveBeenCalledOnce();
    const [sql, parameters] = h.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1::uuid AND deleted_at IS NULL AND status = \$2/);
    expect(parameters).toEqual([BRANCH, 'ACTIVE', 'TEMPORARILY_CLOSED', STAFF]);
  });

  it('writes one audit row and one outbox row in the transaction on a change', async () => {
    const h = harness({ changed: [changedRow('TEMPORARILY_CLOSED', 4)] });

    await expect(h.service.setPaused(ACTOR, BRANCH, true)).resolves.toEqual({
      id: BRANCH,
      status: 'TEMPORARILY_CLOSED',
      rowVersion: 4,
    });

    expect(h.write).toHaveBeenCalledOnce();
    expect(h.write).toHaveBeenCalledWith(
      {
        actorUserId: STAFF,
        action: BRANCH_PAUSE_AUDIT,
        entityType: 'BRANCH',
        entityId: BRANCH,
        entityLabel: 'Chi nhánh Mẫu',
        branchId: BRANCH,
        diff: { status: { from: 'ACTIVE', to: 'TEMPORARILY_CLOSED' } },
      },
      h.em,
    );
    expect(h.add).toHaveBeenCalledOnce();
    expect(h.add).toHaveBeenCalledWith(h.em, branchUpdatedEvent(BRANCH, 4));
  });

  it('reopens a paused branch', async () => {
    const h = harness({ changed: [changedRow('ACTIVE', 5)] });

    await expect(h.service.setPaused(ACTOR, BRANCH, false)).resolves.toEqual({
      id: BRANCH,
      status: 'ACTIVE',
      rowVersion: 5,
    });
    expect(h.write).toHaveBeenCalledWith(
      expect.objectContaining({ diff: { status: { from: 'TEMPORARILY_CLOSED', to: 'ACTIVE' } } }),
      h.em,
    );
  });

  it('answers the current branch and writes nothing when it already has the asked state', async () => {
    const h = harness({
      changed: [],
      current: [{ id: BRANCH, status: 'TEMPORARILY_CLOSED', row_version: 4 }],
    });

    await expect(h.service.setPaused(ACTOR, BRANCH, true)).resolves.toEqual({
      id: BRANCH,
      status: 'TEMPORARILY_CLOSED',
      rowVersion: 4,
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.add).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'refuses a CLOSED branch with INVALID_STATE (paused=%s)',
    async (paused) => {
      const h = harness({
        changed: [],
        current: [{ id: BRANCH, status: 'CLOSED', row_version: 2 }],
      });

      const error: unknown = await h.service
        .setPaused(ACTOR, BRANCH, paused)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'INVALID_STATE', status: 409 });
      expect(h.write).not.toHaveBeenCalled();
      expect(h.add).not.toHaveBeenCalled();
    },
  );

  it('answers NOT_FOUND for a missing or soft-deleted branch', async () => {
    const h = harness({ changed: [], current: [] });

    await expect(h.service.setPaused(ACTOR, BRANCH, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(h.write).not.toHaveBeenCalled();
  });
});
