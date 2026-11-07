import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { GuardedRequest } from '../auth/request-user.js';
import { ApiError } from '../errors/api-error.js';
import { branchScopeMarkerOf } from './branch-scope.decorator.js';
import { BranchScopeService } from './branch-scope.service.js';
import type { BranchScope } from './branch-scope.service.js';

/** The parts of an Express request this guard reads, and the scope it writes. */
export interface BranchScopedRequest extends GuardedRequest {
  readonly query?: unknown;
  readonly params?: Readonly<Record<string, unknown>>;
  branchScope?: BranchScope;
}

/** The canonical 8-4-4-4-12 text form; any value of it casts to PostgreSQL `uuid`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The query keys of the list: `branchIds=a&branchIds=b`, or `branchIds[]=a&branchIds[]=b`. */
const BRANCH_IDS_KEYS = ['branchIds', 'branchIds[]'] as const;

function invalid(field: string): ApiError {
  return new ApiError('VALIDATION_FAILED', {
    errors: [{ field, code: 'INVALID', message: 'is invalid' }],
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * The branch ids of the query, `undefined` when neither key is present. Accepts the shapes of
 * both Express query parsers (`simple`: a string or a string array under `branchIds` or
 * `branchIds[]`; `extended`: an array under `branchIds`). Anything else, an empty value included,
 * is `400 VALIDATION_FAILED` on `branchIds`; the value is never echoed.
 */
export function requestedBranchIdsOf(query: unknown): string[] | undefined {
  const record = (typeof query === 'object' && query !== null ? query : {}) as Readonly<
    Record<string, unknown>
  >;
  const present = BRANCH_IDS_KEYS.filter((key) => record[key] !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  const values: unknown[] = present.flatMap((key) => {
    const value = record[key];
    return Array.isArray(value) ? (value as unknown[]) : [value];
  });
  if (!values.every(isUuid)) {
    throw invalid('branchIds');
  }
  return values;
}

/** The branch id of a path parameter; `400 VALIDATION_FAILED` when it is not a UUID. */
export function requestedBranchIdOf(
  params: Readonly<Record<string, unknown>> | undefined,
  name: string,
): string {
  const value = params?.[name];
  if (!isUuid(value)) {
    throw invalid(name);
  }
  return value;
}

/**
 * Global guard, registered after `RolesGuard` (`AppModule`; A3-T5). On a route marked
 * `@BranchScoped(...)` it reads the requested branches (query or path), resolves them with
 * `BranchScopeService` (a database read of `staff_branches`, never a token claim) and stores the
 * result for `@BranchIds()`; an id outside the caller's branches is `404 NOT_FOUND`.
 *
 * A route without the marker passes untouched (`@NotBranchScoped`, `ADMIN`-only and customer
 * routes). A forgotten marker is caught by the route-enumerating spec
 * (`test/integration/branch-scoping.int-spec.ts`), which fails for every staff route (signed in,
 * and under `/api/v1/admin` or limited by `@Roles` to staff roles) that has none of
 * `@BranchScoped`, `@NotBranchScoped(reason)` or an `ADMIN`-only `@Roles`.
 *
 * A marked route without a request user (a `@Public()` handler, or a non-HTTP context) fails
 * closed with `401 UNAUTHENTICATED`.
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const marker = branchScopeMarkerOf(this.reflector, context.getHandler(), context.getClass());
    if (marker?.kind !== 'SCOPED') {
      return true;
    }
    if (context.getType() !== 'http') {
      throw new ApiError('UNAUTHENTICATED');
    }

    const request = context.switchToHttp().getRequest<BranchScopedRequest>();
    const user = request.user;
    if (user === undefined) {
      throw new ApiError('UNAUTHENTICATED');
    }

    const { options } = marker;
    const requested =
      'query' in options
        ? requestedBranchIdsOf(request.query)
        : [requestedBranchIdOf(request.params, options.param)];
    request.branchScope = await this.scopes.resolve(user, requested);
    return true;
  }
}
