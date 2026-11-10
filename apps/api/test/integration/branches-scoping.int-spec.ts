import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addCalendarDays, formatVietnamDate } from '../../src/common/time/vietnam-time.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { enumerateRouter, keyOf } from '../support/route-table.js';
import { BRANCH_FAMILY_ROUTES, isBranchFamilyPath } from '../support/scoping-matrix.js';
import type { BranchFamilyAccess, BranchFamilyRoute } from '../support/scoping-matrix.js';
import { truncateAll } from '../support/truncate.js';

// A5-T6, branch scoping of the branch endpoints (testing-strategy "Branch scoping, enumerated",
// "Authorization and ownership"; api-outline Conventions "Branch scoping", "Branches" header).
//
// 1. The family list: every router route under `/api/v1/admin/branches*` and `/api/v1/admin/wards`
//    is in `BRANCH_FAMILY_ROUTES` (`support/scoping-matrix.ts`) and has a request here, so a later
//    route of the family cannot skip this matrix.
// 2. The matrix: ADMIN, the MANAGER of A, the STAFF of A and the MANAGER of B call every route on
//    branch A and branch B; the exact status of each call, the branches a list shows, no
//    `deleted*` key and no id of a branch the caller cannot see in any success body; `401` without
//    a token; `404` for everyone on a soft-deleted branch; a zone of B under A's path is `404`.
// 3. The audit rows of the family (data-model `audit_logs`): exactly the seven codes, each with
//    `branch_id`, a readable `entity_label`, coordinates only in `branch.location_confirm`.
// 4. Privacy: the special-day `note` reaches managers only; the `check` coordinates are never
//    echoed in a response or an error body. Request logging is covered by A0-T2: the `req`
//    serializer keeps `id`, `method` and the sanitized URL only, never the body
//    (`src/common/logging/request-serializer.spec.ts`, "keeps only id, method and the sanitized
//    url"), and a logged HTTP error keeps its status but not its response body
//    (`src/common/logging/error-serializer.spec.ts`).
//
// Access tokens are signed directly; the services read `staff_branches` from PostgreSQL. As
// `kd_app` against real PostgreSQL and PostGIS. Fictional data only.

const SESSION_ID = '01930000-0000-7000-8000-0000000057a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000057b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000057b2';

const ADMIN_ID = '01930000-0000-7000-8000-000000005701';
const MANAGER_A_ID = '01930000-0000-7000-8000-000000005702';
const STAFF_A_ID = '01930000-0000-7000-8000-000000005703';
const MANAGER_B_ID = '01930000-0000-7000-8000-000000005704';

interface Actor {
  readonly name: string;
  readonly id: string;
  readonly role: UserRole;
  readonly branchIds: readonly string[];
}

const ADMIN: Actor = { name: 'ADMIN', id: ADMIN_ID, role: 'ADMIN', branchIds: [] };
const MANAGER_A: Actor = {
  name: 'MANAGER of A',
  id: MANAGER_A_ID,
  role: 'MANAGER',
  branchIds: [BRANCH_A],
};
const STAFF_A: Actor = { name: 'STAFF of A', id: STAFF_A_ID, role: 'STAFF', branchIds: [BRANCH_A] };
const MANAGER_B: Actor = {
  name: 'MANAGER of B',
  id: MANAGER_B_ID,
  role: 'MANAGER',
  branchIds: [BRANCH_B],
};
const ACTORS: readonly Actor[] = [ADMIN, MANAGER_A, STAFF_A, MANAGER_B];

const BRANCHES = '/api/v1/admin/branches';

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, 'Người dùng Mẫu', 'vi', $3, 'ACTIVE')`;
const INSERT_STAFF_BRANCH_SQL =
  'INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)';
const INSERT_ZONE_SQL = `INSERT INTO public.delivery_zones
  (branch_id, name, radius_m, fee, min_order, free_over, eta_minutes, is_active)
VALUES ($1, 'Vòng mẫu', 1000, 15000, 50000, NULL, 30, true)
RETURNING id::text AS id, row_version`;
const ROW_VERSIONS_SQL = 'SELECT id::text AS id, row_version FROM public.branches';

/** The pin and the check point, both near the fixture pin (106.7, 10.77); distinctive digits. */
const NEW_PIN = { lat: 10.7881, lng: 106.6992 };
const CONFIRMED_PIN = { lat: 10.7901, lng: 106.6901 };
const CHECK_POINT = { lat: 10.771234, lng: 106.701234 };
const INTERNAL_NOTE = 'Ghi chú nội bộ mẫu';

/** What `resetData` wrote: the branch `row_version`s and one zone per branch. */
interface Seed {
  readonly rowVersion: ReadonlyMap<string, number>;
  readonly zone: ReadonlyMap<string, { readonly id: string; readonly rowVersion: number }>;
}

interface FamilyRequest {
  readonly path: string;
  readonly body?: unknown;
}

function newBranchBody(): Record<string, unknown> {
  return {
    code: 'DK',
    name: 'Chi nhánh Đa Kao',
    addressLine: '2 Đường Mẫu',
    provinceCode: '79',
    location: NEW_PIN,
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
  };
}

function zoneBody(radiusM: number): Record<string, unknown> {
  return {
    name: `Vòng ${radiusM} m`,
    radiusM,
    fee: 20_000,
    minOrder: 50_000,
    freeOver: 300_000,
    etaMinutes: 40,
    isActive: true,
  };
}

function versionOf(seed: Seed, branchId: string): number {
  return seed.rowVersion.get(branchId) ?? 1;
}

function zoneOf(seed: Seed, branchId: string): { id: string; rowVersion: number } {
  return seed.zone.get(branchId) ?? { id: '01930000-0000-7000-8000-0000000057cf', rowVersion: 1 };
}

/** One valid call of every family route for branch `branchId` (ignored by `NONE` and `LIST`). */
const REQUESTS: Readonly<Record<string, (branchId: string, seed: Seed) => FamilyRequest>> = {
  'GET /api/v1/admin/branches': () => ({ path: BRANCHES }),
  'POST /api/v1/admin/branches': () => ({ path: BRANCHES, body: newBranchBody() }),
  'GET /api/v1/admin/branches/:id': (id) => ({ path: `${BRANCHES}/${id}` }),
  'PATCH /api/v1/admin/branches/:id': (id, seed) => ({
    path: `${BRANCHES}/${id}`,
    body: { rowVersion: versionOf(seed, id), name: 'Chi nhánh Đổi Tên' },
  }),
  'DELETE /api/v1/admin/branches/:id': (id, seed) => ({
    path: `${BRANCHES}/${id}?rowVersion=${versionOf(seed, id)}`,
  }),
  'GET /api/v1/admin/branches/:id/hours': (id) => ({ path: `${BRANCHES}/${id}/hours` }),
  'PUT /api/v1/admin/branches/:id/hours': (id, seed) => ({
    path: `${BRANCHES}/${id}/hours`,
    body: { rowVersion: versionOf(seed, id), periods: [], special: [] },
  }),
  'GET /api/v1/admin/branches/:id/delivery-zones': (id) => ({
    path: `${BRANCHES}/${id}/delivery-zones`,
  }),
  'POST /api/v1/admin/branches/:id/delivery-zones': (id) => ({
    path: `${BRANCHES}/${id}/delivery-zones`,
    body: zoneBody(1500),
  }),
  'POST /api/v1/admin/branches/:id/delivery-zones/check': (id) => ({
    path: `${BRANCHES}/${id}/delivery-zones/check`,
    body: { location: CHECK_POINT },
  }),
  'PATCH /api/v1/admin/branches/:id/delivery-zones/:zoneId': (id, seed) => ({
    path: `${BRANCHES}/${id}/delivery-zones/${zoneOf(seed, id).id}`,
    body: { rowVersion: zoneOf(seed, id).rowVersion, etaMinutes: 35 },
  }),
  'DELETE /api/v1/admin/branches/:id/delivery-zones/:zoneId': (id, seed) => ({
    path: `${BRANCHES}/${id}/delivery-zones/${zoneOf(seed, id).id}?rowVersion=${zoneOf(seed, id).rowVersion}`,
  }),
  'POST /api/v1/admin/branches/:id/pause': (id) => ({
    path: `${BRANCHES}/${id}/pause`,
    body: { paused: true },
  }),
  'GET /api/v1/admin/wards': () => ({ path: '/api/v1/admin/wards?provinceCode=79' }),
};

/** The success status of a route: `201` for a create, `204` for a delete, else `200`. */
function successStatus(route: string): number {
  if (route.startsWith('DELETE ')) {
    return 204;
  }
  return route === 'POST /api/v1/admin/branches' ||
    route === 'POST /api/v1/admin/branches/:id/delivery-zones'
    ? 201
    : 200;
}

function roleAllowed(access: BranchFamilyAccess, role: UserRole): boolean {
  switch (access) {
    case 'STAFF':
      return role === 'STAFF' || role === 'MANAGER' || role === 'ADMIN';
    case 'MANAGER':
      return role === 'MANAGER' || role === 'ADMIN';
    case 'ADMIN':
      return role === 'ADMIN';
  }
}

/** The exact status of one call: role first (`403`), then the branch (`404`), else success. */
function expectedStatus(
  entry: BranchFamilyRoute,
  actor: Actor,
  branchId: string | undefined,
): number {
  if (!roleAllowed(entry.access, actor.role)) {
    return 403;
  }
  if (
    entry.target === 'BRANCH' &&
    actor.role !== 'ADMIN' &&
    (branchId === undefined || !actor.branchIds.includes(branchId))
  ) {
    return 404;
  }
  return successStatus(entry.route);
}

/** Every object key of a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('branch scoping of the branch endpoints (A5-T6, kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
  });

  afterAll(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  async function headersOf(actor: Actor): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId: actor.id, role: actor.role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  /** Empty tables, branches A and B, the four users, one zone per branch. */
  async function resetData(): Promise<Seed> {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B] });
    for (const actor of ACTORS) {
      await query(INSERT_USER_SQL, [
        actor.id,
        `fixture-family-${actor.id.slice(-4)}@kd.example`,
        actor.role,
      ]);
      for (const branchId of actor.branchIds) {
        await query(INSERT_STAFF_BRANCH_SQL, [actor.id, branchId]);
      }
    }
    const zone = new Map<string, { id: string; rowVersion: number }>();
    for (const branchId of [BRANCH_A, BRANCH_B]) {
      const [row] = await query<{ id: string; row_version: number }>(INSERT_ZONE_SQL, [branchId]);
      if (row === undefined) {
        throw new Error('fixture zone missing');
      }
      zone.set(branchId, { id: row.id, rowVersion: row.row_version });
    }
    const versions = await query<{ id: string; row_version: number }>(ROW_VERSIONS_SQL);
    return {
      rowVersion: new Map(versions.map((row) => [row.id, row.row_version])),
      zone,
    };
  }

  function methodOf(route: string): string {
    return route.split(' ')[0] ?? 'GET';
  }

  function send(
    route: string,
    request: FamilyRequest,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return client.request(request.path, {
      method: methodOf(route),
      headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
  }

  function requestOf(route: string): (branchId: string, seed: Seed) => FamilyRequest {
    const build = REQUESTS[route];
    if (build === undefined) {
      throw new Error(`No request for ${route} in branches-scoping.int-spec.ts`);
    }
    return build;
  }

  // -------------------------------------------------------------------------------------------
  // 1. The family list
  // -------------------------------------------------------------------------------------------

  describe('the family list', () => {
    it('lists every router route of the family, and only routes the router has', () => {
      const routerKeys = enumerateRouter(testApp.app)
        .routes.filter((route) => isBranchFamilyPath(route.path))
        .map(keyOf);
      const listed = BRANCH_FAMILY_ROUTES.map((entry) => entry.route);

      expect(routerKeys.filter((key) => !listed.includes(key))).toEqual([]);
      expect(listed.filter((key) => !routerKeys.includes(key))).toEqual([]);
      expect(new Set(listed).size).toBe(listed.length);
    });

    it('has a request in this spec for every listed route, and no other', () => {
      const listed = BRANCH_FAMILY_ROUTES.map((entry) => entry.route);

      expect(listed.filter((route) => REQUESTS[route] === undefined)).toEqual([]);
      expect(Object.keys(REQUESTS).filter((route) => !listed.includes(route))).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // 2. The matrix
  // -------------------------------------------------------------------------------------------

  describe.each(BRANCH_FAMILY_ROUTES.map((entry) => [entry.route, entry] as const))(
    '%s',
    (route, entry) => {
      const targets: readonly (string | undefined)[] =
        entry.target === 'BRANCH' ? [BRANCH_A, BRANCH_B] : [undefined];

      it.each(ACTORS.map((actor) => [actor.name, actor] as const))(
        'answers %s with the exact status on each branch',
        async (_name, actor) => {
          for (const branchId of targets) {
            const seed = await resetData();
            const response = await send(
              route,
              requestOf(route)(branchId ?? BRANCH_A, seed),
              await headersOf(actor),
            );
            const expected = expectedStatus(entry, actor, branchId);
            const where = `${actor.name} on ${branchId === BRANCH_B ? 'B' : 'A'}`;

            expect({ where, status: response.status }).toEqual({ where, status: expected });
            if (expected === 403) {
              expect(response.problem?.code).toBe('FORBIDDEN');
              continue;
            }
            if (expected === 404) {
              expect(response.problem?.code).toBe('NOT_FOUND');
              continue;
            }
            // A success body: no deleted* key, and no id of a branch the caller cannot see.
            expect(keysOf(response.body).filter((key) => /deleted/iu.test(key))).toEqual([]);
            if (actor.role !== 'ADMIN') {
              const hidden = [BRANCH_A, BRANCH_B].filter((id) => !actor.branchIds.includes(id));
              const text = JSON.stringify(response.body ?? null);
              expect(hidden.filter((id) => text.includes(id))).toEqual([]);
            }
          }
        },
      );

      if (entry.target === 'LIST') {
        it.each([
          [ADMIN.name, ADMIN, [BRANCH_A, BRANCH_B]],
          [MANAGER_A.name, MANAGER_A, [BRANCH_A]],
          [MANAGER_B.name, MANAGER_B, [BRANCH_B]],
        ] as const)('shows %s exactly their branches', async (_name, actor, visible) => {
          await resetData();
          const response = await client.get(BRANCHES, { headers: await headersOf(actor) });

          expect(response.status).toBe(200);
          const items = (response.body as { items: { id: string }[] }).items;
          expect(sorted(items.map((item) => item.id))).toEqual(sorted(visible));
        });
      }
    },
  );

  describe('without a token', () => {
    it('answers 401 UNAUTHENTICATED on every route of the family', async () => {
      const seed = await resetData();
      const failures: string[] = [];
      for (const entry of BRANCH_FAMILY_ROUTES) {
        const response = await send(entry.route, requestOf(entry.route)(BRANCH_A, seed));
        if (response.status !== 401 || response.problem?.code !== 'UNAUTHENTICATED') {
          failures.push(`${entry.route}: ${response.status} ${response.problem?.code ?? ''}`);
        }
      }

      expect(failures).toEqual([]);
    });
  });

  describe('a soft-deleted branch', () => {
    it('is 404 for every caller the role allows, on every branch route', async () => {
      const seed = await resetData();
      await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [BRANCH_A]);
      const failures: string[] = [];
      for (const entry of BRANCH_FAMILY_ROUTES.filter((item) => item.target === 'BRANCH')) {
        for (const actor of [ADMIN, MANAGER_A, STAFF_A].filter((item) =>
          roleAllowed(entry.access, item.role),
        )) {
          const response = await send(
            entry.route,
            requestOf(entry.route)(BRANCH_A, seed),
            await headersOf(actor),
          );
          if (response.status !== 404 || response.problem?.code !== 'NOT_FOUND') {
            failures.push(`${entry.route} as ${actor.name}: ${response.status}`);
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it('is left out of every list', async () => {
      await resetData();
      await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [BRANCH_A]);

      const asManager = await client.get(BRANCHES, { headers: await headersOf(MANAGER_A) });
      const asAdmin = await client.get(BRANCHES, { headers: await headersOf(ADMIN) });

      expect((asManager.body as { items: unknown[] }).items).toEqual([]);
      expect((asAdmin.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
        BRANCH_B,
      ]);
    });
  });

  describe('a zone of another branch', () => {
    it.each([
      [ADMIN.name, ADMIN],
      [MANAGER_A.name, MANAGER_A],
    ] as const)('is 404 under branch A for %s, and B keeps its zone', async (_name, actor) => {
      const seed = await resetData();
      const zoneB = zoneOf(seed, BRANCH_B);
      const headers = await headersOf(actor);

      const patch = await client.request(`${BRANCHES}/${BRANCH_A}/delivery-zones/${zoneB.id}`, {
        method: 'PATCH',
        headers,
        body: { rowVersion: zoneB.rowVersion, etaMinutes: 35 },
      });
      const remove = await client.request(
        `${BRANCHES}/${BRANCH_A}/delivery-zones/${zoneB.id}?rowVersion=${zoneB.rowVersion}`,
        { method: 'DELETE', headers },
      );

      expect([patch.status, remove.status]).toEqual([404, 404]);
      const rows = await query<{ eta_minutes: number }>(
        'SELECT eta_minutes FROM public.delivery_zones WHERE id = $1',
        [zoneB.id],
      );
      expect(rows).toEqual([{ eta_minutes: 30 }]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // 3. Audit rows
  // -------------------------------------------------------------------------------------------

  describe('audit rows of the family', () => {
    interface AuditRow {
      action: string;
      entity_type: string;
      entity_label: string | null;
      branch_id: string | null;
      diff: unknown;
    }

    /** Paths of every `lat`, `lng` or `location` key in a diff. */
    function coordinatePaths(value: unknown, path = ''): string[] {
      if (typeof value !== 'object' || value === null) {
        return [];
      }
      return Object.entries(value).flatMap(([key, inner]) => {
        const here = path === '' ? key : `${path}.${key}`;
        return [
          ...(['lat', 'lng', 'location'].includes(key) ? [here] : []),
          ...coordinatePaths(inner, here),
        ];
      });
    }

    it('writes exactly the seven codes, each with branch_id, a readable label and no stray coordinates', async () => {
      const seed = await resetData();
      const asAdmin = await headersOf(ADMIN);
      const asManagerA = await headersOf(MANAGER_A);
      const asStaffA = await headersOf(STAFF_A);

      // branch.create
      const created = await client.post(BRANCHES, newBranchBody(), { headers: asAdmin });
      expect(created.status).toBe(201);
      const newBranch = created.body as { id: string; rowVersion: number };
      // branch.location_confirm
      const confirmed = await client.request(`${BRANCHES}/${newBranch.id}`, {
        method: 'PATCH',
        headers: asAdmin,
        body: { rowVersion: newBranch.rowVersion, location: CONFIRMED_PIN },
      });
      expect(confirmed.status).toBe(200);
      // No audit row: a PATCH without location, an hours PUT, a zone check.
      const renamed = await client.request(`${BRANCHES}/${BRANCH_A}`, {
        method: 'PATCH',
        headers: asManagerA,
        body: { rowVersion: versionOf(seed, BRANCH_A), name: 'Chi nhánh mẫu' },
      });
      expect(renamed.status).toBe(200);
      const hours = await client.request(`${BRANCHES}/${BRANCH_A}/hours`, {
        method: 'PUT',
        headers: asManagerA,
        body: {
          rowVersion: (renamed.body as { rowVersion: number }).rowVersion,
          periods: [],
          special: [],
        },
      });
      expect(hours.status).toBe(200);
      const check = await client.post(
        `${BRANCHES}/${BRANCH_A}/delivery-zones/check`,
        { location: CHECK_POINT },
        { headers: asStaffA },
      );
      expect(check.status).toBe(200);
      // branch.pause
      expect(
        (
          await client.post(
            `${BRANCHES}/${BRANCH_A}/pause`,
            { paused: true },
            { headers: asStaffA },
          )
        ).status,
      ).toBe(200);
      // delivery_zone.create, .update, .delete
      const zone = await client.post(`${BRANCHES}/${BRANCH_A}/delivery-zones`, zoneBody(1500), {
        headers: asManagerA,
      });
      expect(zone.status).toBe(201);
      const zoneId = (zone.body as { id: string }).id;
      const zonePatched = await client.request(`${BRANCHES}/${BRANCH_A}/delivery-zones/${zoneId}`, {
        method: 'PATCH',
        headers: asManagerA,
        body: { rowVersion: (zone.body as { rowVersion: number }).rowVersion, etaMinutes: 45 },
      });
      expect(zonePatched.status).toBe(200);
      const zoneRemoved = await client.request(
        `${BRANCHES}/${BRANCH_A}/delivery-zones/${zoneId}?rowVersion=${(zonePatched.body as { rowVersion: number }).rowVersion}`,
        { method: 'DELETE', headers: asManagerA },
      );
      expect(zoneRemoved.status).toBe(204);
      // branch.delete
      const [current] = await query<{ row_version: number }>(
        'SELECT row_version FROM public.branches WHERE id = $1',
        [newBranch.id],
      );
      const deleted = await client.request(
        `${BRANCHES}/${newBranch.id}?rowVersion=${current?.row_version ?? 0}`,
        { method: 'DELETE', headers: asAdmin },
      );
      expect(deleted.status).toBe(204);

      const rows = await query<AuditRow>(
        `SELECT action, entity_type::text AS entity_type, entity_label,
                branch_id::text AS branch_id, diff
           FROM public.audit_logs ORDER BY created_at, id`,
      );

      expect(
        rows.map((row) => [row.action, row.entity_type, row.branch_id, row.entity_label]),
      ).toEqual([
        ['branch.create', 'BRANCH', newBranch.id, 'Chi nhánh Đa Kao'],
        ['branch.location_confirm', 'BRANCH', newBranch.id, 'Chi nhánh Đa Kao'],
        ['branch.pause', 'BRANCH', BRANCH_A, 'Chi nhánh mẫu'],
        ['delivery_zone.create', 'DELIVERY_ZONE', BRANCH_A, 'Vòng 1500 m'],
        ['delivery_zone.update', 'DELIVERY_ZONE', BRANCH_A, 'Vòng 1500 m'],
        ['delivery_zone.delete', 'DELIVERY_ZONE', BRANCH_A, 'Vòng 1500 m'],
        ['branch.delete', 'BRANCH', newBranch.id, 'Chi nhánh Đa Kao'],
      ]);
      for (const row of rows) {
        const paths = coordinatePaths(row.diff);
        if (row.action === 'branch.location_confirm') {
          expect(sorted(paths)).toEqual(
            sorted([
              'location',
              'location.from.lat',
              'location.from.lng',
              'location.to.lat',
              'location.to.lng',
            ]),
          );
          const diff = row.diff as {
            location: { from: { lat: number; lng: number }; to: { lat: number; lng: number } };
          };
          expect(diff.location.from.lat).toBeCloseTo(NEW_PIN.lat, 6);
          expect(diff.location.from.lng).toBeCloseTo(NEW_PIN.lng, 6);
          expect(diff.location.to).toEqual(CONFIRMED_PIN);
        } else {
          expect({ action: row.action, paths }).toEqual({ action: row.action, paths: [] });
        }
        const text = JSON.stringify(row.diff);
        expect(text).not.toContain(String(CHECK_POINT.lat));
        expect(text).not.toContain(String(CHECK_POINT.lng));
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // 4. Privacy
  // -------------------------------------------------------------------------------------------

  describe('privacy', () => {
    it('shows the special-day note to the managers of the branch only', async () => {
      const seed = await resetData();
      const day = addCalendarDays(formatVietnamDate(new Date()), 7);
      const put = await client.request(`${BRANCHES}/${BRANCH_A}/hours`, {
        method: 'PUT',
        headers: await headersOf(ADMIN),
        body: {
          rowVersion: versionOf(seed, BRANCH_A),
          periods: [],
          special: [
            { startsOn: day, endsOn: day, service: 'STORE', isClosed: true, note: INTERNAL_NOTE },
          ],
        },
      });
      expect(put.status).toBe(200);

      const path = `${BRANCHES}/${BRANCH_A}/hours`;
      const asManagerA = await client.get(path, { headers: await headersOf(MANAGER_A) });
      const asStaffA = await client.get(path, { headers: await headersOf(STAFF_A) });
      const asManagerB = await client.get(path, { headers: await headersOf(MANAGER_B) });

      expect(asManagerA.status).toBe(200);
      expect(JSON.stringify(asManagerA.body)).toContain(INTERNAL_NOTE);
      expect([asStaffA.status, asManagerB.status]).toEqual([403, 404]);
      expect(JSON.stringify(asStaffA.body)).not.toContain(INTERNAL_NOTE);
      expect(JSON.stringify(asManagerB.body)).not.toContain(INTERNAL_NOTE);
    });

    it('never echoes the check coordinates in a response or an error body', async () => {
      await resetData();
      const asStaffA = await headersOf(STAFF_A);
      const digits = [String(CHECK_POINT.lat), String(CHECK_POINT.lng)];
      const badLat = 91.123457;

      const success = await client.post(
        `${BRANCHES}/${BRANCH_A}/delivery-zones/check`,
        { location: CHECK_POINT },
        { headers: asStaffA },
      );
      const outside = await client.post(
        `${BRANCHES}/${BRANCH_B}/delivery-zones/check`,
        { location: CHECK_POINT },
        { headers: asStaffA },
      );
      const invalid = await client.post(
        `${BRANCHES}/${BRANCH_A}/delivery-zones/check`,
        { location: { lat: badLat, lng: CHECK_POINT.lng } },
        { headers: asStaffA },
      );

      expect([success.status, outside.status, invalid.status]).toEqual([200, 404, 400]);
      for (const response of [success, outside, invalid]) {
        const text = JSON.stringify(response.body ?? null);
        expect(digits.filter((value) => text.includes(value))).toEqual([]);
        expect(text).not.toContain(String(badLat));
      }
    });
  });
});
