import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import type { UserRole, UserStatus } from '../../modules/users/entities/user.entity.js';
import { BEARER_CHALLENGE } from '../auth/auth.guard.js';
import type { GuardedRequest } from '../auth/request-user.js';
import { ADMIN_ROLES, MANAGER_ROLES, Roles } from '../auth/roles.decorator.js';
import { httpContext, requestOn } from '../auth/testing.js';
import { FRESH_ROLE_SQL, FreshRoleGuard } from './fresh-role.guard.js';
import { Sensitive } from './sensitive.decorator.js';

const USER_ID = '01930000-0000-7000-8000-00000000c3a1';
const SESSION_ID = '01930000-0000-7000-8000-00000000c3b1';

@Roles(...ADMIN_ROLES)
@Sensitive()
@Controller('admin/users')
class AdminOnlyController {
  @Get()
  list(): void {}
}

@Controller('admin/things')
class MixedController {
  @Roles(...MANAGER_ROLES)
  @Sensitive()
  @Get('sensitive')
  sensitive(): void {}

  @Roles(...MANAGER_ROLES)
  @Get('plain')
  plain(): void {}
}

const ADMIN_ROUTE = {
  controller: AdminOnlyController,
  handler: AdminOnlyController.prototype.list,
};
const MANAGER_ROUTE = { controller: MixedController, handler: MixedController.prototype.sensitive };
const PLAIN_ROUTE = { controller: MixedController, handler: MixedController.prototype.plain };

interface Stored {
  readonly role: UserRole;
  readonly status: UserStatus;
}

function guardOver(stored: Stored | null): {
  guard: FreshRoleGuard;
  queries: { sql: string; parameters: unknown[] }[];
} {
  const queries: { sql: string; parameters: unknown[] }[] = [];
  const dataSource = {
    query: (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return Promise.resolve(stored === null ? [] : [stored]);
    },
  } as unknown as DataSource;
  return { guard: new FreshRoleGuard(new Reflector(), dataSource), queries };
}

/** A request whose token still says `role`. */
function tokenSays(role: UserRole): GuardedRequest {
  return requestOn('/api/v1/admin/users', { user: { id: USER_ID, role, sessionId: SESSION_ID } });
}

function recorder(): { headers: Record<string, string>; setHeader(n: string, v: string): void } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

describe('FreshRoleGuard', () => {
  it('reads role and status of the request user on every request', async () => {
    const { guard, queries } = guardOver({ role: 'ADMIN', status: 'ACTIVE' });

    await expect(guard.canActivate(httpContext(ADMIN_ROUTE, tokenSays('ADMIN')))).resolves.toBe(
      true,
    );
    await guard.canActivate(httpContext(ADMIN_ROUTE, tokenSays('ADMIN')));
    expect(queries).toEqual([
      { sql: FRESH_ROLE_SQL, parameters: [USER_ID] },
      { sql: FRESH_ROLE_SQL, parameters: [USER_ID] },
    ]);
  });

  it.each([
    ['an ADMIN demoted to MANAGER', ADMIN_ROUTE, 'ADMIN', 'MANAGER'],
    ['a MANAGER demoted to STAFF', MANAGER_ROUTE, 'MANAGER', 'STAFF'],
    ['a MANAGER demoted to CUSTOMER', MANAGER_ROUTE, 'MANAGER', 'CUSTOMER'],
  ] as const)(
    'refuses %s with FORBIDDEN while the token still says otherwise',
    async (_case, route, tokenRole, storedRole) => {
      const { guard } = guardOver({ role: storedRole, status: 'ACTIVE' });

      await expect(
        guard.canActivate(httpContext(route, tokenSays(tokenRole))),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('accepts a MANAGER promoted to ADMIN on a manager route', async () => {
    const { guard } = guardOver({ role: 'ADMIN', status: 'ACTIVE' });

    await expect(guard.canActivate(httpContext(MANAGER_ROUTE, tokenSays('MANAGER')))).resolves.toBe(
      true,
    );
  });

  it.each([
    ['suspended', { role: 'ADMIN', status: 'SUSPENDED' } as const],
    ['deleted', { role: 'ADMIN', status: 'DELETED' } as const],
    ['missing', null],
  ])(
    'answers UNAUTHENTICATED with the invalid_token challenge for a %s account',
    async (_c, stored) => {
      const { guard } = guardOver(stored);
      const response = recorder();

      await expect(
        guard.canActivate(httpContext(ADMIN_ROUTE, tokenSays('ADMIN'), response)),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(response.headers).toEqual({ 'WWW-Authenticate': BEARER_CHALLENGE.refused });
    },
  );

  it('reads nothing on a route without @Sensitive', async () => {
    const { guard, queries } = guardOver(null);

    await expect(guard.canActivate(httpContext(PLAIN_ROUTE, tokenSays('MANAGER')))).resolves.toBe(
      true,
    );
    expect(queries).toEqual([]);
  });

  it('fails closed without a request user', async () => {
    const { guard } = guardOver({ role: 'ADMIN', status: 'ACTIVE' });

    await expect(
      guard.canActivate(httpContext(ADMIN_ROUTE, requestOn('/api/v1/admin/users'))),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
