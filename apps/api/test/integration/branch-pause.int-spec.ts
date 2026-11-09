import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUSINESS_TIME_ZONE } from '../../src/common/time/vietnam-time.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { BranchStatus } from '../../src/modules/branches/entities/branch.entity.js';
import { getOpenState, getServiceState } from '../../src/modules/branches/hours/open-state.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A5-T5, `POST /admin/branches/{id}/pause` (testing-strategy "Pause switch", the part this task
// owns): `STAFF` flips `ACTIVE` ↔ `TEMPORARILY_CLOSED`, never a `CLOSED` branch (`INVALID_STATE`
// for every role), `404` outside the caller's branches, one `branch.pause` audit row and one
// `branch.updated` outbox row per change and none for a repeat call, two concurrent calls change
// the row once, and a paused branch reads `TEMPORARILY_CLOSED` / `PAUSED` in the A5-T3 calculator.
// `BRANCH_CLOSED` at order time is A8. As `kd_app` against real PostgreSQL. Fictional data only.

const ADMIN_ID = '01930000-0000-7000-8000-000000005501';
const MANAGER_A_ID = '01930000-0000-7000-8000-000000005502';
const STAFF_A_ID = '01930000-0000-7000-8000-000000005503';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000005504';
const SESSION_ID = '01930000-0000-7000-8000-0000000055a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000055b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000055b2';
/** In the staff member's list, set to `CLOSED` before every test. */
const BRANCH_CLOSED = '01930000-0000-7000-8000-0000000055b3';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-0000000055bf';

const PAUSE_MESSAGE = 'Tạm nghỉ ít phút';

function pausePath(branchId: string): string {
  return `/api/v1/admin/branches/${branchId}/pause`;
}

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

const BRANCH_ROW_SQL = `SELECT status::text AS status, row_version, updated_at,
  updated_by::text AS updated_by, pause_message, accepts_pickup, accepts_delivery,
  accepts_reservations, order_cutoff_minutes
  FROM public.branches WHERE id = $1`;

interface BranchRow {
  status: BranchStatus;
  row_version: number;
  updated_at: Date;
  updated_by: string | null;
  pause_message: string | null;
  accepts_pickup: boolean;
  accepts_delivery: boolean;
  accepts_reservations: boolean;
  order_cutoff_minutes: number;
}

interface PauseBody {
  id: string;
  status: BranchStatus;
  rowVersion: number;
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  branch_id: string | null;
  actor_user_id: string | null;
  diff: unknown;
}

interface OutboxRow {
  type: string;
  entity_type: string;
  entity_id: string;
  version: number | null;
  audience: string;
  branch_id: string | null;
  audience_user_id: string | null;
  payload: unknown;
}

describe('admin branch pause (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B, BRANCH_CLOSED] });
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
    await insertUser(ADMIN_ID, 'ADMIN', 'Quản trị Mẫu');
    await insertUser(MANAGER_A_ID, 'MANAGER', 'Quản lý Mẫu');
    await insertUser(STAFF_A_ID, 'STAFF', 'Nhân viên Mẫu');
    await insertUser(CUSTOMER_ID, 'CUSTOMER', 'Khách Mẫu');
    await query(
      `INSERT INTO public.staff_branches (user_id, branch_id)
       VALUES ($1, $2), ($3, $2), ($3, $4)`,
      [MANAGER_A_ID, BRANCH_A, STAFF_A_ID, BRANCH_CLOSED],
    );
    await query(`UPDATE public.branches SET status = 'CLOSED' WHERE id = $1`, [BRANCH_CLOSED]);
    await query('UPDATE public.branches SET pause_message = $2 WHERE id = $1', [
      BRANCH_A,
      PAUSE_MESSAGE,
    ]);
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(id: string, role: UserRole, displayName: string): Promise<unknown> {
    return query(INSERT_USER_SQL, [
      id,
      `fixture-pause-${id.slice(-4)}@kd.example`,
      displayName,
      role,
    ]);
  }

  async function headersOf(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  const asStaffA = () => headersOf(STAFF_A_ID, 'STAFF');
  const asManagerA = () => headersOf(MANAGER_A_ID, 'MANAGER');
  const asAdmin = () => headersOf(ADMIN_ID, 'ADMIN');

  async function pause(
    branchId: string,
    paused: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.post(pausePath(branchId), paused === undefined ? {} : { paused }, {
      headers: headers ?? (await asStaffA()),
    });
  }

  async function branchRow(branchId: string): Promise<BranchRow> {
    const rows = await query<BranchRow>(BRANCH_ROW_SQL, [branchId]);
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture branch missing');
    }
    return row;
  }

  function auditRows(): Promise<AuditRow[]> {
    return query<AuditRow>(
      `SELECT action, entity_type::text AS entity_type, entity_id, entity_label,
              branch_id::text AS branch_id, actor_user_id::text AS actor_user_id, diff
         FROM public.audit_logs WHERE action = 'branch.pause' ORDER BY created_at, id`,
    );
  }

  function outboxRows(): Promise<OutboxRow[]> {
    return query<OutboxRow>(
      `SELECT type, entity_type, entity_id, version, audience::text AS audience,
              branch_id::text AS branch_id, audience_user_id::text AS audience_user_id, payload
         FROM public.outbox_events WHERE type = 'branch.updated' ORDER BY created_at, id`,
    );
  }

  describe('a STAFF of the branch', () => {
    it('pauses an ACTIVE branch: status, updated_by, one audit row, one outbox row', async () => {
      const before = await branchRow(BRANCH_A);

      const response = await pause(BRANCH_A, true);

      expect(response.status).toBe(200);
      const body = response.body as PauseBody;
      expect(body).toEqual({
        id: BRANCH_A,
        status: 'TEMPORARILY_CLOSED',
        rowVersion: expect.any(Number) as number,
      });
      expect(body.rowVersion).toBeGreaterThan(before.row_version);

      const after = await branchRow(BRANCH_A);
      expect(after.status).toBe('TEMPORARILY_CLOSED');
      expect(after.row_version).toBe(body.rowVersion);
      expect(after.updated_by).toBe(STAFF_A_ID);
      expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
      expect(after.pause_message).toBe(PAUSE_MESSAGE);

      expect(await auditRows()).toEqual([
        {
          action: 'branch.pause',
          entity_type: 'BRANCH',
          entity_id: BRANCH_A,
          entity_label: 'Chi nhánh mẫu',
          branch_id: BRANCH_A,
          actor_user_id: STAFF_A_ID,
          diff: { status: { from: 'ACTIVE', to: 'TEMPORARILY_CLOSED' } },
        },
      ]);
      expect(await outboxRows()).toEqual([
        {
          type: 'branch.updated',
          entity_type: 'branch',
          entity_id: BRANCH_A,
          version: body.rowVersion,
          audience: 'PUBLIC',
          branch_id: null,
          audience_user_id: null,
          payload: { branchId: BRANCH_A, rowVersion: body.rowVersion },
        },
      ]);
    });

    it('reopens a paused branch with a second audit row and outbox row', async () => {
      expect((await pause(BRANCH_A, true)).status).toBe(200);

      const response = await pause(BRANCH_A, false);

      expect(response.status).toBe(200);
      const body = response.body as PauseBody;
      expect(body.status).toBe('ACTIVE');
      expect((await branchRow(BRANCH_A)).status).toBe('ACTIVE');
      const audits = await auditRows();
      expect(audits).toHaveLength(2);
      expect(audits[1]?.diff).toEqual({ status: { from: 'TEMPORARILY_CLOSED', to: 'ACTIVE' } });
      const events = await outboxRows();
      expect(events).toHaveLength(2);
      expect(events[1]?.payload).toEqual({ branchId: BRANCH_A, rowVersion: body.rowVersion });
    });

    it('answers 200 with the current branch and writes nothing on a repeat call', async () => {
      const first = (await pause(BRANCH_A, true)).body as PauseBody;
      const versionAfterFirst = (await branchRow(BRANCH_A)).row_version;

      const repeat = await pause(BRANCH_A, true);

      expect(repeat.status).toBe(200);
      expect(repeat.body).toEqual(first);
      expect((await branchRow(BRANCH_A)).row_version).toBe(versionAfterFirst);
      expect(await auditRows()).toHaveLength(1);
      expect(await outboxRows()).toHaveLength(1);
    });

    it('answers 200 and writes nothing when reopening an ACTIVE branch', async () => {
      const before = await branchRow(BRANCH_A);

      const response = await pause(BRANCH_A, false);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: BRANCH_A,
        status: 'ACTIVE',
        rowVersion: before.row_version,
      });
      expect(await auditRows()).toHaveLength(0);
      expect(await outboxRows()).toHaveLength(0);
    });

    it.each([true, false])(
      'cannot touch a CLOSED branch (paused=%s): 409 INVALID_STATE, nothing written',
      async (paused) => {
        const before = await branchRow(BRANCH_CLOSED);

        const response = await pause(BRANCH_CLOSED, paused);

        expect(response.status).toBe(409);
        expect(response.problem?.code).toBe('INVALID_STATE');
        const after = await branchRow(BRANCH_CLOSED);
        expect(after.status).toBe('CLOSED');
        expect(after.row_version).toBe(before.row_version);
        expect(await auditRows()).toHaveLength(0);
        expect(await outboxRows()).toHaveLength(0);
      },
    );

    it('gets 404 for a branch outside their list and for an unknown id', async () => {
      for (const branchId of [BRANCH_B, UNKNOWN_BRANCH]) {
        const response = await pause(branchId, true);
        expect(response.status).toBe(404);
        expect(response.problem?.code).toBe('NOT_FOUND');
      }
      expect((await branchRow(BRANCH_B)).status).toBe('ACTIVE');
      expect(await auditRows()).toHaveLength(0);
    });

    it('changes the row once when two calls race', async () => {
      const headers = await asStaffA();

      const responses = await Promise.all([
        pause(BRANCH_A, true, headers),
        pause(BRANCH_A, true, headers),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses.map((response) => (response.body as PauseBody).status)).toEqual([
        'TEMPORARILY_CLOSED',
        'TEMPORARILY_CLOSED',
      ]);
      expect(await auditRows()).toHaveLength(1);
      expect(await outboxRows()).toHaveLength(1);
    });
  });

  describe('other callers', () => {
    it('lets a MANAGER pause their branch and gives 404 for another one', async () => {
      const headers = await asManagerA();

      expect((await pause(BRANCH_A, true, headers)).status).toBe(200);
      expect((await pause(BRANCH_B, true, headers)).status).toBe(404);
    });

    it('lets an ADMIN pause any branch, but not a CLOSED one', async () => {
      const headers = await asAdmin();

      expect((await pause(BRANCH_B, true, headers)).status).toBe(200);
      const closed = await pause(BRANCH_CLOSED, false, headers);
      expect(closed.status).toBe(409);
      expect(closed.problem?.code).toBe('INVALID_STATE');
      expect((await pause(UNKNOWN_BRANCH, true, headers)).status).toBe(404);
    });

    it('refuses a customer with 403 and a request without a token with 401', async () => {
      const asCustomer = await headersOf(CUSTOMER_ID, 'CUSTOMER');

      expect((await pause(BRANCH_A, true, asCustomer)).status).toBe(403);
      const anonymous = await client.post(pausePath(BRANCH_A), { paused: true });
      expect(anonymous.status).toBe(401);
      expect((await branchRow(BRANCH_A)).status).toBe('ACTIVE');
    });

    it.each([
      ['no paused', undefined],
      ['a string', 'yes'],
    ])('answers 400 VALIDATION_FAILED for %s', async (_label, paused) => {
      const response = await pause(BRANCH_A, paused);

      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a reason in the body (brief A25 is open)', async () => {
      const response = await client.post(
        pausePath(BRANCH_A),
        { paused: true, reason: 'Hết nguyên liệu' },
        { headers: await asStaffA() },
      );

      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('the A5-T3 calculator', () => {
    it('reads a paused branch as TEMPORARILY_CLOSED with reason PAUSED', async () => {
      expect((await pause(BRANCH_A, true)).status).toBe(200);
      const row = await branchRow(BRANCH_A);
      const input = {
        timeZone: BUSINESS_TIME_ZONE,
        periods: [],
        specialDays: [],
        status: row.status,
        acceptsPickup: row.accepts_pickup,
        acceptsDelivery: row.accepts_delivery,
        acceptsReservations: row.accepts_reservations,
        orderCutoffMinutes: row.order_cutoff_minutes,
      };
      const now = new Date();

      expect(getOpenState(input, now).state).toBe('TEMPORARILY_CLOSED');
      expect(getServiceState(input, now, 'STORE').reason).toBe('PAUSED');
      expect(getServiceState(input, now, 'DELIVERY').reason).toBe('PAUSED');
    });
  });
});
