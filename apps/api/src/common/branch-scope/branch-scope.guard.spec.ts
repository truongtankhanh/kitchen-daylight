import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import type { UserRole } from '../../modules/users/entities/user.entity.js';
import { Public } from '../auth/public.decorator.js';
import { httpContext, requestOn } from '../auth/testing.js';
import type { FakeRoute } from '../auth/testing.js';
import { ApiError } from '../errors/api-error.js';
import { BranchScoped, NotBranchScoped } from './branch-scope.decorator.js';
import {
  BranchScopeGuard,
  requestedBranchIdOf,
  requestedBranchIdsOf,
} from './branch-scope.guard.js';
import type { BranchScopedRequest } from './branch-scope.guard.js';
import type { BranchScope, BranchScopeService, ScopedUser } from './branch-scope.service.js';

const USER_ID = '01930000-0000-7000-8000-00000000b7a1';
const SESSION_ID = '01930000-0000-7000-8000-00000000b7a2';
const BRANCH_A = '01930000-0000-7000-8000-00000000b7b1';
const BRANCH_B = '01930000-0000-7000-8000-00000000b7b2';

@Controller('admin/things')
class ThingsController {
  @BranchScoped({ query: 'branchIds' })
  @Get()
  list(): void {}

  @BranchScoped({ param: 'id' })
  @Get(':id')
  one(): void {}

  @BranchScoped({ param: 'branchId' })
  @Get('branches/:branchId')
  byBranch(): void {}

  @NotBranchScoped('Reads no branch data.')
  @Get('global')
  global(): void {}

  @Get('unmarked')
  unmarked(): void {}

  @Public()
  @BranchScoped({ query: 'branchIds' })
  @Get('public')
  open(): void {}
}

function route(handler: FakeRoute['handler']): FakeRoute {
  return { controller: ThingsController, handler };
}

const LIST = route(ThingsController.prototype.list);
const ONE = route(ThingsController.prototype.one);
const BY_BRANCH = route(ThingsController.prototype.byBranch);
const GLOBAL = route(ThingsController.prototype.global);
const UNMARKED = route(ThingsController.prototype.unmarked);
const PUBLIC = route(ThingsController.prototype.open);

interface ResolveCall {
  readonly user: ScopedUser;
  readonly requested: readonly string[] | undefined;
}

/** A `BranchScopeService` that records `resolve` and answers `scope`. */
function fakeScopes(scope: BranchScope = { kind: 'ALL' }): {
  calls: ResolveCall[];
  guard: BranchScopeGuard;
} {
  const calls: ResolveCall[] = [];
  const scopes = {
    resolve: (user: ScopedUser, requested?: readonly string[]): Promise<BranchScope> => {
      calls.push({ user, requested });
      return Promise.resolve(scope);
    },
  } as unknown as BranchScopeService;
  return { calls, guard: new BranchScopeGuard(new Reflector(), scopes) };
}

function signedIn(
  role: UserRole,
  init: { query?: unknown; params?: Record<string, unknown> } = {},
): BranchScopedRequest {
  return {
    ...requestOn('/api/v1/admin/things'),
    user: { id: USER_ID, role, sessionId: SESSION_ID },
    ...init,
  };
}

async function expectValidationFailed(work: Promise<unknown>, field: string): Promise<void> {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe('VALIDATION_FAILED');
  expect((error as ApiError).errors).toEqual([{ field, code: 'INVALID', message: 'is invalid' }]);
}

describe('BranchScopeGuard', () => {
  it('resolves a list route without branchIds as the whole set and stores the scope', async () => {
    const scope: BranchScope = { kind: 'BRANCHES', branchIds: [BRANCH_A] };
    const { calls, guard } = fakeScopes(scope);
    const request = signedIn('STAFF', { query: {} });

    await expect(guard.canActivate(httpContext(LIST, request))).resolves.toBe(true);

    expect(calls).toEqual([{ user: request.user, requested: undefined }]);
    expect(request.branchScope).toBe(scope);
  });

  it('passes the requested branchIds of a list route', async () => {
    const { calls, guard } = fakeScopes();
    const request = signedIn('MANAGER', { query: { branchIds: [BRANCH_A, BRANCH_B] } });

    await guard.canActivate(httpContext(LIST, request));

    expect(calls[0]?.requested).toEqual([BRANCH_A, BRANCH_B]);
  });

  it.each([
    ['id', ONE, { id: BRANCH_B }],
    ['branchId', BY_BRANCH, { branchId: BRANCH_B }],
  ] as const)('passes the path parameter %s of an action route', async (_name, target, params) => {
    const { calls, guard } = fakeScopes();
    const request = signedIn('STAFF', { params });

    await guard.canActivate(httpContext(target, request));

    expect(calls[0]?.requested).toEqual([BRANCH_B]);
  });

  it('refuses a path parameter that is not a UUID before any database read', async () => {
    const { calls, guard } = fakeScopes();

    await expectValidationFailed(
      guard.canActivate(httpContext(ONE, signedIn('STAFF', { params: { id: 'not-a-uuid' } }))),
      'id',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a bad branchIds value before any database read', async () => {
    const { calls, guard } = fakeScopes();

    await expectValidationFailed(
      guard.canActivate(
        httpContext(LIST, signedIn('STAFF', { query: { branchIds: [BRANCH_A, 'nope'] } })),
      ),
      'branchIds',
    );
    expect(calls).toEqual([]);
  });

  it.each([
    ['a @NotBranchScoped route', GLOBAL],
    ['an unmarked route', UNMARKED],
  ])('leaves %s untouched', async (_case, target) => {
    const { calls, guard } = fakeScopes();
    const request = signedIn('STAFF');

    await expect(guard.canActivate(httpContext(target, request))).resolves.toBe(true);
    expect(calls).toEqual([]);
    expect(request.branchScope).toBeUndefined();
  });

  it('fails closed with UNAUTHENTICATED on a marked route without a request user', async () => {
    const { calls, guard } = fakeScopes();

    await expect(
      guard.canActivate(httpContext(PUBLIC, requestOn('/api/v1/admin/things/public'))),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      guard.canActivate(httpContext(LIST, signedIn('STAFF'), {}, 'ws')),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toEqual([]);
  });

  it('propagates NOT_FOUND from the service', async () => {
    const scopes = {
      resolve: (): Promise<BranchScope> => Promise.reject(new ApiError('NOT_FOUND')),
    } as unknown as BranchScopeService;
    const guard = new BranchScopeGuard(new Reflector(), scopes);

    await expect(
      guard.canActivate(httpContext(ONE, signedIn('STAFF', { params: { id: BRANCH_B } }))),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('requestedBranchIdsOf', () => {
  it('is undefined without the parameter', () => {
    expect(requestedBranchIdsOf({})).toBeUndefined();
    expect(requestedBranchIdsOf(undefined)).toBeUndefined();
    expect(requestedBranchIdsOf({ other: BRANCH_A })).toBeUndefined();
  });

  it.each([
    ['one value', { branchIds: BRANCH_A }, [BRANCH_A]],
    ['a repeated key', { branchIds: [BRANCH_A, BRANCH_B] }, [BRANCH_A, BRANCH_B]],
    ['the bracket key', { 'branchIds[]': [BRANCH_A, BRANCH_B] }, [BRANCH_A, BRANCH_B]],
    ['one bracket value', { 'branchIds[]': BRANCH_B }, [BRANCH_B]],
    ['both keys', { branchIds: BRANCH_A, 'branchIds[]': BRANCH_B }, [BRANCH_A, BRANCH_B]],
  ])('reads %s', (_case, query, expected) => {
    expect(requestedBranchIdsOf(query)).toEqual(expected);
  });

  it.each([
    ['an empty value', { branchIds: '' }],
    ['a non-UUID', { branchIds: 'BT' }],
    ['a comma list', { branchIds: `${BRANCH_A},${BRANCH_B}` }],
    ['a nested object', { branchIds: { 0: BRANCH_A } }],
    ['a non-string item', { branchIds: [BRANCH_A, 1] }],
  ])('refuses %s with VALIDATION_FAILED on branchIds', (_case, query) => {
    expect(() => requestedBranchIdsOf(query)).toThrow(ApiError);
    try {
      requestedBranchIdsOf(query);
    } catch (error) {
      expect((error as ApiError).code).toBe('VALIDATION_FAILED');
      expect((error as ApiError).errors).toEqual([
        { field: 'branchIds', code: 'INVALID', message: 'is invalid' },
      ]);
    }
  });
});

describe('requestedBranchIdOf', () => {
  it('returns a UUID parameter', () => {
    expect(requestedBranchIdOf({ id: BRANCH_A }, 'id')).toBe(BRANCH_A);
  });

  it.each([undefined, {}, { id: 'x' }, { id: [BRANCH_A] }])(
    'refuses %j with VALIDATION_FAILED',
    (params) => {
      expect(() => requestedBranchIdOf(params, 'id')).toThrow(ApiError);
    },
  );
});
