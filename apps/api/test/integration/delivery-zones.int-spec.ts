import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NO_ACTIVE_WORK, ORDERS_FACTS } from '../../src/common/orders-facts/orders-facts.port.js';
import type { OrdersFacts } from '../../src/common/orders-facts/orders-facts.port.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A5-T4, `/admin/branches/{id}/delivery-zones` and the zone check (testing-strategy "Delivery"
// ring cases and "Branches, menu and search" zone constraints): rings of 500, 1000 and 2000 m
// around the fixture branch pin, points about 400, 900 and 1900 m away, the boundary one metre
// either side of the SQL-computed distance, beyond the outermost ring, an inactive inner ring;
// RADIUS_ORDER, LAST_ACTIVE_ZONE, IN_USE (ORDERS_FACTS replaced by a fake), field codes, audit
// rows and the branch `row_version`, STALE_VERSION, 404 outside a manager's branches, STAFF on the
// check only. Points are computed by PostGIS (`ST_Project`), so the test does not depend on a
// local geodesy formula. As `kd_app` against real PostgreSQL and PostGIS. Fictional data only.

const ADMIN_ID = '01930000-0000-7000-8000-000000005401';
const MANAGER_A_ID = '01930000-0000-7000-8000-000000005402';
const STAFF_A_ID = '01930000-0000-7000-8000-000000005403';
const SESSION_ID = '01930000-0000-7000-8000-0000000054a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000054b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000054b2';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-0000000054bf';
const UNKNOWN_ZONE = '01930000-0000-7000-8000-0000000054cf';

const MANAGER_A_NAME = 'Quản lý Vùng Mẫu';

const BRANCHES = '/api/v1/admin/branches';

function zonesPath(branchId: string, suffix = ''): string {
  return `${BRANCHES}/${branchId}/delivery-zones${suffix}`;
}

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

/** A point `distanceM` metres from the branch pin along `azimuthDeg` (geodesic, PostGIS). */
const PROJECT_SQL = `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng
  FROM (SELECT ST_Project(location, $2::double precision, radians($3::double precision)) AS p
          FROM public.branches WHERE id = $1) t`;

/** The distance the service compares with `radius_m`, computed the same way. */
const DISTANCE_SQL = `SELECT ST_Distance(location,
  ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326)::geography) AS d
  FROM public.branches WHERE id = $1`;

interface Point {
  lat: number;
  lng: number;
}

interface Zone {
  id: string;
  name: string;
  radiusM: number;
  fee: number;
  minOrder: number;
  freeOver: number | null;
  etaMinutes: number;
  isActive: boolean;
  rowVersion: number;
  updatedAt: string;
}

interface CheckBody {
  distanceM: number;
  zone: Zone | null;
  outOfZone: boolean;
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  branch_id: string | null;
  actor_user_id: string | null;
  diff: Record<string, { from: unknown; to: unknown }>;
}

/** What the fake `ORDERS_FACTS` answers for `zoneUsage`; reset before every test. */
const zoneUsage = new Map<string, number>();

const fakeOrdersFacts: OrdersFacts = {
  branchHasAnyOrder: () => Promise.resolve(false),
  branchActiveWork: () => Promise.resolve(NO_ACTIVE_WORK),
  branchTodayStats: () => Promise.resolve(new Map()),
  zoneUsage: (zoneId) => Promise.resolve(zoneUsage.get(zoneId) ?? 0),
  menuItemActiveOrders: () => Promise.resolve(0),
  orderNumbers: () => Promise.resolve(new Map()),
};

function zoneBody(
  radiusM: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: `Vòng ${radiusM} m`,
    radiusM,
    fee: 10_000 + radiusM * 5,
    minOrder: 50_000,
    freeOver: 300_000,
    etaMinutes: 20 + Math.round(radiusM / 100),
    isActive: true,
    ...overrides,
  };
}

describe('admin delivery zones (kd_app, real PostgreSQL and PostGIS)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeEach(async () => {
    zoneUsage.clear();
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B] });
    testApp = await createTestApp({
      providers: [{ provide: ORDERS_FACTS, useValue: fakeOrdersFacts }],
    });
    client = http(testApp.baseUrl);
    await insertUser(ADMIN_ID, 'ADMIN', 'Quản trị Vùng Mẫu');
    await insertUser(MANAGER_A_ID, 'MANAGER', MANAGER_A_NAME);
    await insertUser(STAFF_A_ID, 'STAFF', 'Nhân viên Vùng Mẫu');
    await query(
      'INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2), ($3, $2)',
      [MANAGER_A_ID, BRANCH_A, STAFF_A_ID],
    );
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
      `fixture-zones-${id.slice(-4)}@kd.example`,
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

  function asAdmin(): Promise<Record<string, string>> {
    return headersOf(ADMIN_ID, 'ADMIN');
  }

  function asManagerA(): Promise<Record<string, string>> {
    return headersOf(MANAGER_A_ID, 'MANAGER');
  }

  function asStaffA(): Promise<Record<string, string>> {
    return headersOf(STAFF_A_ID, 'STAFF');
  }

  async function list(branchId: string, headers?: Record<string, string>): Promise<TestResponse> {
    return client.get(zonesPath(branchId), { headers: headers ?? (await asManagerA()) });
  }

  async function create(
    branchId: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.post(zonesPath(branchId), body, { headers: headers ?? (await asManagerA()) });
  }

  async function createZone(
    branchId: string,
    radiusM: number,
    headers?: Record<string, string>,
  ): Promise<Zone> {
    const response = await create(branchId, zoneBody(radiusM), headers);
    expect(response.status).toBe(201);
    return response.body as Zone;
  }

  async function patch(
    branchId: string,
    zoneId: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.request(zonesPath(branchId, `/${zoneId}`), {
      method: 'PATCH',
      body,
      headers: headers ?? (await asManagerA()),
    });
  }

  async function remove(
    branchId: string,
    zoneId: string,
    rowVersion: number,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.request(zonesPath(branchId, `/${zoneId}?rowVersion=${rowVersion}`), {
      method: 'DELETE',
      headers: headers ?? (await asManagerA()),
    });
  }

  async function check(
    branchId: string,
    location: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.post(
      zonesPath(branchId, '/check'),
      { location },
      { headers: headers ?? (await asStaffA()) },
    );
  }

  async function checkBody(branchId: string, location: Point): Promise<CheckBody> {
    const response = await check(branchId, location);
    expect(response.status).toBe(200);
    return response.body as CheckBody;
  }

  async function pointAt(branchId: string, distanceM: number, azimuthDeg = 90): Promise<Point> {
    const rows = await query<Point>(PROJECT_SQL, [branchId, distanceM, azimuthDeg]);
    const point = rows[0];
    if (point === undefined) {
      throw new Error('pointAt: no branch');
    }
    return point;
  }

  async function sqlDistance(branchId: string, point: Point): Promise<number> {
    const rows = await query<{ d: number }>(DISTANCE_SQL, [branchId, point.lng, point.lat]);
    return rows[0]?.d ?? Number.NaN;
  }

  /** The three rings of branch A, created in order as manager A. */
  async function threeRings(): Promise<{ inner: Zone; middle: Zone; outer: Zone }> {
    const inner = await createZone(BRANCH_A, 500);
    const middle = await createZone(BRANCH_A, 1000);
    const outer = await createZone(BRANCH_A, 2000);
    return { inner, middle, outer };
  }

  function setAcceptsDelivery(branchId: string, value: boolean): Promise<unknown> {
    return query('UPDATE public.branches SET accepts_delivery = $2 WHERE id = $1', [
      branchId,
      value,
    ]);
  }

  async function branchState(
    branchId: string,
  ): Promise<{ row_version: number; updated_by: string | null }> {
    const rows = await query<{ row_version: number; updated_by: string | null }>(
      'SELECT row_version, updated_by::text AS updated_by FROM public.branches WHERE id = $1',
      [branchId],
    );
    const state = rows[0];
    if (state === undefined) {
      throw new Error('branchState: no branch');
    }
    return state;
  }

  function auditRows(action?: string): Promise<AuditRow[]> {
    return query<AuditRow>(
      `SELECT action, entity_type::text AS entity_type, entity_id, entity_label,
              branch_id::text AS branch_id, actor_user_id::text AS actor_user_id, diff
         FROM public.audit_logs
        WHERE $1::text IS NULL OR action = $1
        ORDER BY created_at, id`,
      [action ?? null],
    );
  }

  function fieldErrorsOf(response: TestResponse): { field: string; code: string }[] {
    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
    return (response.problem?.errors ?? []).map(({ field, code }) => ({ field, code }));
  }

  // -------------------------------------------------------------------------------------------
  // CRUD and the list
  // -------------------------------------------------------------------------------------------

  describe('list, create, update and delete', () => {
    it('lists every ring, active or not, by radius, with total', async () => {
      const empty = await list(BRANCH_A);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ items: [], total: 0 });

      const { inner, middle, outer } = await threeRings();
      expect(inner).toMatchObject({
        name: 'Vòng 500 m',
        radiusM: 500,
        fee: 12_500,
        minOrder: 50_000,
        freeOver: 300_000,
        etaMinutes: 25,
        isActive: true,
        rowVersion: 1,
      });
      const off = await patch(BRANCH_A, middle.id, { rowVersion: 1, isActive: false });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ isActive: false, rowVersion: 2 });

      const response = await list(BRANCH_A);
      expect(response.status).toBe(200);
      const body = response.body as { items: Zone[]; total: number };
      expect(body.total).toBe(3);
      expect(body.items.map((zone) => [zone.id, zone.radiusM, zone.isActive])).toEqual([
        [inner.id, 500, true],
        [middle.id, 1000, false],
        [outer.id, 2000, true],
      ]);
    });

    it('updates the fields sent, clears freeOver with null, and deletes with rowVersion', async () => {
      const { middle } = await threeRings();
      const updated = await patch(BRANCH_A, middle.id, {
        rowVersion: middle.rowVersion,
        name: '  Vòng giữa  ',
        fee: 18_000,
        freeOver: null,
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        id: middle.id,
        name: 'Vòng giữa',
        radiusM: 1000,
        fee: 18_000,
        minOrder: 50_000,
        freeOver: null,
        rowVersion: middle.rowVersion + 1,
      });

      const deleted = await remove(BRANCH_A, middle.id, middle.rowVersion + 1);
      expect(deleted.status).toBe(204);
      const after = (await list(BRANCH_A)).body as { items: Zone[]; total: number };
      expect(after.items.map((zone) => zone.radiusM)).toEqual([500, 2000]);
    });

    it('answers the field codes of the catalogue', async () => {
      await createZone(BRANCH_A, 500);
      const missing = await create(BRANCH_A, { radiusM: 900 });
      expect(fieldErrorsOf(missing)).toEqual(
        expect.arrayContaining([
          { field: 'name', code: 'REQUIRED' },
          { field: 'fee', code: 'REQUIRED' },
          { field: 'minOrder', code: 'REQUIRED' },
          { field: 'etaMinutes', code: 'REQUIRED' },
          { field: 'isActive', code: 'REQUIRED' },
        ]),
      );

      const invalid = await create(
        BRANCH_A,
        zoneBody(900, { name: 'x'.repeat(101), fee: -1, minOrder: -1, etaMinutes: 0 }),
      );
      expect(fieldErrorsOf(invalid)).toEqual(
        expect.arrayContaining([
          { field: 'name', code: 'TOO_LONG' },
          { field: 'fee', code: 'OUT_OF_RANGE' },
          { field: 'minOrder', code: 'OUT_OF_RANGE' },
          { field: 'etaMinutes', code: 'OUT_OF_RANGE' },
        ]),
      );

      expect(fieldErrorsOf(await create(BRANCH_A, zoneBody(0)))).toEqual([
        { field: 'radiusM', code: 'OUT_OF_RANGE' },
      ]);
      expect(fieldErrorsOf(await create(BRANCH_A, zoneBody(900, { name: '   ' })))).toEqual([
        { field: 'name', code: 'REQUIRED' },
      ]);
      expect(
        fieldErrorsOf(
          await create(BRANCH_A, zoneBody(900, { minOrder: 80_000, freeOver: 80_000 })),
        ),
      ).toEqual([{ field: 'freeOver', code: 'OUT_OF_RANGE' }]);
    });

    it('checks freeOver against the resulting minOrder on PATCH', async () => {
      const inner = await createZone(BRANCH_A, 500);
      const response = await patch(BRANCH_A, inner.id, {
        rowVersion: inner.rowVersion,
        minOrder: 300_000,
      });
      expect(fieldErrorsOf(response)).toEqual([{ field: 'freeOver', code: 'OUT_OF_RANGE' }]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // RADIUS_ORDER (brief C19)
  // -------------------------------------------------------------------------------------------

  describe('RADIUS_ORDER', () => {
    it('refuses a new ring that is not larger than the outermost, or equal to it', async () => {
      await threeRings();
      expect(fieldErrorsOf(await create(BRANCH_A, zoneBody(800)))).toEqual([
        { field: 'radiusM', code: 'RADIUS_ORDER' },
      ]);
      expect(fieldErrorsOf(await create(BRANCH_A, zoneBody(2000)))).toEqual([
        { field: 'radiusM', code: 'RADIUS_ORDER' },
      ]);
      expect((await create(BRANCH_A, zoneBody(2001))).status).toBe(201);
    });

    it('counts an inactive outermost ring', async () => {
      const { outer } = await threeRings();
      expect((await patch(BRANCH_A, outer.id, { rowVersion: 1, isActive: false })).status).toBe(
        200,
      );
      expect(fieldErrorsOf(await create(BRANCH_A, zoneBody(1500)))).toEqual([
        { field: 'radiusM', code: 'RADIUS_ORDER' },
      ]);
      expect(fieldErrorsOf(await create(BRANCH_A, zoneBody(2000, { isActive: false })))).toEqual([
        { field: 'radiusM', code: 'RADIUS_ORDER' },
      ]);
    });

    it('keeps an edited ring strictly between its neighbours, inactive ones included', async () => {
      const { inner, middle } = await threeRings();
      for (const radiusM of [500, 2000, 2500, 300]) {
        expect(fieldErrorsOf(await patch(BRANCH_A, middle.id, { rowVersion: 1, radiusM }))).toEqual(
          [{ field: 'radiusM', code: 'RADIUS_ORDER' }],
        );
      }
      expect((await patch(BRANCH_A, middle.id, { rowVersion: 1, isActive: false })).status).toBe(
        200,
      );
      expect(
        fieldErrorsOf(await patch(BRANCH_A, inner.id, { rowVersion: 1, radiusM: 1200 })),
      ).toEqual([{ field: 'radiusM', code: 'RADIUS_ORDER' }]);

      const moved = await patch(BRANCH_A, middle.id, { rowVersion: 2, radiusM: 1500 });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ radiusM: 1500, rowVersion: 3 });
    });
  });

  // -------------------------------------------------------------------------------------------
  // LAST_ACTIVE_ZONE (brief C21) and IN_USE (brief C22)
  // -------------------------------------------------------------------------------------------

  describe('LAST_ACTIVE_ZONE and IN_USE', () => {
    it('refuses switching off or deleting the last active zone of a delivering branch', async () => {
      const inner = await createZone(BRANCH_A, 500);
      const outer = await createZone(BRANCH_A, 2000);
      expect((await patch(BRANCH_A, outer.id, { rowVersion: 1, isActive: false })).status).toBe(
        200,
      );
      await setAcceptsDelivery(BRANCH_A, true);

      expect(
        fieldErrorsOf(await patch(BRANCH_A, inner.id, { rowVersion: 1, isActive: false })),
      ).toEqual([{ field: 'isActive', code: 'LAST_ACTIVE_ZONE' }]);
      expect(fieldErrorsOf(await remove(BRANCH_A, inner.id, 1))).toEqual([
        { field: 'id', code: 'LAST_ACTIVE_ZONE' },
      ]);
      // The inactive ring can still be deleted.
      expect((await remove(BRANCH_A, outer.id, 2)).status).toBe(204);
    });

    it('allows it while another zone is active, or when the branch does not deliver', async () => {
      const inner = await createZone(BRANCH_A, 500);
      const outer = await createZone(BRANCH_A, 2000);
      await setAcceptsDelivery(BRANCH_A, true);
      expect((await patch(BRANCH_A, inner.id, { rowVersion: 1, isActive: false })).status).toBe(
        200,
      );

      await setAcceptsDelivery(BRANCH_A, false);
      expect((await remove(BRANCH_A, outer.id, 1)).status).toBe(204);
    });

    it('refuses deleting a zone that orders reference with IN_USE and usage', async () => {
      const inner = await createZone(BRANCH_A, 500);
      zoneUsage.set(inner.id, 4);
      const response = await remove(BRANCH_A, inner.id, 1);
      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('IN_USE');
      expect(response.problem?.['usage']).toEqual({
        count: 4,
        sample: [],
        filter: { deliveryZoneId: inner.id },
      });
      expect((await list(BRANCH_A)).body).toMatchObject({ total: 1 });
      expect(await auditRows('delivery_zone.delete')).toEqual([]);

      // "Stop using" is isActive: false.
      expect((await patch(BRANCH_A, inner.id, { rowVersion: 1, isActive: false })).status).toBe(
        200,
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  // Audit and the branch row (brief C10, C25)
  // -------------------------------------------------------------------------------------------

  describe('audit rows and the branch updated_by', () => {
    it('writes delivery_zone.create, .update and .delete with old and new values', async () => {
      const before = await branchState(BRANCH_A);
      const inner = await createZone(BRANCH_A, 500);
      const afterCreate = await branchState(BRANCH_A);
      expect(afterCreate.updated_by).toBe(MANAGER_A_ID);
      expect(afterCreate.row_version).toBe(before.row_version + 1);

      expect(
        (await patch(BRANCH_A, inner.id, { rowVersion: 1, fee: 20_000, name: 'Vòng gần' })).status,
      ).toBe(200);
      expect((await branchState(BRANCH_A)).row_version).toBe(before.row_version + 2);
      expect((await remove(BRANCH_A, inner.id, 2, await asAdmin())).status).toBe(204);
      const afterDelete = await branchState(BRANCH_A);
      expect(afterDelete.row_version).toBe(before.row_version + 3);
      expect(afterDelete.updated_by).toBe(ADMIN_ID);

      const rows = await auditRows();
      expect(rows.map((row) => row.action)).toEqual([
        'delivery_zone.create',
        'delivery_zone.update',
        'delivery_zone.delete',
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          entity_type: 'DELIVERY_ZONE',
          entity_id: inner.id,
          branch_id: BRANCH_A,
        });
      }
      const [created, updated, deleted] = rows;
      expect(created).toMatchObject({ actor_user_id: MANAGER_A_ID, entity_label: 'Vòng 500 m' });
      expect(created?.diff).toEqual({
        name: { from: null, to: 'Vòng 500 m' },
        radiusM: { from: null, to: 500 },
        fee: { from: null, to: 12_500 },
        minOrder: { from: null, to: 50_000 },
        freeOver: { from: null, to: 300_000 },
        etaMinutes: { from: null, to: 25 },
        isActive: { from: null, to: true },
      });
      expect(updated).toMatchObject({ actor_user_id: MANAGER_A_ID, entity_label: 'Vòng gần' });
      expect(updated?.diff).toEqual({
        name: { from: 'Vòng 500 m', to: 'Vòng gần' },
        fee: { from: 12_500, to: 20_000 },
      });
      expect(deleted).toMatchObject({ actor_user_id: ADMIN_ID, entity_label: 'Vòng gần' });
      expect(deleted?.diff['radiusM']).toEqual({ from: 500, to: null });
      expect(deleted?.diff['fee']).toEqual({ from: 20_000, to: null });
    });

    it('writes nothing when a write is refused', async () => {
      await threeRings();
      const before = await branchState(BRANCH_A);
      expect((await create(BRANCH_A, zoneBody(800))).status).toBe(400);
      expect(await auditRows()).toHaveLength(3);
      expect((await branchState(BRANCH_A)).row_version).toBe(before.row_version);
    });
  });

  // -------------------------------------------------------------------------------------------
  // STALE_VERSION
  // -------------------------------------------------------------------------------------------

  describe('STALE_VERSION', () => {
    it('refuses a stale PATCH or DELETE with current { rowVersion, updatedBy, updatedAt }', async () => {
      const inner = await createZone(BRANCH_A, 500);
      const first = await patch(BRANCH_A, inner.id, { rowVersion: 1, fee: 11_000 });
      expect(first.status).toBe(200);
      const fresh = first.body as Zone;

      const stale = await patch(
        BRANCH_A,
        inner.id,
        { rowVersion: 1, fee: 12_000 },
        await asAdmin(),
      );
      expect(stale.status).toBe(409);
      expect(stale.problem?.code).toBe('STALE_VERSION');
      expect(stale.problem?.['current']).toEqual({
        rowVersion: 2,
        updatedBy: { id: MANAGER_A_ID, name: MANAGER_A_NAME },
        updatedAt: fresh.updatedAt,
      });

      const staleDelete = await remove(BRANCH_A, inner.id, 1);
      expect(staleDelete.status).toBe(409);
      expect(staleDelete.problem?.code).toBe('STALE_VERSION');
      expect((await list(BRANCH_A)).body).toMatchObject({ total: 1 });
    });

    it('requires rowVersion on PATCH and DELETE', async () => {
      const inner = await createZone(BRANCH_A, 500);
      expect(fieldErrorsOf(await patch(BRANCH_A, inner.id, { fee: 1 }))).toEqual([
        { field: 'rowVersion', code: 'REQUIRED' },
      ]);
      const response = await client.request(zonesPath(BRANCH_A, `/${inner.id}`), {
        method: 'DELETE',
        headers: await asManagerA(),
      });
      expect(fieldErrorsOf(response)).toEqual([{ field: 'rowVersion', code: 'REQUIRED' }]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Scoping and roles
  // -------------------------------------------------------------------------------------------

  describe('scoping and roles', () => {
    it('answers 404 outside a manager’s branches, for an unknown branch or zone', async () => {
      const zoneB = await createZone(BRANCH_B, 500, await asAdmin());
      const point = await pointAt(BRANCH_B, 100);
      const manager = await asManagerA();

      expect((await list(BRANCH_B, manager)).status).toBe(404);
      expect((await create(BRANCH_B, zoneBody(900), manager)).status).toBe(404);
      expect((await patch(BRANCH_B, zoneB.id, { rowVersion: 1, fee: 1 }, manager)).status).toBe(
        404,
      );
      expect((await remove(BRANCH_B, zoneB.id, 1, manager)).status).toBe(404);
      expect((await check(BRANCH_B, point, manager)).status).toBe(404);
      expect((await check(BRANCH_B, point)).status).toBe(404);

      // A zone of branch B through the path of branch A.
      expect((await patch(BRANCH_A, zoneB.id, { rowVersion: 1, fee: 1 })).status).toBe(404);
      expect((await remove(BRANCH_A, zoneB.id, 1)).status).toBe(404);
      expect((await patch(BRANCH_A, UNKNOWN_ZONE, { rowVersion: 1, fee: 1 })).status).toBe(404);
      expect((await list(UNKNOWN_BRANCH, await asAdmin())).status).toBe(404);
      expect((await check(UNKNOWN_BRANCH, point, await asAdmin())).status).toBe(404);

      // The admin reaches every branch.
      expect((await list(BRANCH_B, await asAdmin())).body).toMatchObject({ total: 1 });
    });

    it('lets STAFF use the check only', async () => {
      const inner = await createZone(BRANCH_A, 500);
      const staff = await asStaffA();
      expect((await list(BRANCH_A, staff)).status).toBe(403);
      expect((await create(BRANCH_A, zoneBody(900), staff)).status).toBe(403);
      expect((await patch(BRANCH_A, inner.id, { rowVersion: 1, fee: 1 }, staff)).status).toBe(403);
      expect((await remove(BRANCH_A, inner.id, 1, staff)).status).toBe(403);

      const result = await check(BRANCH_A, await pointAt(BRANCH_A, 100), staff);
      expect(result.status).toBe(200);
      expect((result.body as CheckBody).zone?.id).toBe(inner.id);
    });

    it('answers 401 without a token', async () => {
      expect((await client.get(zonesPath(BRANCH_A))).status).toBe(401);
      expect(
        (await client.post(zonesPath(BRANCH_A, '/check'), { location: { lat: 0, lng: 0 } })).status,
      ).toBe(401);
    });
  });

  // -------------------------------------------------------------------------------------------
  // The zone check (testing-strategy "Delivery": the smallest matching ring)
  // -------------------------------------------------------------------------------------------

  describe('zone check', () => {
    it('picks the smallest active ring that contains the point', async () => {
      const { inner, middle, outer } = await threeRings();
      for (const [distance, expected] of [
        [400, inner],
        [900, middle],
        [1900, outer],
      ] as const) {
        const point = await pointAt(BRANCH_A, distance, 45);
        const body = await checkBody(BRANCH_A, point);
        expect(body.outOfZone).toBe(false);
        expect(body.zone?.id).toBe(expected.id);
        expect(body.zone).toMatchObject({ radiusM: expected.radiusM, fee: expected.fee });
        expect(body.distanceM).toBe(Math.round(await sqlDistance(BRANCH_A, point)));
        expect(Math.abs(body.distanceM - distance)).toBeLessThanOrEqual(1);
      }
    });

    it('answers outOfZone beyond the outermost ring, and with no ring at all', async () => {
      const far = await pointAt(BRANCH_A, 2500, 200);
      expect(await checkBody(BRANCH_A, far)).toEqual({
        distanceM: Math.round(await sqlDistance(BRANCH_A, far)),
        zone: null,
        outOfZone: true,
      });
      await threeRings();
      const beyond = await checkBody(BRANCH_A, far);
      expect(beyond.outOfZone).toBe(true);
      expect(beyond.zone).toBeNull();
    });

    it('ignores an inactive inner ring: the next ring wins', async () => {
      const { inner, middle } = await threeRings();
      expect((await patch(BRANCH_A, inner.id, { rowVersion: 1, isActive: false })).status).toBe(
        200,
      );
      const body = await checkBody(BRANCH_A, await pointAt(BRANCH_A, 400, 300));
      expect(body.zone?.id).toBe(middle.id);
    });

    it('treats the boundary as inclusive, one metre either side of the SQL distance', async () => {
      const point = await pointAt(BRANCH_B, 1234.5, 120);
      const distance = await sqlDistance(BRANCH_B, point);
      const admin = await asAdmin();

      // Radius at the first whole metre at or above the distance: inside.
      const zone = await createZone(BRANCH_B, Math.ceil(distance), admin);
      const inside = await check(BRANCH_B, point, admin);
      expect((inside.body as CheckBody).zone?.id).toBe(zone.id);

      // One metre less: below the distance, so outside.
      const shrunk = await patch(
        BRANCH_B,
        zone.id,
        { rowVersion: 1, radiusM: Math.ceil(distance) - 1 },
        admin,
      );
      expect(shrunk.status).toBe(200);
      const outside = await check(BRANCH_B, point, admin);
      expect(outside.body).toMatchObject({ zone: null, outOfZone: true });
      expect((outside.body as CheckBody).distanceM).toBe(Math.round(distance));

      // One metre above the rounded distance: inside again.
      const grown = await patch(
        BRANCH_B,
        zone.id,
        { rowVersion: 2, radiusM: Math.round(distance) + 1 },
        admin,
      );
      expect(grown.status).toBe(200);
      expect(((await check(BRANCH_B, point, admin)).body as CheckBody).outOfZone).toBe(false);
    });

    it('validates the location and never echoes it', async () => {
      const lat = 10.123456789;
      const missing = await check(BRANCH_A, undefined);
      expect(fieldErrorsOf(missing)).toEqual([{ field: 'location', code: 'REQUIRED' }]);
      const outOfRange = await check(BRANCH_A, { lat: 91.123456789, lng: 200.987654321 });
      expect(fieldErrorsOf(outOfRange)).toEqual([
        { field: 'location.lat', code: 'OUT_OF_RANGE' },
        { field: 'location.lng', code: 'OUT_OF_RANGE' },
      ]);
      const text = JSON.stringify(outOfRange.body);
      expect(text).not.toContain('91.123456789');
      expect(text).not.toContain('200.987654321');
      const scoped = await check(UNKNOWN_BRANCH, { lat, lng: 106.7 }, await asAdmin());
      expect(JSON.stringify(scoped.body)).not.toContain(String(lat));
    });

    it('stores nothing', async () => {
      await threeRings();
      const before = await branchState(BRANCH_A);
      await checkBody(BRANCH_A, await pointAt(BRANCH_A, 900));
      expect(await branchState(BRANCH_A)).toEqual(before);
      expect(await auditRows()).toHaveLength(3);
    });
  });
});
