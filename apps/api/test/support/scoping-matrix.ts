import type { DataSource } from 'typeorm';

import { PROBE_ACTION_ROUTE, PROBE_BASE, PROBE_LIST_ROUTE } from './scoping-probe.controller.js';
import type { ProbeListBody } from './scoping-probe.controller.js';

/*
 * The branch-scoping matrix (A3-T5; testing-strategy "Branch scoping, enumerated").
 *
 * `branch-scoping.int-spec.ts` reads every route of the running app from its router and fails for
 * every `@BranchScoped` route without a case here, and for every case whose route is not
 * `@BranchScoped`. For each case it then checks, against real PostgreSQL, that a `STAFF` and a
 * `MANAGER` of branch A get `404 NOT_FOUND` for branch B and see only A without a parameter, that
 * `ADMIN` sees A and B, that a customer gets `403 FORBIDDEN`, and that an unknown id is `404`.
 *
 * How to add a case (one per `@BranchScoped` route, in the slice that adds the route):
 *
 * 1. Add one `registerScopingCase({...})` call in the "Cases" section at the end of this file,
 *    under a comment naming the task.
 * 2. `route`: `METHOD /api/v1/...` exactly as the router registers it, path parameters as `:name`
 *    (for example `GET /api/v1/admin/orders` or `PATCH /api/v1/admin/orders/:id`).
 * 3. `kind`: `list` for `@BranchScoped({ query: 'branchIds' })`, `action` for
 *    `@BranchScoped({ param })`.
 * 4. `seed` (optional): inserts the records the route reads, one or more in branch A and in branch
 *    B, through `fixture.dataSource` (`kd_app`); its result is handed to `request`. The spec
 *    empties the database and inserts branches A and B and the users before every call, so a case
 *    may change data.
 * 5. `request`: the path (with its query) and the JSON body of one call.
 *    - `list`: `branchIds` is `undefined` (no parameter) or the ids to send; use `branchIdsQuery`.
 *    - `action`: `branchId` is A, B, or an id no branch has; return the path of the record of that
 *      branch from the seed (for an unknown branch, an id no record has).
 * 6. `visibleBranchIds` (`list` only): the branch of every item of a success body.
 * 7. `successStatus`: when a success is not `200`.
 *
 * Never register the same route twice; never leave a case for a route that was removed.
 */

/** What a case's `seed` receives. */
export interface ScopingFixture {
  readonly branchA: string;
  readonly branchB: string;
  /** The app's own `DataSource`, as `kd_app`. */
  readonly dataSource: DataSource;
}

/** One call of a case; the method is the one of `route`. */
export interface ScopingRequest {
  readonly path: string;
  readonly body?: unknown;
}

interface ScopingCaseBase<Seed> {
  /** `METHOD /api/v1/...`, as the router registers it. */
  readonly route: string;
  readonly seed?: (fixture: ScopingFixture) => Promise<Seed>;
  /** Default `200`. */
  readonly successStatus?: number;
}

export interface ListScopingCase<Seed = undefined> extends ScopingCaseBase<Seed> {
  readonly kind: 'list';
  request(branchIds: readonly string[] | undefined, seeded: Seed): ScopingRequest;
  visibleBranchIds(body: unknown): readonly string[];
}

export interface ActionScopingCase<Seed = undefined> extends ScopingCaseBase<Seed> {
  readonly kind: 'action';
  request(branchId: string, seeded: Seed): ScopingRequest;
}

export type ScopingCase<Seed = undefined> = ListScopingCase<Seed> | ActionScopingCase<Seed>;

const ROUTE_FORMAT = /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/\S+$/;

const cases = new Map<string, ScopingCase<unknown>>();

/** Adds the case of one `@BranchScoped` route. Throws on a malformed or repeated route. */
export function registerScopingCase<Seed = undefined>(scopingCase: ScopingCase<Seed>): void {
  if (!ROUTE_FORMAT.test(scopingCase.route)) {
    throw new Error(`Scoping case route must be "METHOD /api/v1/...": ${scopingCase.route}`);
  }
  if (cases.has(scopingCase.route)) {
    throw new Error(`Scoping case registered twice: ${scopingCase.route}`);
  }
  // The seed type is private to the case: the spec hands `request` what `seed` returned.
  cases.set(scopingCase.route, scopingCase as unknown as ScopingCase<unknown>);
}

/** Every registered case, in registration order. */
export function scopingCases(): readonly ScopingCase<unknown>[] {
  return [...cases.values()];
}

/** `?branchIds=a&branchIds=b`, or the empty string for `undefined`. */
export function branchIdsQuery(branchIds: readonly string[] | undefined): string {
  if (branchIds === undefined) {
    return '';
  }
  const query = new URLSearchParams();
  branchIds.forEach((id) => query.append('branchIds', id));
  return `?${query.toString()}`;
}

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

// A3-T5: the test-only probe routes (`scoping-probe.controller.ts`), mounted by the spec only.
registerScopingCase({
  route: PROBE_LIST_ROUTE,
  kind: 'list',
  request: (branchIds) => ({ path: `${PROBE_BASE}/items${branchIdsQuery(branchIds)}` }),
  visibleBranchIds: (body) => (body as ProbeListBody).items.map((item) => item.branchId),
});

registerScopingCase({
  route: PROBE_ACTION_ROUTE,
  kind: 'action',
  request: (branchId) => ({ path: `${PROBE_BASE}/branches/${branchId}` }),
});

// A4-T2: `GET /api/v1/admin/meta/config` takes no branch parameter and is `@NotBranchScoped(reason)`
// (it lists the caller's own branches through `BranchScopeService`), so it has no case here: a case
// for a route that is not `@BranchScoped` fails the spec. `branch-scoping.int-spec.ts` lists it with
// its reason in the route table; `admin-settings.int-spec.ts` checks its branches per role.

// ---------------------------------------------------------------------------------------------
// A5-T6: the branch family (`/api/v1/admin/branches*`, `/api/v1/admin/wards`)
// ---------------------------------------------------------------------------------------------

// These routes are `@NotBranchScoped(reason)` and scoped in their services through
// `BranchScopeService` (api-divergences D-132, D-147): most of them are manager-only, which the
// generic matrix above (a `STAFF` of branch A succeeds on every case) cannot express. They are
// listed here instead, with the role set that may call them, and
// `branches-scoping.int-spec.ts` (A5-T6) fails for a route of the family that the router has and
// this list lacks, for an entry the router does not have, and for an entry without a request in
// that spec. It then asserts the exact status of every route for ADMIN, the MANAGER of A, the
// STAFF of A and the MANAGER of B. A new route under these paths is added here, in the slice
// that adds it, together with its request in that spec.

/** Who may call a family route before branch scoping: the `@Roles` set of api-outline. */
export type BranchFamilyAccess = 'STAFF' | 'MANAGER' | 'ADMIN';

/**
 * - `BRANCH`: an action on the branch of the path `:id` (`404` outside the caller's branches).
 * - `LIST`: the caller's branches only.
 * - `NONE`: reads or writes no existing branch (create, reference data).
 */
export type BranchFamilyTarget = 'BRANCH' | 'LIST' | 'NONE';

export interface BranchFamilyRoute {
  /** `METHOD /api/v1/...`, as the router registers it. */
  readonly route: string;
  readonly access: BranchFamilyAccess;
  readonly target: BranchFamilyTarget;
}

/** The paths of the family: the route itself or anything below it. */
export const BRANCH_FAMILY_PATHS: readonly string[] = [
  '/api/v1/admin/branches',
  '/api/v1/admin/wards',
];

/** True for a registered path of the family. */
export function isBranchFamilyPath(path: string): boolean {
  return BRANCH_FAMILY_PATHS.some((base) => path === base || path.startsWith(`${base}/`));
}

export const BRANCH_FAMILY_ROUTES: readonly BranchFamilyRoute[] = [
  // A5-T2
  { route: 'GET /api/v1/admin/branches', access: 'MANAGER', target: 'LIST' },
  { route: 'POST /api/v1/admin/branches', access: 'ADMIN', target: 'NONE' },
  { route: 'GET /api/v1/admin/branches/:id', access: 'MANAGER', target: 'BRANCH' },
  { route: 'PATCH /api/v1/admin/branches/:id', access: 'MANAGER', target: 'BRANCH' },
  { route: 'DELETE /api/v1/admin/branches/:id', access: 'ADMIN', target: 'BRANCH' },
  // A5-T3
  { route: 'GET /api/v1/admin/branches/:id/hours', access: 'MANAGER', target: 'BRANCH' },
  { route: 'PUT /api/v1/admin/branches/:id/hours', access: 'MANAGER', target: 'BRANCH' },
  // A5-T4
  { route: 'GET /api/v1/admin/branches/:id/delivery-zones', access: 'MANAGER', target: 'BRANCH' },
  { route: 'POST /api/v1/admin/branches/:id/delivery-zones', access: 'MANAGER', target: 'BRANCH' },
  {
    route: 'POST /api/v1/admin/branches/:id/delivery-zones/check',
    access: 'STAFF',
    target: 'BRANCH',
  },
  {
    route: 'PATCH /api/v1/admin/branches/:id/delivery-zones/:zoneId',
    access: 'MANAGER',
    target: 'BRANCH',
  },
  {
    route: 'DELETE /api/v1/admin/branches/:id/delivery-zones/:zoneId',
    access: 'MANAGER',
    target: 'BRANCH',
  },
  // A5-T5
  { route: 'POST /api/v1/admin/branches/:id/pause', access: 'STAFF', target: 'BRANCH' },
  { route: 'GET /api/v1/admin/wards', access: 'STAFF', target: 'NONE' },
];
