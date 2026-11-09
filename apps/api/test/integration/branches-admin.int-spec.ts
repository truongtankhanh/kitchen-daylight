import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { NO_ACTIVE_WORK, ORDERS_FACTS } from '../../src/common/orders-facts/orders-facts.port.js';
import type {
  BranchActiveWork,
  BranchTodayStats,
  OrdersFacts,
} from '../../src/common/orders-facts/orders-facts.port.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { withConnection } from '../support/test-database.js';
import { truncateAll } from '../support/truncate.js';

// A5-T2, testing-strategy "Branches, menu and search" (`rowVersion` and constraints) and "Branch
// scoping" for `/admin/branches*`: create, list filters and paging, detail, STALE_VERSION payload,
// the `code` lock (ORDERS_FACTS replaced by a fake), the delivery switch, delete refusals, soft
// delete, 404 outside a manager's branches, 403 for STAFF, 401 without a token, and the audit rows
// with `branch_id`. As `kd_app` against real PostgreSQL. Access tokens are signed directly.
// Fictional data only.

const ADMIN_ID = '01930000-0000-7000-8000-000000005201';
const MANAGER_A_ID = '01930000-0000-7000-8000-000000005202';
const STAFF_A_ID = '01930000-0000-7000-8000-000000005203';
const MANAGER_B_ID = '01930000-0000-7000-8000-000000005204';
const SESSION_ID = '01930000-0000-7000-8000-0000000052a1';
// Fixture branches: codes FA and FB, slugs fixture-branch-1 and -2, sort_order 1 and 2.
const BRANCH_A = '01930000-0000-7000-8000-0000000052b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000052b2';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-0000000052bf';
const AMENITY_1 = '01930000-0000-7000-8000-0000000052c1';
const AMENITY_2 = '01930000-0000-7000-8000-0000000052c2';
const UNKNOWN_AMENITY = '01930000-0000-7000-8000-0000000052cf';

const MANAGER_A_NAME = 'Quản lý Mẫu A';

/**
 * Province `79` comes with the identity fixtures; its ward, a second province and its ward are
 * inserted as `kd_migrator` (`kd_app` only reads `provinces` and `wards`).
 */
const WARD_OF_79 = '26734';
const OTHER_PROVINCE = '01';
const WARD_OF_01 = '00004';

const BASE = '/api/v1/admin/branches';

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

const INSERT_GEOGRAPHY_SQL = `INSERT INTO public.provinces (code, names, type)
  VALUES ('${OTHER_PROVINCE}', '{"vi": "Mẫu Hai"}', 'CITY');
INSERT INTO public.wards (code, province_code, names, type) VALUES
  ('${WARD_OF_79}', '79', '{"vi": "Phường Mẫu"}', 'WARD'),
  ('${WARD_OF_01}', '${OTHER_PROVINCE}', '{"vi": "Phường Mẫu Hai"}', 'WARD')`;

const INSERT_AMENITY_SQL = `INSERT INTO public.amenities (id, code, names, icon)
  VALUES ($1, $2, '{"vi": "Tiện ích mẫu"}', 'wifi')`;

const INSERT_ZONE_SQL = `INSERT INTO public.delivery_zones
  (branch_id, name, radius_m, fee, min_order, eta_minutes, is_active)
  VALUES ($1, 'Vòng mẫu', 3000, 15000, 0, 30, $2)`;

interface Location {
  lat: number;
  lng: number;
}

interface BranchRow {
  id: string;
  code: string;
  slug: string;
  name: string;
  addressLine: string;
  provinceCode: string;
  wardCode: string | null;
  location: Location;
  phone: string;
  status: string;
  acceptsPickup: boolean;
  acceptsDelivery: boolean;
  acceptsReservations: boolean;
  sortOrder: number;
  staffCount: number;
  ratingAverage: number | null;
  reviewCount: number;
  activeZoneCount: number;
  codeLocked: boolean;
  ordersToday: number;
  activeOrders: number;
  todayHours: { openTime: string; closeTime: string; closesNextDay: boolean }[];
}

interface BranchDetail extends BranchRow {
  rowVersion: number;
  description: Record<string, string> | null;
  websiteUrl: string | null;
  pauseMessage: string | null;
  defaultPrepMinutes: number;
  orderCutoffMinutes: number;
  reservationDurationMinutes: number;
  reservationSlotStepMinutes: number;
  reservationMaxParty: number;
  reservationLeadMinutes: number;
  reservationMaxDaysAhead: number;
  amenityIds: string[];
  updatedAt: string;
}

interface BranchPage {
  items: BranchRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  branch_id: string | null;
  actor_user_id: string | null;
  diff: Record<string, unknown>;
}

/** What the fake `ORDERS_FACTS` answers; reset before every test. */
const facts = {
  anyOrder: new Set<string>(),
  work: new Map<string, BranchActiveWork>(),
  today: new Map<string, BranchTodayStats>(),
};

const fakeOrdersFacts: OrdersFacts = {
  branchHasAnyOrder: (branchId) => Promise.resolve(facts.anyOrder.has(branchId)),
  branchActiveWork: (branchId) => Promise.resolve(facts.work.get(branchId) ?? NO_ACTIVE_WORK),
  branchTodayStats: (branchIds) =>
    Promise.resolve(new Map([...facts.today].filter(([id]) => branchIds.includes(id)))),
  zoneUsage: () => Promise.resolve(0),
  menuItemActiveOrders: () => Promise.resolve(0),
  orderNumbers: () => Promise.resolve(new Map()),
};

function newBranchBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'DK',
    name: 'Chi nhánh Đa Kao',
    description: { vi: 'Chi nhánh mẫu' },
    addressLine: '2 Đường Mẫu',
    provinceCode: '79',
    wardCode: WARD_OF_79,
    location: { lat: 10.7881, lng: 106.6992 },
    phone: '+84 28 0000 0002',
    status: 'ACTIVE',
    acceptsPickup: true,
    acceptsDelivery: false,
    acceptsReservations: true,
    defaultPrepMinutes: 20,
    orderCutoffMinutes: 30,
    reservationSlotStepMinutes: 30,
    reservationMaxParty: 10,
    reservationLeadMinutes: 120,
    reservationMaxDaysAhead: 30,
    ...overrides,
  };
}

describe('admin branches (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeEach(async () => {
    facts.anyOrder.clear();
    facts.work.clear();
    facts.today.clear();
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B] });
    const { migratorUrl } = inject('kdTestDatabase');
    await withConnection(migratorUrl, async (dataSource) => {
      await dataSource.query(INSERT_GEOGRAPHY_SQL);
    });
    testApp = await createTestApp({
      providers: [{ provide: ORDERS_FACTS, useValue: fakeOrdersFacts }],
    });
    client = http(testApp.baseUrl);
    await insertUser(ADMIN_ID, 'ADMIN', 'Quản trị Mẫu');
    await insertUser(MANAGER_A_ID, 'MANAGER', MANAGER_A_NAME);
    await insertUser(STAFF_A_ID, 'STAFF', 'Nhân viên Mẫu A');
    await insertUser(MANAGER_B_ID, 'MANAGER', 'Quản lý Mẫu B');
    await addStaffBranch(MANAGER_A_ID, BRANCH_A);
    await addStaffBranch(STAFF_A_ID, BRANCH_A);
    await addStaffBranch(MANAGER_B_ID, BRANCH_B);
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
      `fixture-branches-${id.slice(-4)}@kd.example`,
      displayName,
      role,
    ]);
  }

  function addStaffBranch(userId: string, branchId: string): Promise<unknown> {
    return query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
      userId,
      branchId,
    ]);
  }

  async function headersOf(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  async function asAdmin(): Promise<Record<string, string>> {
    return headersOf(ADMIN_ID, 'ADMIN');
  }

  async function asManagerA(): Promise<Record<string, string>> {
    return headersOf(MANAGER_A_ID, 'MANAGER');
  }

  async function list(search = '', headers?: Record<string, string>): Promise<BranchPage> {
    const response = await client.get(`${BASE}${search}`, {
      headers: headers ?? (await asAdmin()),
    });
    expect(response.status).toBe(200);
    return response.body as BranchPage;
  }

  async function detail(id: string): Promise<BranchDetail> {
    const response = await client.get(`${BASE}/${id}`, { headers: await asAdmin() });
    expect(response.status).toBe(200);
    return response.body as BranchDetail;
  }

  async function create(
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.post(BASE, body, { headers: headers ?? (await asAdmin()) });
  }

  async function patch(
    id: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.request(`${BASE}/${id}`, {
      method: 'PATCH',
      body,
      headers: headers ?? (await asAdmin()),
    });
  }

  async function remove(
    id: string,
    rowVersion: number | undefined,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    const search = rowVersion === undefined ? '' : `?rowVersion=${rowVersion}`;
    return client.request(`${BASE}/${id}${search}`, {
      method: 'DELETE',
      headers: headers ?? (await asAdmin()),
    });
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
  // Authentication and roles
  // -------------------------------------------------------------------------------------------

  describe('authentication and roles', () => {
    it('answers 401 without a token', async () => {
      const response = await client.get(BASE);

      expect({ status: response.status, code: response.problem?.code }).toEqual({
        status: 401,
        code: 'UNAUTHENTICATED',
      });
    });

    it('answers 403 FORBIDDEN to STAFF on every route, their own branch included', async () => {
      const headers = await headersOf(STAFF_A_ID, 'STAFF');
      const responses = [
        await client.get(BASE, { headers }),
        await client.get(`${BASE}/${BRANCH_A}`, { headers }),
        await create(newBranchBody(), headers),
        await patch(BRANCH_A, { rowVersion: 1, name: 'Đổi tên' }, headers),
        await remove(BRANCH_A, 1, headers),
      ];

      expect(responses.map((response) => [response.status, response.problem?.code])).toEqual(
        Array.from({ length: 5 }, () => [403, 'FORBIDDEN']),
      );
      expect((await detail(BRANCH_A)).name).toBe('Chi nhánh mẫu');
    });

    it('answers 403 FORBIDDEN to MANAGER on create and delete', async () => {
      const headers = await asManagerA();

      expect((await create(newBranchBody(), headers)).status).toBe(403);
      expect((await remove(BRANCH_A, 1, headers)).status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------------------------

  describe('POST /admin/branches', () => {
    it('creates the branch with a derived slug, the next sort order and an audit row', async () => {
      const response = await create(newBranchBody());

      expect(response.status).toBe(201);
      const created = response.body as BranchDetail;
      expect(created).toMatchObject({
        code: 'DK',
        slug: 'chi-nhanh-da-kao',
        name: 'Chi nhánh Đa Kao',
        description: { vi: 'Chi nhánh mẫu' },
        provinceCode: '79',
        wardCode: WARD_OF_79,
        location: { lat: 10.7881, lng: 106.6992 },
        phone: '+842800000002',
        status: 'ACTIVE',
        acceptsDelivery: false,
        reservationDurationMinutes: 90,
        reservationSlotStepMinutes: 30,
        sortOrder: 3,
        rowVersion: 1,
        staffCount: 0,
        ratingAverage: null,
        reviewCount: 0,
        activeZoneCount: 0,
        codeLocked: false,
        ordersToday: 0,
        activeOrders: 0,
        todayHours: [],
        amenityIds: [],
        websiteUrl: null,
        pauseMessage: null,
      });
      for (const internal of ['deletedAt', 'ratingSum', 'updatedBy', 'coverMediaId']) {
        expect(created).not.toHaveProperty(internal);
      }

      const audit = await auditRows('branch.create');
      expect(audit).toEqual([
        {
          action: 'branch.create',
          entity_type: 'BRANCH',
          entity_id: created.id,
          entity_label: 'Chi nhánh Đa Kao',
          branch_id: created.id,
          actor_user_id: ADMIN_ID,
          diff: {
            branchCode: { from: null, to: 'DK' },
            name: { from: null, to: 'Chi nhánh Đa Kao' },
            status: { from: null, to: 'ACTIVE' },
          },
        },
      ]);
      const [stored] = await query<{ updated_by: string }>(
        'SELECT updated_by::text AS updated_by FROM public.branches WHERE id = $1',
        [created.id],
      );
      expect(stored?.updated_by).toBe(ADMIN_ID);
    });

    it('keeps a slug that is sent', async () => {
      const response = await create(newBranchBody({ slug: 'da-kao' }));

      expect((response.body as BranchDetail).slug).toBe('da-kao');
    });

    it('answers ALREADY_EXISTS for a code or a slug in use', async () => {
      const byCode = await create(newBranchBody({ code: 'FA' }));
      const bySlug = await create(newBranchBody({ slug: 'fixture-branch-1' }));

      expect([byCode.status, byCode.problem?.code]).toEqual([409, 'ALREADY_EXISTS']);
      expect([bySlug.status, bySlug.problem?.code]).toEqual([409, 'ALREADY_EXISTS']);
      expect(await auditRows('branch.create')).toEqual([]);
    });

    it('refuses acceptsDelivery: a new branch has no active zone (brief C8)', async () => {
      expect(fieldErrorsOf(await create(newBranchBody({ acceptsDelivery: true })))).toEqual([
        { field: 'acceptsDelivery', code: 'INVALID' },
      ]);
    });

    it('refuses a ward of another province and an unknown province', async () => {
      expect(fieldErrorsOf(await create(newBranchBody({ wardCode: WARD_OF_01 })))).toEqual([
        { field: 'wardCode', code: 'NOT_FOUND' },
      ]);
      expect(
        fieldErrorsOf(await create(newBranchBody({ provinceCode: '99', wardCode: null }))),
      ).toEqual([{ field: 'provinceCode', code: 'NOT_FOUND' }]);
    });

    it('accepts a branch without a ward', async () => {
      const response = await create(newBranchBody({ wardCode: undefined }));

      expect(response.status).toBe(201);
      expect((response.body as BranchDetail).wardCode).toBeNull();
    });

    it('refuses a national phone number and a code that is not 2 to 4 capitals', async () => {
      const errors = fieldErrorsOf(await create(newBranchBody({ phone: '028 0000 0002' })));
      expect(errors).toEqual([{ field: 'phone', code: 'INVALID_PHONE' }]);
      expect(fieldErrorsOf(await create(newBranchBody({ code: 'dk' })))).toEqual([
        { field: 'code', code: 'INVALID' },
      ]);
    });

    it('requires the pin and range-checks it', async () => {
      expect(fieldErrorsOf(await create(newBranchBody({ location: undefined })))).toEqual([
        { field: 'location', code: 'REQUIRED' },
      ]);
      expect(
        fieldErrorsOf(await create(newBranchBody({ location: { lat: 95, lng: 106.7 } }))),
      ).toEqual([{ field: 'location.lat', code: 'OUT_OF_RANGE' }]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // List and detail
  // -------------------------------------------------------------------------------------------

  describe('GET /admin/branches', () => {
    it('lists every live branch for ADMIN, by sort order, with the derived figures', async () => {
      await query('UPDATE public.branches SET review_count = 3, rating_sum = 13 WHERE id = $1', [
        BRANCH_A,
      ]);
      await query(INSERT_ZONE_SQL, [BRANCH_A, true]);
      await query(INSERT_ZONE_SQL.replace('3000', '5000'), [BRANCH_A, false]);
      facts.anyOrder.add(BRANCH_A);
      facts.today.set(BRANCH_A, { ordersToday: 7, activeOrders: 2 });

      const page = await list();

      expect(page).toMatchObject({ page: 1, pageSize: 20, total: 2 });
      expect(page.items.map((item) => item.id)).toEqual([BRANCH_A, BRANCH_B]);
      expect(page.items[0]).toMatchObject({
        code: 'FA',
        staffCount: 2,
        ratingAverage: 4.3,
        reviewCount: 3,
        activeZoneCount: 1,
        codeLocked: true,
        ordersToday: 7,
        activeOrders: 2,
        todayHours: [],
        location: { lat: 10.77, lng: 106.7 },
      });
      expect(page.items[1]).toMatchObject({
        code: 'FB',
        staffCount: 1,
        ratingAverage: null,
        codeLocked: false,
        ordersToday: 0,
        activeOrders: 0,
      });
      expect(Object.keys(page.items[0] ?? {})).not.toContain('deletedAt');
    });

    it('lists only the branches of a MANAGER', async () => {
      const page = await list('', await asManagerA());

      expect(page.total).toBe(1);
      expect(page.items.map((item) => item.id)).toEqual([BRANCH_A]);
    });

    it('pages with page and pageSize', async () => {
      await create(newBranchBody());

      const second = await list('?page=2&pageSize=2');
      const past = await list('?page=5&pageSize=2');

      expect(second.total).toBe(3);
      expect(second.items.map((item) => item.code)).toEqual(['DK']);
      expect(past).toMatchObject({ items: [], total: 3 });
    });

    it('matches q on the name or the code, accent and case insensitive', async () => {
      await create(newBranchBody());

      for (const q of ['da kao', 'ĐA KAO', 'Đa', 'dk']) {
        const page = await list(`?q=${encodeURIComponent(q)}`);
        expect(page.items.map((item) => item.code)).toEqual(['DK']);
      }
      expect((await list(`?q=${encodeURIComponent('mẫu')}`)).total).toBe(2);
      expect((await list('?q=%25')).total).toBe(0);
    });

    it('filters by status', async () => {
      await patch(BRANCH_B, { rowVersion: 1, status: 'TEMPORARILY_CLOSED' });

      const paused = await list('?status=TEMPORARILY_CLOSED');

      expect(paused.items.map((item) => item.id)).toEqual([BRANCH_B]);
      expect((await list('?status=CLOSED')).total).toBe(0);
    });

    it('refuses an unknown status and a page size above 50', async () => {
      const response = await client.get(`${BASE}?status=OPEN&pageSize=51`, {
        headers: await asAdmin(),
      });

      expect(
        fieldErrorsOf(response)
          .map(({ field }) => field)
          .sort(),
      ).toEqual(['pageSize', 'status']);
    });
  });

  describe('GET /admin/branches/{id}', () => {
    it('returns the detail with rowVersion, rules, amenities and pauseMessage', async () => {
      const branch = await detail(BRANCH_A);

      expect(branch).toMatchObject({
        id: BRANCH_A,
        rowVersion: 1,
        defaultPrepMinutes: 15,
        orderCutoffMinutes: 30,
        reservationDurationMinutes: 90,
        reservationSlotStepMinutes: 15,
        reservationMaxParty: 8,
        reservationLeadMinutes: 60,
        reservationMaxDaysAhead: 30,
        amenityIds: [],
        pauseMessage: null,
        description: null,
      });
      expect(typeof branch.updatedAt).toBe('string');
    });

    it('answers 404 for a branch outside the manager list, never 403', async () => {
      const headers = await asManagerA();

      expect((await client.get(`${BASE}/${BRANCH_A}`, { headers })).status).toBe(200);
      const other = await client.get(`${BASE}/${BRANCH_B}`, { headers });
      expect([other.status, other.problem?.code]).toEqual([404, 'NOT_FOUND']);
      const unknown = await client.get(`${BASE}/${UNKNOWN_BRANCH}`, { headers });
      expect([unknown.status, unknown.problem?.code]).toEqual([404, 'NOT_FOUND']);
    });

    it('answers 404 to ADMIN for an unknown id and 400 for a malformed one', async () => {
      const headers = await asAdmin();

      expect((await client.get(`${BASE}/${UNKNOWN_BRANCH}`, { headers })).status).toBe(404);
      expect((await client.get(`${BASE}/not-a-uuid`, { headers })).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------

  describe('PATCH /admin/branches/{id}', () => {
    it('changes the fields sent, moves rowVersion and stamps the editor', async () => {
      const response = await patch(
        BRANCH_A,
        {
          rowVersion: 1,
          name: 'Chi nhánh Mẫu Mới',
          websiteUrl: 'https://kitchendaylight.example/fa',
          pauseMessage: 'Tạm nghỉ đến 18:00',
          reservationDurationMinutes: 120,
        },
        await asManagerA(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'Chi nhánh Mẫu Mới',
        slug: 'fixture-branch-1',
        websiteUrl: 'https://kitchendaylight.example/fa',
        pauseMessage: 'Tạm nghỉ đến 18:00',
        reservationDurationMinutes: 120,
        rowVersion: 2,
      });
      const [stored] = await query<{ updated_by: string }>(
        'SELECT updated_by::text AS updated_by FROM public.branches WHERE id = $1',
        [BRANCH_A],
      );
      expect(stored?.updated_by).toBe(MANAGER_A_ID);
      // No general update row (brief G7); the pin was not sent.
      expect(await auditRows()).toEqual([]);
    });

    it('answers STALE_VERSION with who changed the branch and when', async () => {
      await patch(BRANCH_A, { rowVersion: 1, name: 'Lần một' }, await asManagerA());
      const changed = await detail(BRANCH_A);

      const response = await patch(BRANCH_A, { rowVersion: 1, name: 'Lần hai' });

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('STALE_VERSION');
      expect((response.body as { current: unknown }).current).toEqual({
        rowVersion: 2,
        updatedBy: { id: MANAGER_A_ID, name: MANAGER_A_NAME },
        updatedAt: changed.updatedAt,
      });
      expect((await detail(BRANCH_A)).name).toBe('Lần một');
    });

    it('refuses a code change with LOCKED once the branch has an order (brief C6)', async () => {
      facts.anyOrder.add(BRANCH_A);

      expect(fieldErrorsOf(await patch(BRANCH_A, { rowVersion: 1, code: 'XA' }))).toEqual([
        { field: 'code', code: 'LOCKED' },
      ]);
      // The same code is not a change.
      expect((await patch(BRANCH_A, { rowVersion: 1, code: 'FA' })).status).toBe(200);
      // Another branch without orders may change its code.
      const free = await patch(BRANCH_B, { rowVersion: 1, code: 'XB' });
      expect([free.status, (free.body as BranchDetail).code]).toEqual([200, 'XB']);
    });

    it('answers ALREADY_EXISTS for a code in use', async () => {
      const response = await patch(BRANCH_B, { rowVersion: 1, code: 'FA' });

      expect([response.status, response.problem?.code]).toEqual([409, 'ALREADY_EXISTS']);
    });

    it('switches delivery on only with an active zone (brief C8)', async () => {
      await query(INSERT_ZONE_SQL, [BRANCH_A, false]);
      expect(
        fieldErrorsOf(await patch(BRANCH_A, { rowVersion: 1, acceptsDelivery: true })),
      ).toEqual([{ field: 'acceptsDelivery', code: 'INVALID' }]);

      await query(INSERT_ZONE_SQL.replace('3000', '5000'), [BRANCH_A, true]);
      const response = await patch(BRANCH_A, { rowVersion: 1, acceptsDelivery: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ acceptsDelivery: true, activeZoneCount: 1 });
    });

    it('maps the reservation limits and the text limits to field codes', async () => {
      const errors = fieldErrorsOf(
        await patch(BRANCH_A, {
          rowVersion: 1,
          reservationDurationMinutes: 100,
          reservationSlotStepMinutes: 20,
        }),
      );
      expect(errors).toEqual([
        { field: 'reservationDurationMinutes', code: 'OUT_OF_RANGE' },
        { field: 'reservationSlotStepMinutes', code: 'OUT_OF_RANGE' },
      ]);

      const ranges = fieldErrorsOf(
        await patch(BRANCH_A, {
          rowVersion: 1,
          reservationMaxParty: 0,
          reservationLeadMinutes: 1441,
          reservationMaxDaysAhead: 0,
          pauseMessage: 'x'.repeat(201),
        }),
      );
      expect(ranges.sort((a, b) => a.field.localeCompare(b.field))).toEqual([
        { field: 'pauseMessage', code: 'TOO_LONG' },
        { field: 'reservationLeadMinutes', code: 'OUT_OF_RANGE' },
        { field: 'reservationMaxDaysAhead', code: 'OUT_OF_RANGE' },
        { field: 'reservationMaxParty', code: 'OUT_OF_RANGE' },
      ]);

      expect(
        fieldErrorsOf(await patch(BRANCH_A, { rowVersion: 1, websiteUrl: 'http://kd.example' })),
      ).toEqual([{ field: 'websiteUrl', code: 'INVALID' }]);
      expect(fieldErrorsOf(await patch(BRANCH_A, { rowVersion: 1, slug: 'moi' }))).toEqual([
        { field: 'slug', code: 'INVALID' },
      ]);
      expect((await detail(BRANCH_A)).rowVersion).toBe(1);
    });

    it('replaces the amenity list and refuses an unknown amenity', async () => {
      await query(INSERT_AMENITY_SQL, [AMENITY_1, 'wifi']);
      await query(INSERT_AMENITY_SQL, [AMENITY_2, 'parking']);

      const both = await patch(BRANCH_A, { rowVersion: 1, amenityIds: [AMENITY_2, AMENITY_1] });
      expect((both.body as BranchDetail).amenityIds).toEqual([AMENITY_1, AMENITY_2]);

      const one = await patch(BRANCH_A, { rowVersion: 2, amenityIds: [AMENITY_2] });
      expect((one.body as BranchDetail).amenityIds).toEqual([AMENITY_2]);

      expect(
        fieldErrorsOf(await patch(BRANCH_A, { rowVersion: 3, amenityIds: [UNKNOWN_AMENITY] })),
      ).toEqual([{ field: 'amenityIds', code: 'NOT_FOUND' }]);
      expect((await detail(BRANCH_A)).amenityIds).toEqual([AMENITY_2]);

      const none = await patch(BRANCH_A, { rowVersion: 3, amenityIds: [] });
      expect((none.body as BranchDetail).amenityIds).toEqual([]);
    });

    it('writes branch.location_confirm with the old and new pin when location is sent', async () => {
      const response = await patch(
        BRANCH_A,
        { rowVersion: 1, location: { lat: 10.78, lng: 106.71 } },
        await asManagerA(),
      );

      expect(response.status).toBe(200);
      expect((response.body as BranchDetail).location).toEqual({ lat: 10.78, lng: 106.71 });
      expect(await auditRows()).toEqual([
        {
          action: 'branch.location_confirm',
          entity_type: 'BRANCH',
          entity_id: BRANCH_A,
          entity_label: 'Chi nhánh mẫu',
          branch_id: BRANCH_A,
          actor_user_id: MANAGER_A_ID,
          diff: {
            location: { from: { lat: 10.77, lng: 106.7 }, to: { lat: 10.78, lng: 106.71 } },
          },
        },
      ]);
    });

    it('answers 404 to a manager for another branch and for an unknown one', async () => {
      const headers = await asManagerA();

      expect((await patch(BRANCH_B, { rowVersion: 1, name: 'X' }, headers)).status).toBe(404);
      expect((await patch(UNKNOWN_BRANCH, { rowVersion: 1, name: 'X' }, headers)).status).toBe(404);
      expect((await detail(BRANCH_B)).name).toBe('Chi nhánh mẫu');
    });

    it('refuses a ward that does not belong to the province', async () => {
      expect(fieldErrorsOf(await patch(BRANCH_A, { rowVersion: 1, wardCode: WARD_OF_01 }))).toEqual(
        [{ field: 'wardCode', code: 'NOT_FOUND' }],
      );
      const moved = await patch(BRANCH_A, {
        rowVersion: 1,
        provinceCode: OTHER_PROVINCE,
        wardCode: WARD_OF_01,
      });
      expect(moved.body).toMatchObject({ provinceCode: OTHER_PROVINCE, wardCode: WARD_OF_01 });
    });
  });

  // -------------------------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------------------------

  describe('DELETE /admin/branches/{id}', () => {
    it('soft-deletes the branch, hides it everywhere and writes branch.delete', async () => {
      const response = await remove(BRANCH_B, 1);

      expect(response.status).toBe(204);
      const page = await list();
      expect(page.items.map((item) => item.id)).toEqual([BRANCH_A]);
      expect((await client.get(`${BASE}/${BRANCH_B}`, { headers: await asAdmin() })).status).toBe(
        404,
      );
      const managerB = await headersOf(MANAGER_B_ID, 'MANAGER');
      expect((await list('', managerB)).total).toBe(0);
      expect((await client.get(`${BASE}/${BRANCH_B}`, { headers: managerB })).status).toBe(404);
      expect((await patch(BRANCH_B, { rowVersion: 2, name: 'X' })).status).toBe(404);
      expect((await remove(BRANCH_B, 2)).status).toBe(404);

      const [stored] = await query<{ deleted: boolean; updated_by: string }>(
        `SELECT deleted_at IS NOT NULL AS deleted, updated_by::text AS updated_by
           FROM public.branches WHERE id = $1`,
        [BRANCH_B],
      );
      expect(stored).toEqual({ deleted: true, updated_by: ADMIN_ID });
      const audit = await auditRows('branch.delete');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        entity_type: 'BRANCH',
        entity_id: BRANCH_B,
        entity_label: 'Chi nhánh mẫu',
        branch_id: BRANCH_B,
        actor_user_id: ADMIN_ID,
        diff: { branchCode: 'FB', deletedAt: { from: null } },
      });
    });

    it('needs the current rowVersion', async () => {
      const missing = await remove(BRANCH_B, undefined);
      expect(fieldErrorsOf(missing)).toEqual([{ field: 'rowVersion', code: 'REQUIRED' }]);

      const stale = await remove(BRANCH_B, 7);
      expect([stale.status, stale.problem?.code]).toEqual([409, 'STALE_VERSION']);
      expect((await list()).total).toBe(2);
    });

    it('refuses with HAS_ACTIVE_ORDERS and the counts while work is open (brief C1)', async () => {
      facts.work.set(BRANCH_B, { orders: 2, reservations: 1 });

      const response = await remove(BRANCH_B, 1);

      expect([response.status, response.problem?.code]).toEqual([409, 'HAS_ACTIVE_ORDERS']);
      expect((response.body as { details: unknown }).details).toEqual({
        orders: 2,
        reservations: 1,
      });
      expect((await list()).total).toBe(2);
      expect(await auditRows('branch.delete')).toEqual([]);
    });

    it('refuses the last branch in operation with INVALID_STATE', async () => {
      expect((await remove(BRANCH_B, 1)).status).toBe(204);

      const response = await remove(BRANCH_A, 1);

      expect([response.status, response.problem?.code]).toEqual([409, 'INVALID_STATE']);
      expect((await list()).total).toBe(1);
    });

    it('counts a CLOSED branch as not in operation', async () => {
      await patch(BRANCH_B, { rowVersion: 1, status: 'CLOSED' });

      const lastOpen = await remove(BRANCH_A, 1);
      expect([lastOpen.status, lastOpen.problem?.code]).toEqual([409, 'INVALID_STATE']);
      // The closed one may go: branch A stays in operation.
      expect((await remove(BRANCH_B, 2)).status).toBe(204);
    });
  });
});
