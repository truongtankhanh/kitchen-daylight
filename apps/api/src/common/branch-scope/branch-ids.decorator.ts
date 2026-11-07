import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { BranchScopedRequest } from './branch-scope.guard.js';
import type { BranchScope } from './branch-scope.service.js';

/**
 * The scope `BranchScopeGuard` resolved for the request. Without one (the route lacks
 * `@BranchScoped()`, or the guard did not run) it throws rather than hand the handler an
 * unfiltered default: a `500`, caught by the route's scoping-matrix case.
 */
export function branchScopeOf(context: ExecutionContext): BranchScope {
  const scope = context.switchToHttp().getRequest<BranchScopedRequest>().branchScope;
  if (scope === undefined) {
    throw new Error('@BranchIds() needs @BranchScoped() on the route.');
  }
  return scope;
}

/** `@BranchIds() scope: BranchScope`: the branches the caller may see on this request. */
export const BranchIds = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  branchScopeOf(context),
);
