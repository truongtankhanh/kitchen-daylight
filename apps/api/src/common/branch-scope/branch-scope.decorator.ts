import { SetMetadata } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

export const BRANCH_SCOPED_KEY = 'kd:branch-scope:scoped';
export const NOT_BRANCH_SCOPED_KEY = 'kd:branch-scope:not-scoped';

/**
 * Where `BranchScopeGuard` reads the requested branches (api-outline, Conventions, "Branch
 * scoping"):
 *
 * - `{ query: 'branchIds' }`: list and count routes. The query `branchIds` (repeated, or
 *   `branchIds[]`), each a UUID; absent means every branch of the caller. A query DTO of the route
 *   must declare `branchIds` too, or the global validation pipe refuses it as unknown.
 * - `{ param: 'id' }` or `{ param: 'branchId' }`: an action on one branch, the path parameter of
 *   that name being the branch id.
 */
export type BranchScopedOptions =
  { readonly query: 'branchIds' } | { readonly param: 'id' | 'branchId' };

/** The scoping a route declares, the handler's marker winning over its controller's. */
export type BranchScopeMarker =
  | { readonly kind: 'SCOPED'; readonly options: BranchScopedOptions }
  | { readonly kind: 'NOT_SCOPED'; readonly reason: string };

function assertOptions(options: BranchScopedOptions): void {
  const hasQuery = 'query' in options;
  const hasParam = 'param' in options;
  if (hasQuery === hasParam) {
    throw new Error('@BranchScoped() takes exactly one of `query` or `param`.');
  }
}

/**
 * Filters a staff route by the caller's `staff_branches` (A3-T5): `BranchScopeGuard` resolves
 * the branches and `@BranchIds()` hands them to the handler. A branch outside the caller's set is
 * `404 NOT_FOUND`, never `403`. Every `@BranchScoped` route needs a case in
 * `test/support/scoping-matrix.ts`; `branch-scoping.int-spec.ts` fails without one.
 */
export function BranchScoped(options: BranchScopedOptions): ClassDecorator & MethodDecorator {
  assertOptions(options);
  return SetMetadata(BRANCH_SCOPED_KEY, Object.freeze({ ...options }));
}

/**
 * Declares a staff route deliberately global (it reads no branch data, or
 * every branch by design). The reason is mandatory and appears in the route table of
 * `branch-scoping.int-spec.ts`; an `ADMIN`-only route needs neither marker.
 */
export function NotBranchScoped(reason: string): ClassDecorator & MethodDecorator {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed === '') {
    throw new Error('@NotBranchScoped() needs a reason.');
  }
  return SetMetadata(NOT_BRANCH_SCOPED_KEY, trimmed);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- a route handler.
type MetadataTarget = Type<unknown> | Function;

function markerOn(reflector: Reflector, target: MetadataTarget): BranchScopeMarker | undefined {
  const options = reflector.get<BranchScopedOptions | undefined>(BRANCH_SCOPED_KEY, target);
  const reason = reflector.get<string | undefined>(NOT_BRANCH_SCOPED_KEY, target);
  if (options !== undefined && reason !== undefined) {
    throw new Error('A route cannot be both @BranchScoped() and @NotBranchScoped().');
  }
  if (options !== undefined) {
    return { kind: 'SCOPED', options };
  }
  if (reason !== undefined) {
    return { kind: 'NOT_SCOPED', reason };
  }
  return undefined;
}

/**
 * The marker of a handler, else of its controller, else `undefined`. Both markers on the same
 * handler or controller is a programming error: it throws (a `500` at run time, a failure in the
 * enumerating spec).
 */
export function branchScopeMarkerOf(
  reflector: Reflector,
  handler: MetadataTarget,
  controller: MetadataTarget,
): BranchScopeMarker | undefined {
  return markerOn(reflector, handler) ?? markerOn(reflector, controller);
}
