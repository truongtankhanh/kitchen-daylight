import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OutboxService } from '../../src/modules/realtime/outbox.service.js';
import type { OutboxEventRecord } from '../../src/modules/realtime/outbox.service.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppDataSource,
  openAppRole,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0002_outbox_events (A0-T6) and OutboxService, as kd_app. Fictional ids only.
const BRANCH_ID = '01900000-0000-7000-8000-00000000b001';
const USER_ID = '01900000-0000-7000-8000-00000000a001';

const INSERT_SQL = `INSERT INTO public.outbox_events
  (type, entity_type, entity_id, audience, branch_id, audience_user_id)
VALUES ('menu.item_updated', 'MENU_ITEM', 'item-1', $1, $2, $3)
RETURNING id`;

type Scope = readonly [audience: string, branchId: string | null, audienceUserId: string | null];

const VALID_SCOPES: readonly Scope[] = [
  ['PUBLIC', null, null],
  ['ADMIN', null, null],
  ['BRANCH_STAFF', BRANCH_ID, null],
  ['USER', null, USER_ID],
];

const INVALID_SCOPES: readonly Scope[] = [
  ['PUBLIC', BRANCH_ID, null],
  ['PUBLIC', null, USER_ID],
  ['ADMIN', BRANCH_ID, null],
  ['ADMIN', null, USER_ID],
  ['BRANCH_STAFF', null, null],
  ['BRANCH_STAFF', BRANCH_ID, USER_ID],
  ['USER', null, null],
  ['USER', BRANCH_ID, USER_ID],
];

const EVENT: OutboxEventRecord = {
  type: 'menu.item_updated',
  entityType: 'MENU_ITEM',
  entityId: 'item-1',
  version: 2,
  audience: 'BRANCH_STAFF',
  branchId: BRANCH_ID,
  payload: { itemId: 'item-1', available: false },
};

class RollbackProbe extends Error {}

describe('outbox_events (0002_outbox_events)', () => {
  let app: RoleClient;
  let dataSource: DataSource;
  const service = new OutboxService();

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
    // branch_id and audience_user_id reference branches and users since migration 0007.
    await insertIdentityFixtures({ userIds: [USER_ID], branchIds: [BRANCH_ID] });
  });

  async function count(): Promise<number> {
    const rows = await app.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.outbox_events',
    );
    return rows[0]?.count ?? -1;
  }

  it.each(VALID_SCOPES)(
    'accepts audience %s with branch_id %s and audience_user_id %s',
    async (audience, branchId, audienceUserId) => {
      await app.query(INSERT_SQL, [audience, branchId, audienceUserId]);
      expect(await count()).toBe(1);
    },
  );

  it.each(INVALID_SCOPES)(
    'rejects audience %s with branch_id %s and audience_user_id %s',
    async (audience, branchId, audienceUserId) => {
      await expectSqlState(
        app.query(INSERT_SQL, [audience, branchId, audienceUserId]),
        CHECK_VIOLATION,
      );
      expect(await count()).toBe(0);
    },
  );

  it('lets kd_app insert, update (published_at) and delete (the purge)', async () => {
    const [inserted] = await app.query<{ id: string }>(INSERT_SQL, ['PUBLIC', null, null]);
    const id = inserted?.id;
    expect(id).toEqual(expect.any(String));

    const updated = await app.query<{ id: string }>(
      'UPDATE public.outbox_events SET published_at = now() WHERE id = $1 RETURNING id',
      [id],
    );
    expect(updated).toHaveLength(1);

    const deleted = await app.query<{ id: string }>(
      'DELETE FROM public.outbox_events WHERE id = $1 RETURNING id',
      [id],
    );
    expect(deleted).toHaveLength(1);
    expect(await count()).toBe(0);
  });

  it.each([
    ['type', `type = 'menu.item_deleted'`],
    ['audience', `audience = 'PUBLIC', branch_id = NULL`],
    ['branch_id', `branch_id = '01900000-0000-7000-8000-00000000b002'`],
    ['payload', `payload = '{"itemId":"item-2"}'::jsonb`],
    ['created_at', 'created_at = now()'],
  ])('denies kd_app an UPDATE of %s (42501, migration 0005)', async (_column, assignment) => {
    await app.query(INSERT_SQL, ['BRANCH_STAFF', BRANCH_ID, null]);

    await app.expectPermissionDenied(`UPDATE public.outbox_events SET ${assignment}`);

    const rows = await app.query<{ type: string; audience: string; branch_id: string }>(
      'SELECT type, audience::text AS audience, branch_id FROM public.outbox_events',
    );
    expect(rows).toEqual([
      { type: 'menu.item_updated', audience: 'BRANCH_STAFF', branch_id: BRANCH_ID },
    ]);
  });

  it('writes the event with the business transaction when it commits', async () => {
    await dataSource.transaction(async (manager) => {
      await service.add(manager, EVENT);
    });

    const rows = await app.query<Record<string, unknown>>(
      `SELECT type, entity_type, entity_id, version, audience::text AS audience, branch_id,
              audience_user_id, payload, published_at
         FROM public.outbox_events`,
    );
    expect(rows).toEqual([
      {
        type: 'menu.item_updated',
        entity_type: 'MENU_ITEM',
        entity_id: 'item-1',
        version: 2,
        audience: 'BRANCH_STAFF',
        branch_id: BRANCH_ID,
        audience_user_id: null,
        payload: { itemId: 'item-1', available: false },
        published_at: null,
      },
    ]);
  });

  it('leaves no row when the business transaction rolls back', async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await service.add(manager, EVENT);
        throw new RollbackProbe('roll back after the outbox insert');
      }),
    ).rejects.toBeInstanceOf(RollbackProbe);

    expect(await count()).toBe(0);
  });
});
