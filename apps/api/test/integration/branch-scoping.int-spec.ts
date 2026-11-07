import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IS_PUBLIC_KEY } from '../../src/common/auth/public.decorator.js';
import { isAdminRoute } from '../../src/common/auth/request-user.js';
import { ROLES_KEY } from '../../src/common/auth/roles.decorator.js';
import { branchScopeMarkerOf } from '../../src/common/branch-scope/branch-scope.decorator.js';
import type { BranchScopeMarker } from '../../src/common/branch-scope/branch-scope.decorator.js';
import { BranchScopeService } from '../../src/common/branch-scope/branch-scope.service.js';
import { ApiError } from '../../src/common/errors/api-error.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { discoverHandlers, enumerateRouter, keyOf } from '../support/route-table.js';
import type { HandlerRoute, RouteEntry } from '../support/route-table.js';
import { scopingCases } from '../support/scoping-matrix.js';
import type { ScopingCase, ScopingFixture, ScopingRequest } from '../support/scoping-matrix.js';
import {
  PROBE_ACTION_ROUTE,
  PROBE_BASE,
  PROBE_GLOBAL_ROUTE,
  PROBE_LIST_ROUTE,
  ScopingProbeModule,
} from '../support/scoping-probe.controller.js';
import type { ProbeListBody } from '../support/scoping-probe.controller.js';
import { truncateAll } from '../support/truncate.js';

// A3-T5, testing-strategy "Branch scoping, enumerated"; api-outline Conventions "Branch scoping".
// Part 1 reads every route of the running app from its router (`support/route-table.ts`, shared
// with `deny-by-default.int-spec.ts`) and requires a branch-scope decision on every staff route:
// every signed-in route under `/api/v1/admin`, and every route elsewhere whose `@Roles` leaves out
// `CUSTOMER`. Part 2 runs each case of `support/scoping-matrix.ts` as STAFF, MANAGER, ADMIN and
// CUSTOMER. Part 3 checks the database reads of `BranchScopeService` (a revoked branch takes
// effect on the next request). Access tokens are signed directly: the guards read the token,
// branch scoping reads PostgreSQL. Fictional data only.

const SESSION_ID = '01930000-0000-7000-8000-0000000015a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000015b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000015b2';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-0000000015bf';

const ADMIN_ID = '01930000-0000-7000-8000-000000001501';
const STAFF_A_ID = '01930000-0000-7000-8000-000000001502';
const MANAGER_A_ID = '01930000-0000-7000-8000-000000001503';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000001504';
const STAFF_AB_ID = '01930000-0000-7000-8000-000000001505';
const STAFF_NONE_ID = '01930000-0000-7000-8000-000000001506';

const USERS: readonly (readonly [string, UserRole, readonly string[]])[] = [
  [ADMIN_ID, 'ADMIN', []],
  [STAFF_A_ID, 'STAFF', [BRANCH_A]],
  [MANAGER_A_ID, 'MANAGER', [BRANCH_A]],
  [CUSTOMER_ID, 'CUSTOMER', []],
  [STAFF_AB_ID, 'STAFF', [BRANCH_A, BRANCH_B]],
  // Breaks the "at least one row" rule on purpose (checked by the API on write, not here).
  [STAFF_NONE_ID, 'STAFF', []],
];

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, 'Người dùng Mẫu', 'vi', $3, 'ACTIVE')`;
const INSERT_STAFF_BRANCH_SQL =
  'INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)';
const DELETE_STAFF_BRANCH_SQL =
  'DELETE FROM public.staff_branches WHERE user_id = $1 AND branch_id = $2';

// ---------------------------------------------------------------------------------------------
// The branch-scope decision of every route
// ---------------------------------------------------------------------------------------------

interface RouteDecision {
  readonly key: string;
  readonly name: string;
  /** Under `/api/v1/admin`. */
  readonly admin: boolean;
  readonly isPublic: boolean;
  readonly roles: readonly UserRole[] | undefined;
  readonly marker: BranchScopeMarker | undefined;
  /** Set when the markers cannot be read (both on one target). */
  readonly markerError: string | undefined;
}

function decisionOf(route: RouteEntry, handler: HandlerRoute, reflector: Reflector): RouteDecision {
  const targets = [handler.handler, handler.controller];
  let marker: BranchScopeMarker | undefined;
  let markerError: string | undefined;
  try {
    marker = branchScopeMarkerOf(reflector, handler.handler, handler.controller);
  } catch (error) {
    markerError = error instanceof Error ? error.message : String(error);
  }
  return {
    key: keyOf(route),
    name: handler.name,
    admin: isAdminRoute(route.path.toLowerCase()),
    isPublic: reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) === true,
    roles: reflector.getAllAndOverride<readonly UserRole[] | undefined>(ROLES_KEY, targets),
    marker,
    markerError,
  };
}

const isAdminOnly = (roles: readonly UserRole[] | undefined): boolean =>
  roles !== undefined && roles.length > 0 && roles.every((role) => role === 'ADMIN');

/**
 * A staff route: signed in (not `@Public()`) and either under `/api/v1/admin` (where a route
 * without `@Roles` is refused to everyone by `RolesGuard`) or limited by `@Roles` to staff roles.
 */
const isStaffRoute = (decision: RouteDecision): boolean =>
  !decision.isPublic &&
  (decision.admin || (decision.roles !== undefined && !decision.roles.includes('CUSTOMER')));

// ---------------------------------------------------------------------------------------------

describe('branch scoping (every route of the real app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;
  let decisions: RouteDecision[];
  const reflector = new Reflector();

  beforeAll(async () => {
    testApp = await createTestApp({ imports: [ScopingProbeModule] });
    client = http(testApp.baseUrl);
    decisions = [];
    const handlers = discoverHandlers(testApp.app, reflector);
    const unmapped: string[] = [];
    for (const route of enumerateRouter(testApp.app).routes) {
      const matches = handlers.filter((handler) => handler.key === keyOf(route));
      const handler = matches[0];
      if (matches.length !== 1 || handler === undefined) {
        unmapped.push(`${keyOf(route)} -> ${matches.length} handlers`);
        continue;
      }
      decisions.push(decisionOf(route, handler, reflector));
    }
    // Every router entry must trace back to exactly one handler, or the table below is incomplete.
    expect(unmapped).toEqual([]);
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function headersOf(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  /** Empty tables, branches A and B, the users of `USERS` and their `staff_branches` rows. */
  async function resetData(): Promise<void> {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B] });
    for (const [id, role, branchIds] of USERS) {
      await query(INSERT_USER_SQL, [id, `fixture-scope-${id.slice(-4)}@kd.example`, role]);
      for (const branchId of branchIds) {
        await query(INSERT_STAFF_BRANCH_SQL, [id, branchId]);
      }
    }
  }

  describe('the route table', () => {
    it('is non-trivial and includes the probe routes', () => {
      const keys = decisions.map((decision) => decision.key);

      expect(keys).toEqual(
        expect.arrayContaining([
          PROBE_LIST_ROUTE,
          PROBE_ACTION_ROUTE,
          PROBE_GLOBAL_ROUTE,
          'GET /api/v1/admin/users',
        ]),
      );
      expect(decisions.filter((decision) => decision.admin).length).toBeGreaterThanOrEqual(8);
    });

    it('treats a staff-only route outside /api/v1/admin as a staff route', () => {
      const recoveryCodes = decisions.find(
        (decision) => decision.key === 'POST /api/v1/me/mfa/recovery-codes',
      );

      expect(recoveryCodes !== undefined && isStaffRoute(recoveryCodes)).toBe(true);
      expect(recoveryCodes?.marker?.kind).toBe('NOT_SCOPED');
    });

    it('gives every staff route @BranchScoped, @NotBranchScoped(reason) or ADMIN only', () => {
      // `@Public()` admin routes (the staff sign-in transport) have no request user to scope.
      const missing = decisions
        .filter(isStaffRoute)
        .filter((decision) => decision.marker === undefined && !isAdminOnly(decision.roles))
        .map((decision) => `${decision.key} (${decision.name})`);

      expect(missing).toEqual([]);
    });

    it('reads every marker without a contradiction', () => {
      const broken = decisions
        .filter((decision) => decision.markerError !== undefined)
        .map((decision) => `${decision.key}: ${decision.markerError ?? ''}`);

      expect(broken).toEqual([]);
    });

    it('keeps @BranchScoped to signed-in staff roles', () => {
      const wrong = decisions
        .filter((decision) => decision.marker?.kind === 'SCOPED')
        .filter(
          (decision) =>
            decision.isPublic ||
            decision.roles === undefined ||
            decision.roles.includes('CUSTOMER'),
        )
        .map((decision) => decision.key);

      expect(wrong).toEqual([]);
    });

    it('has a scoping-matrix case for every @BranchScoped route, of the matching kind', () => {
      const cases = new Map(scopingCases().map((scopingCase) => [scopingCase.route, scopingCase]));
      const failures: string[] = [];
      for (const decision of decisions) {
        if (decision.marker?.kind !== 'SCOPED') {
          continue;
        }
        const scopingCase = cases.get(decision.key);
        const kind = 'query' in decision.marker.options ? 'list' : 'action';
        if (scopingCase === undefined) {
          failures.push(`${decision.key}: no case in scoping-matrix.ts`);
        } else if (scopingCase.kind !== kind) {
          failures.push(`${decision.key}: case is "${scopingCase.kind}", route is "${kind}"`);
        }
      }

      expect(failures).toEqual([]);
    });

    it('has no scoping-matrix case for a route that is not @BranchScoped', () => {
      const scoped = new Set(
        decisions
          .filter((decision) => decision.marker?.kind === 'SCOPED')
          .map((decision) => decision.key),
      );
      const stale = scopingCases()
        .map((scopingCase) => scopingCase.route)
        .filter((route) => !scoped.has(route));

      expect(stale).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // The matrix
  // -------------------------------------------------------------------------------------------

  describe.each(scopingCases().map((scopingCase) => [scopingCase.route, scopingCase] as const))(
    '%s',
    (route, scopingCase: ScopingCase<unknown>) => {
      const [method = 'GET'] = route.split(' ');

      /** Fresh data, then one call of the case as `userId`. */
      async function call(
        userId: string,
        role: UserRole,
        build: (seeded: unknown) => ScopingRequest,
      ): Promise<TestResponse> {
        await resetData();
        const fixture: ScopingFixture = {
          branchA: BRANCH_A,
          branchB: BRANCH_B,
          dataSource: testApp.dataSource,
        };
        const seeded = scopingCase.seed === undefined ? undefined : await scopingCase.seed(fixture);
        const request = build(seeded);
        return client.request(request.path, {
          method,
          headers: await headersOf(userId, role),
          ...(request.body === undefined ? {} : { body: request.body }),
        });
      }

      function expectNotFound(response: TestResponse): void {
        expect({ status: response.status, code: response.problem?.code }).toEqual({
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      function expectSuccess(response: TestResponse): void {
        expect(response.status).toBe(scopingCase.successStatus ?? 200);
      }

      const sorted = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

      if (scopingCase.kind === 'list') {
        const list = scopingCase;
        const callList = (
          userId: string,
          role: UserRole,
          branchIds: readonly string[] | undefined,
        ): Promise<TestResponse> => call(userId, role, (seeded) => list.request(branchIds, seeded));

        it.each([
          ['STAFF', STAFF_A_ID],
          ['MANAGER', MANAGER_A_ID],
        ] as const)('%s of branch A gets NOT_FOUND for branch B', async (role, userId) => {
          expectNotFound(await callList(userId, role, [BRANCH_B]));
          expectNotFound(await callList(userId, role, [BRANCH_A, BRANCH_B]));
        });

        it.each([
          ['STAFF', STAFF_A_ID],
          ['MANAGER', MANAGER_A_ID],
        ] as const)(
          '%s of branch A sees only A, with or without the parameter',
          async (role, userId) => {
            for (const branchIds of [undefined, [BRANCH_A]]) {
              const response = await callList(userId, role, branchIds);

              expectSuccess(response);
              expect(sorted(list.visibleBranchIds(response.body))).toEqual([BRANCH_A]);
            }
          },
        );

        it('ADMIN sees A and B without the parameter, and B alone when asked', async () => {
          const all = await callList(ADMIN_ID, 'ADMIN', undefined);
          expectSuccess(all);
          expect(sorted(list.visibleBranchIds(all.body))).toEqual(sorted([BRANCH_A, BRANCH_B]));

          const onlyB = await callList(ADMIN_ID, 'ADMIN', [BRANCH_B]);
          expectSuccess(onlyB);
          expect(sorted(list.visibleBranchIds(onlyB.body))).toEqual([BRANCH_B]);
        });

        it('refuses a customer with FORBIDDEN', async () => {
          const response = await callList(CUSTOMER_ID, 'CUSTOMER', undefined);

          expect({ status: response.status, code: response.problem?.code }).toEqual({
            status: 403,
            code: 'FORBIDDEN',
          });
        });

        it('answers NOT_FOUND for an unknown branch id, to STAFF and to ADMIN', async () => {
          expectNotFound(await callList(STAFF_A_ID, 'STAFF', [UNKNOWN_BRANCH]));
          expectNotFound(await callList(ADMIN_ID, 'ADMIN', [UNKNOWN_BRANCH]));
        });
      } else {
        const action = scopingCase;
        const callAction = (
          userId: string,
          role: UserRole,
          branchId: string,
        ): Promise<TestResponse> =>
          call(userId, role, (seeded) => action.request(branchId, seeded));

        it.each([
          ['STAFF', STAFF_A_ID],
          ['MANAGER', MANAGER_A_ID],
        ] as const)(
          '%s of branch A gets NOT_FOUND for branch B and acts on A',
          async (role, userId) => {
            expectNotFound(await callAction(userId, role, BRANCH_B));
            expectSuccess(await callAction(userId, role, BRANCH_A));
          },
        );

        it('ADMIN acts on A and on B', async () => {
          expectSuccess(await callAction(ADMIN_ID, 'ADMIN', BRANCH_A));
          expectSuccess(await callAction(ADMIN_ID, 'ADMIN', BRANCH_B));
        });

        it('refuses a customer with FORBIDDEN', async () => {
          const response = await callAction(CUSTOMER_ID, 'CUSTOMER', BRANCH_A);

          expect({ status: response.status, code: response.problem?.code }).toEqual({
            status: 403,
            code: 'FORBIDDEN',
          });
        });

        it('answers NOT_FOUND for an unknown branch, to STAFF and to ADMIN', async () => {
          expectNotFound(await callAction(STAFF_A_ID, 'STAFF', UNKNOWN_BRANCH));
          expectNotFound(await callAction(ADMIN_ID, 'ADMIN', UNKNOWN_BRANCH));
        });
      }
    },
  );

  // -------------------------------------------------------------------------------------------
  // The machinery, through the probe routes and the service
  // -------------------------------------------------------------------------------------------

  describe('machinery', () => {
    async function listAs(
      userId: string,
      role: UserRole,
      search = '',
    ): Promise<{ response: TestResponse; branchIds: string[] }> {
      const response = await client.get(`${PROBE_BASE}/items${search}`, {
        headers: await headersOf(userId, role),
      });
      const body = response.body as ProbeListBody | null;
      return { response, branchIds: (body?.items ?? []).map((item) => item.branchId) };
    }

    it('applies a branch removed from staff_branches on the next request, same token', async () => {
      await resetData();
      const headers = await headersOf(STAFF_AB_ID, 'STAFF');

      const before = await client.get(`${PROBE_BASE}/items`, { headers });
      expect(before.status).toBe(200);
      expect((before.body as ProbeListBody).items.map((item) => item.branchId)).toEqual(
        [BRANCH_A, BRANCH_B].sort(),
      );

      await query(DELETE_STAFF_BRANCH_SQL, [STAFF_AB_ID, BRANCH_B]);

      const after = await client.get(`${PROBE_BASE}/items`, { headers });
      expect(after.status).toBe(200);
      expect((after.body as ProbeListBody).items.map((item) => item.branchId)).toEqual([BRANCH_A]);
      const action = await client.get(`${PROBE_BASE}/branches/${BRANCH_B}`, { headers });
      expect({ status: action.status, code: action.problem?.code }).toEqual({
        status: 404,
        code: 'NOT_FOUND',
      });
    });

    it('applies a branch added to staff_branches on the next request', async () => {
      await resetData();
      const headers = await headersOf(STAFF_A_ID, 'STAFF');

      expect((await client.get(`${PROBE_BASE}/branches/${BRANCH_B}`, { headers })).status).toBe(
        404,
      );
      await query(INSERT_STAFF_BRANCH_SQL, [STAFF_A_ID, BRANCH_B]);

      expect((await client.get(`${PROBE_BASE}/branches/${BRANCH_B}`, { headers })).status).toBe(
        200,
      );
    });

    it('gives a staff user without a row an empty list and NOT_FOUND on every branch', async () => {
      await resetData();

      const { response, branchIds } = await listAs(STAFF_NONE_ID, 'STAFF');
      expect(response.status).toBe(200);
      expect(branchIds).toEqual([]);
      const action = await client.get(`${PROBE_BASE}/branches/${BRANCH_A}`, {
        headers: await headersOf(STAFF_NONE_ID, 'STAFF'),
      });
      expect(action.status).toBe(404);
    });

    it('reads the bracket form branchIds[] too', async () => {
      await resetData();

      const { response, branchIds } = await listAs(
        STAFF_AB_ID,
        'STAFF',
        `?${encodeURIComponent('branchIds[]')}=${BRANCH_B}`,
      );
      expect(response.status).toBe(200);
      expect(branchIds).toEqual([BRANCH_B]);
    });

    it.each([
      ['a non-UUID', '?branchIds=BT'],
      ['an empty value', '?branchIds='],
      ['one bad value among good ones', `?branchIds=${BRANCH_A}&branchIds=x`],
    ])('answers VALIDATION_FAILED on branchIds for %s', async (_case, search) => {
      await resetData();

      const { response } = await listAs(STAFF_A_ID, 'STAFF', search);
      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
      expect(response.problem?.errors).toEqual([
        { field: 'branchIds', code: 'INVALID', message: 'is invalid' },
      ]);
    });

    it('answers VALIDATION_FAILED for a path id that is not a UUID', async () => {
      await resetData();

      const response = await client.get(`${PROBE_BASE}/branches/not-a-uuid`, {
        headers: await headersOf(STAFF_A_ID, 'STAFF'),
      });
      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
    });

    it('opens the @NotBranchScoped route to staff without a branch, not to a customer', async () => {
      await resetData();

      const staff = await client.get(`${PROBE_BASE}/global`, {
        headers: await headersOf(STAFF_NONE_ID, 'STAFF'),
      });
      const customer = await client.get(`${PROBE_BASE}/global`, {
        headers: await headersOf(CUSTOMER_ID, 'CUSTOMER'),
      });

      expect(staff.status).toBe(200);
      expect(customer.status).toBe(403);
    });

    it('keeps staff_branches rows of a soft-deleted branch; the list filters the branch', async () => {
      await resetData();
      await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [BRANCH_B]);
      const scopes = testApp.app.get(BranchScopeService);

      expect(await scopes.resolve({ id: STAFF_AB_ID, role: 'STAFF' })).toEqual({
        kind: 'BRANCHES',
        branchIds: [BRANCH_A, BRANCH_B].sort(),
      });
      expect(await scopes.resolve({ id: ADMIN_ID, role: 'ADMIN' }, [BRANCH_B])).toEqual({
        kind: 'BRANCHES',
        branchIds: [BRANCH_B],
      });
      const { branchIds } = await listAs(STAFF_AB_ID, 'STAFF');
      expect(branchIds).toEqual([BRANCH_A]);
    });

    it('assertBranchAccess reads staff_branches on every call', async () => {
      await resetData();
      const scopes = testApp.app.get(BranchScopeService);
      const staff = { id: STAFF_AB_ID, role: 'STAFF' as const };

      await expect(scopes.assertBranchAccess(staff, BRANCH_B)).resolves.toBe(undefined);
      await expect(
        scopes.assertBranchAccess({ id: ADMIN_ID, role: 'ADMIN' }, BRANCH_B),
      ).resolves.toBe(undefined);
      await query(DELETE_STAFF_BRANCH_SQL, [STAFF_AB_ID, BRANCH_B]);

      const error: unknown = await scopes.assertBranchAccess(staff, BRANCH_B).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('NOT_FOUND');
    });
  });
});
