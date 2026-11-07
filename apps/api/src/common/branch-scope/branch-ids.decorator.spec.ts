import { describe, expect, it } from 'vitest';

import { httpContext, requestOn } from '../auth/testing.js';
import { branchScopeOf } from './branch-ids.decorator.js';
import type { BranchScopedRequest } from './branch-scope.guard.js';

const BRANCH_A = '01930000-0000-7000-8000-00000000b6b1';

class AnyController {
  handle(): void {}
}

const ROUTE = { controller: AnyController, handler: AnyController.prototype.handle };

describe('branchScopeOf (@BranchIds)', () => {
  it('returns the scope the guard stored', () => {
    const request: BranchScopedRequest = {
      ...requestOn('/api/v1/admin/things'),
      branchScope: { kind: 'BRANCHES', branchIds: [BRANCH_A] },
    };

    expect(branchScopeOf(httpContext(ROUTE, request))).toEqual({
      kind: 'BRANCHES',
      branchIds: [BRANCH_A],
    });
  });

  it('throws rather than hand the handler an unfiltered default', () => {
    expect(() => branchScopeOf(httpContext(ROUTE, requestOn('/api/v1/admin/things')))).toThrow(
      /@BranchScoped/,
    );
  });
});
