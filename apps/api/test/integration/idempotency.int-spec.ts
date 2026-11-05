import type { DataSource, EntityManager } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IdempotencyService } from '../../src/common/idempotency/idempotency.service.js';
import type {
  IdempotencyBeginInput,
  IdempotencyOutcome,
  IdempotencyResult,
} from '../../src/common/idempotency/idempotency.service.js';
import { FixedClock } from '../../src/common/time/testing.js';
import { openAppDataSource, openAppRole } from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0004_idempotency_keys and IdempotencyService (A0-T8; decision 0007 section 10), as
// kd_app, with real concurrent transactions. Fictional ids only.
const ACTOR_A = '01900000-0000-7000-8000-00000000a001';
const ACTOR_B = '01900000-0000-7000-8000-00000000a002';
const NOW = '2026-11-05T03:00:00Z';
const DAY_MS = 24 * 3_600_000;

const INPUT: IdempotencyBeginInput = {
  scope: 'orders.create',
  actorId: ACTOR_A,
  key: 'key-0001-abcdef',
  method: 'POST',
  routeTemplate: '/api/v1/orders',
  pathParams: {},
  requestBody: { branchId: 'branch-1', items: [{ menuItemId: 'item-1', quantity: 2 }] },
};

const RESULT: IdempotencyResult = { status: 201, ref: { orderId: 'order-1' } };

class RollbackProbe extends Error {}

/** A promise with its resolver, to hold a transaction open at a chosen point. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('idempotency_keys (0004_idempotency_keys) and IdempotencyService', () => {
  let app: RoleClient;
  let dataSource: DataSource;
  let clock: FixedClock;
  let service: IdempotencyService;

  beforeAll(async () => {
    app = await openAppRole();
    dataSource = await openAppDataSource();
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await truncateAll();
    clock = new FixedClock(NOW);
    service = new IdempotencyService(clock);
  });

  /** One business transaction: begin, then complete when told to proceed. */
  async function attempt(
    manager: EntityManager,
    input: IdempotencyBeginInput = INPUT,
  ): Promise<IdempotencyOutcome> {
    const outcome = await service.begin(manager, input);
    if (outcome.kind === 'proceed') {
      await service.complete(manager, input, RESULT);
    }
    return outcome;
  }

  async function rows(): Promise<{ actor_id: string; request_hash: string; created_at: Date }[]> {
    return app.query(
      'SELECT actor_id, request_hash, created_at FROM public.idempotency_keys ORDER BY actor_id',
    );
  }

  /**
   * Waits until a `kd_app` session of this database waits on a lock: the second `begin` blocked on
   * the unique index by the first, uncommitted insert.
   */
  async function waitForLockWait(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [row] = await app.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND usename = current_user
            AND wait_event_type = 'Lock'`,
      );
      if ((row?.waiting ?? 0) > 0) {
        return;
      }
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('The second begin never waited on the first transaction.');
  }

  it('lets exactly one of two parallel begin calls with one key proceed; the other replays', async () => {
    const firstBegun = deferred();
    const firstMayCommit = deferred();

    const first = dataSource.transaction(async (manager) => {
      const outcome = await service.begin(manager, INPUT);
      firstBegun.resolve();
      await firstMayCommit.promise;
      if (outcome.kind === 'proceed') {
        await service.complete(manager, INPUT, RESULT);
      }
      return outcome;
    });
    await firstBegun.promise;

    const second = dataSource.transaction((manager) => attempt(manager));
    await waitForLockWait();
    firstMayCommit.resolve();

    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['proceed', 'replay']);
    expect(outcomes.find((outcome) => outcome.kind === 'replay')).toEqual({
      kind: 'replay',
      ...RESULT,
    });
    expect(await rows()).toHaveLength(1);
  });

  it('replays a committed key for the same request', async () => {
    await dataSource.transaction((manager) => attempt(manager));

    const replay = await dataSource.transaction((manager) => service.begin(manager, INPUT));

    expect(replay).toEqual({ kind: 'replay', ...RESULT });
  });

  it('raises IDEMPOTENCY_CONFLICT when the key comes back with a different body', async () => {
    await dataSource.transaction((manager) => attempt(manager));

    const different = { ...INPUT, requestBody: { branchId: 'branch-1', items: [] } };
    await expect(
      dataSource.transaction((manager) => service.begin(manager, different)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    expect(await rows()).toHaveLength(1);
  });

  it('lets a retry proceed after the first attempt rolled back', async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await service.begin(manager, INPUT);
        throw new RollbackProbe('the business write failed');
      }),
    ).rejects.toBeInstanceOf(RollbackProbe);
    expect(await rows()).toHaveLength(0);

    const retry = await dataSource.transaction((manager) => attempt(manager));

    expect(retry).toEqual({ kind: 'proceed' });
    expect(await rows()).toHaveLength(1);
  });

  it('lets a waiting duplicate proceed when the first transaction rolls back', async () => {
    const firstBegun = deferred();
    const firstMayEnd = deferred();

    const first = dataSource.transaction(async (manager) => {
      await service.begin(manager, INPUT);
      firstBegun.resolve();
      await firstMayEnd.promise;
      throw new RollbackProbe('the business write failed');
    });
    const firstSettled = first.catch((error: unknown) => error);
    await firstBegun.promise;

    const second = dataSource.transaction((manager) => attempt(manager));
    await waitForLockWait();
    firstMayEnd.resolve();

    expect(await firstSettled).toBeInstanceOf(RollbackProbe);
    expect(await second).toEqual({ kind: 'proceed' });
    expect(await rows()).toHaveLength(1);
  });

  it("keeps another actor's key independent", async () => {
    await dataSource.transaction((manager) => attempt(manager));

    const other = await dataSource.transaction((manager) =>
      attempt(manager, { ...INPUT, actorId: ACTOR_B }),
    );

    expect(other).toEqual({ kind: 'proceed' });
    expect((await rows()).map((row) => row.actor_id)).toEqual([ACTOR_A, ACTOR_B]);
  });

  it('replaces an expired row instead of replaying or rejecting it', async () => {
    await dataSource.transaction((manager) => attempt(manager));
    const [before] = await rows();

    clock.advance(DAY_MS);
    const different = { ...INPUT, requestBody: { branchId: 'branch-2', items: [] } };
    const outcome = await dataSource.transaction((manager) => attempt(manager, different));

    expect(outcome).toEqual({ kind: 'proceed' });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]?.request_hash).not.toBe(before?.request_hash);
    expect(after[0]?.created_at.getTime()).toBe(new Date(NOW).getTime() + DAY_MS);
  });

  it('lets kd_app delete expired rows only (deleteExpired)', async () => {
    await dataSource.transaction((manager) => attempt(manager));
    clock.advance(DAY_MS / 2);
    await dataSource.transaction((manager) => attempt(manager, { ...INPUT, actorId: ACTOR_B }));

    clock.set(new Date(new Date(NOW).getTime() + DAY_MS));
    const deleted = await service.deleteExpired(dataSource.manager);

    expect(deleted).toBe(1);
    expect((await rows()).map((row) => row.actor_id)).toEqual([ACTOR_B]);
  });
});
