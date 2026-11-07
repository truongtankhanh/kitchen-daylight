import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import {
  assertNotSelfChange,
  changedAccessFields,
  customerFieldErrors,
  escapeLike,
  leavesNoActiveAdmin,
  resolvedStatus,
  rolesOf,
  sameIdSet,
  sessionEffectsOf,
  statusAuditAction,
} from './admin-users.service.js';
import type { AccessState } from './admin-users.service.js';

// A3-T4: the guard and side-effect rules of admin user management, as pure functions. The
// database paths are in `admin-users.int-spec.ts`. Fictional ids only.

const ADMIN_ID = '01930000-0000-7000-8000-000000001201';
const OTHER_ID = '01930000-0000-7000-8000-000000001202';
const BRANCH_A = '01930000-0000-7000-8000-0000000012b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000012b2';

const ACTIVE_ADMIN: AccessState = { role: 'ADMIN', status: 'ACTIVE' };
const ACTIVE_STAFF: AccessState = { role: 'STAFF', status: 'ACTIVE' };

function codeOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof ApiError ? error.code : 'not an ApiError';
  }
}

describe('sameIdSet', () => {
  it('ignores order and compares membership', () => {
    expect(sameIdSet([BRANCH_A, BRANCH_B], [BRANCH_B, BRANCH_A])).toBe(true);
    expect(sameIdSet([BRANCH_A], [BRANCH_A, BRANCH_B])).toBe(false);
    expect(sameIdSet([], [])).toBe(true);
  });
});

describe('changedAccessFields', () => {
  it('lists only the fields whose value changes', () => {
    expect(changedAccessFields(ACTIVE_STAFF, [BRANCH_A], {})).toEqual([]);
    expect(
      changedAccessFields(ACTIVE_STAFF, [BRANCH_A], {
        role: 'STAFF',
        status: 'ACTIVE',
        branchIds: [BRANCH_A],
        displayName: 'Tên mới',
      }),
    ).toEqual([]);
    expect(
      changedAccessFields(ACTIVE_STAFF, [BRANCH_A], {
        role: 'MANAGER',
        status: 'SUSPENDED',
        branchIds: [BRANCH_B],
      }),
    ).toEqual(['role', 'status', 'branchIds']);
  });

  it('ignores branches for an admin, who uses none', () => {
    expect(changedAccessFields(ACTIVE_ADMIN, [], { branchIds: [BRANCH_A] })).toEqual([]);
    expect(
      changedAccessFields(ACTIVE_STAFF, [BRANCH_A], { role: 'ADMIN', branchIds: [BRANCH_B] }),
    ).toEqual(['role']);
  });
});

describe('assertNotSelfChange', () => {
  it('refuses an admin changing their own role, status or branches', () => {
    expect(codeOf(() => assertNotSelfChange(ADMIN_ID, ADMIN_ID, ['role']))).toBe('SELF_CHANGE');
    expect(codeOf(() => assertNotSelfChange(ADMIN_ID, ADMIN_ID, ['status']))).toBe('SELF_CHANGE');
    expect(codeOf(() => assertNotSelfChange(ADMIN_ID, ADMIN_ID, ['branchIds']))).toBe(
      'SELF_CHANGE',
    );
  });

  it('allows a change of another user and an own change of nothing guarded', () => {
    expect(codeOf(() => assertNotSelfChange(ADMIN_ID, OTHER_ID, ['role']))).toBeNull();
    expect(codeOf(() => assertNotSelfChange(ADMIN_ID, ADMIN_ID, []))).toBeNull();
  });
});

describe('leavesNoActiveAdmin', () => {
  it.each([
    [{ role: 'STAFF', status: 'ACTIVE' }, 1, true],
    [{ role: 'ADMIN', status: 'SUSPENDED' }, 1, true],
    [{ role: 'MANAGER', status: 'ACTIVE' }, 2, false],
    [{ role: 'ADMIN', status: 'ACTIVE' }, 1, false],
  ] as const)('demoting the active admin to %j with %i active is %s', (after, count, expected) => {
    expect(leavesNoActiveAdmin(ACTIVE_ADMIN, after, count)).toBe(expected);
  });

  it('never applies to an account that is not an active admin', () => {
    expect(leavesNoActiveAdmin(ACTIVE_STAFF, { role: 'STAFF', status: 'SUSPENDED' }, 0)).toBe(
      false,
    );
    expect(leavesNoActiveAdmin({ role: 'ADMIN', status: 'SUSPENDED' }, ACTIVE_STAFF, 0)).toBe(
      false,
    );
  });
});

describe('sessionEffectsOf', () => {
  it('a role change revokes every session and emits session.revoked', () => {
    expect(sessionEffectsOf(ACTIVE_STAFF, { role: 'MANAGER', status: 'ACTIVE' })).toEqual({
      revokeSessions: true,
      events: ['session.revoked'],
    });
  });

  it('a suspension revokes and emits user.suspended', () => {
    expect(sessionEffectsOf(ACTIVE_STAFF, { role: 'STAFF', status: 'SUSPENDED' })).toEqual({
      revokeSessions: true,
      events: ['user.suspended'],
    });
  });

  it('a role change with a suspension emits both', () => {
    expect(sessionEffectsOf(ACTIVE_ADMIN, { role: 'STAFF', status: 'SUSPENDED' }).events).toEqual([
      'session.revoked',
      'user.suspended',
    ]);
  });

  it('re-enabling, an unchanged role and a branch change end nothing', () => {
    const none = { revokeSessions: false, events: [] };
    expect(sessionEffectsOf({ role: 'STAFF', status: 'SUSPENDED' }, ACTIVE_STAFF)).toEqual(none);
    expect(sessionEffectsOf(ACTIVE_STAFF, ACTIVE_STAFF)).toEqual(none);
    expect(
      sessionEffectsOf(
        { role: 'STAFF', status: 'SUSPENDED' },
        { role: 'STAFF', status: 'SUSPENDED' },
      ),
    ).toEqual(none);
  });
});

describe('customerFieldErrors', () => {
  it('accepts status only for a customer account', () => {
    expect(customerFieldErrors({ status: 'SUSPENDED' })).toEqual([]);
    expect(
      customerFieldErrors({ displayName: 'Tên', role: 'STAFF', branchIds: [BRANCH_A] }).map(
        ({ field, code }) => ({ field, code }),
      ),
    ).toEqual([
      { field: 'displayName', code: 'INVALID' },
      { field: 'role', code: 'INVALID' },
      { field: 'branchIds', code: 'INVALID' },
    ]);
  });
});

describe('statusAuditAction', () => {
  it('maps a suspension to user.disable and a re-activation to user.enable', () => {
    expect(statusAuditAction('ACTIVE', 'SUSPENDED')).toBe('user.disable');
    expect(statusAuditAction('INVITED', 'SUSPENDED')).toBe('user.disable');
    expect(statusAuditAction('SUSPENDED', 'ACTIVE')).toBe('user.enable');
    expect(statusAuditAction('ACTIVE', 'ACTIVE')).toBeNull();
  });
});

describe('rolesOf', () => {
  it('is every role by default and the intersection of role, roles and scope', () => {
    expect(rolesOf({})).toEqual(['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN']);
    expect(rolesOf({ scope: 'staff' })).toEqual(['STAFF', 'MANAGER', 'ADMIN']);
    expect(rolesOf({ roles: ['MANAGER', 'CUSTOMER'], scope: 'staff' })).toEqual(['MANAGER']);
    expect(rolesOf({ role: 'CUSTOMER', scope: 'staff' })).toEqual([]);
    expect(rolesOf({ role: 'ADMIN', roles: ['ADMIN', 'STAFF'] })).toEqual(['ADMIN']);
  });
});

describe('escapeLike', () => {
  it('takes LIKE wildcards and the escape character literally', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeLike('An Nhiên')).toBe('An Nhiên');
  });
});

describe('resolvedStatus', () => {
  it('reinstates the invitation when a never-activated staff account is re-enabled', () => {
    expect(
      resolvedStatus({ role: 'STAFF', status: 'SUSPENDED', hasPassword: false }, 'ACTIVE'),
    ).toBe('INVITED');
    expect(
      resolvedStatus({ role: 'ADMIN', status: 'SUSPENDED', hasPassword: false }, 'ACTIVE'),
    ).toBe('INVITED');
  });

  it('keeps the requested status otherwise', () => {
    expect(
      resolvedStatus({ role: 'STAFF', status: 'SUSPENDED', hasPassword: true }, 'ACTIVE'),
    ).toBe('ACTIVE');
    // A customer signed in with Google or Apple has no password and is re-enabled as is.
    expect(
      resolvedStatus({ role: 'CUSTOMER', status: 'SUSPENDED', hasPassword: false }, 'ACTIVE'),
    ).toBe('ACTIVE');
    expect(
      resolvedStatus({ role: 'STAFF', status: 'INVITED', hasPassword: false }, 'SUSPENDED'),
    ).toBe('SUSPENDED');
    expect(resolvedStatus({ role: 'STAFF', status: 'ACTIVE', hasPassword: true }, undefined)).toBe(
      'ACTIVE',
    );
  });
});
