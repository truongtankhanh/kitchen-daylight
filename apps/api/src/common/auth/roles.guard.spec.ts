import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { USER_ROLES } from '../../modules/users/entities/user.entity.js';
import type { UserRole } from '../../modules/users/entities/user.entity.js';
import { ApiError } from '../errors/api-error.js';
import { Public } from './public.decorator.js';
import type { GuardedRequest } from './request-user.js';
import { ADMIN_ROLES, MANAGER_ROLES, Roles, STAFF_ROLES } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import { httpContext, requestOn } from './testing.js';
import type { FakeRoute } from './testing.js';

const USER_ID = '01930000-0000-7000-8000-00000000a2a1';
const SESSION_ID = '01930000-0000-7000-8000-00000000a2b1';

@Controller('routes')
class RoutesController {
  @Get('customer')
  customer(): void {}

  @Roles(...STAFF_ROLES)
  @Get('staff')
  staff(): void {}

  @Roles(...MANAGER_ROLES)
  @Get('manager')
  manager(): void {}

  @Roles(...ADMIN_ROLES)
  @Get('admin')
  admin(): void {}

  @Public()
  @Get('public')
  open(): void {}
}

@Roles(...ADMIN_ROLES)
@Controller('admin-only')
class AdminOnlyController {
  @Get()
  inherited(): void {}

  @Roles(...STAFF_ROLES)
  @Get('override')
  override(): void {}
}

function route(controller: FakeRoute['controller'], handler: FakeRoute['handler']): FakeRoute {
  return { controller, handler };
}

const CUSTOMER_ROUTE = route(RoutesController, RoutesController.prototype.customer);
const STAFF_ROUTE = route(RoutesController, RoutesController.prototype.staff);
const MANAGER_ROUTE = route(RoutesController, RoutesController.prototype.manager);
const ADMIN_ROUTE = route(RoutesController, RoutesController.prototype.admin);
const PUBLIC_ROUTE = route(RoutesController, RoutesController.prototype.open);
const CLASS_ROLES = route(AdminOnlyController, AdminOnlyController.prototype.inherited);
const HANDLER_OVERRIDE = route(AdminOnlyController, AdminOnlyController.prototype.override);

const guard = new RolesGuard(new Reflector());

function signedIn(role: UserRole, routePath = '/api/v1/routes', rawPath?: string): GuardedRequest {
  return requestOn(routePath, {
    user: { id: USER_ID, role, sessionId: SESSION_ID },
    ...(rawPath === undefined ? {} : { path: rawPath }),
  });
}

function decide(fakeRoute: FakeRoute, request: GuardedRequest): true | string {
  try {
    return guard.canActivate(httpContext(fakeRoute, request)) ? true : 'false';
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
}

describe('role sets mirror the outline "Who" definitions', () => {
  it('staff = STAFF, MANAGER, ADMIN; manager = MANAGER, ADMIN; admin = ADMIN', () => {
    expect(STAFF_ROLES).toEqual(['STAFF', 'MANAGER', 'ADMIN']);
    expect(MANAGER_ROLES).toEqual(['MANAGER', 'ADMIN']);
    expect(ADMIN_ROLES).toEqual(['ADMIN']);
    expect(Object.isFrozen(STAFF_ROLES)).toBe(true);
  });
});

describe('RolesGuard decision table', () => {
  it.each([
    // [route, role, expected]
    [STAFF_ROUTE, 'CUSTOMER', 'FORBIDDEN'],
    [STAFF_ROUTE, 'STAFF', true],
    [STAFF_ROUTE, 'MANAGER', true],
    [STAFF_ROUTE, 'ADMIN', true],
    [MANAGER_ROUTE, 'CUSTOMER', 'FORBIDDEN'],
    [MANAGER_ROUTE, 'STAFF', 'FORBIDDEN'],
    [MANAGER_ROUTE, 'MANAGER', true],
    [MANAGER_ROUTE, 'ADMIN', true],
    [ADMIN_ROUTE, 'STAFF', 'FORBIDDEN'],
    [ADMIN_ROUTE, 'MANAGER', 'FORBIDDEN'],
    [ADMIN_ROUTE, 'ADMIN', true],
  ] as const)('%#: role %s', (fakeRoute, role, expected) => {
    expect(decide(fakeRoute, signedIn(role))).toBe(expected);
  });

  it('role mismatch is 403 FORBIDDEN', () => {
    const error = (() => {
      try {
        guard.canActivate(httpContext(ADMIN_ROUTE, signedIn('STAFF')));
      } catch (caught) {
        return caught as ApiError;
      }
      return undefined;
    })();

    expect(error?.code).toBe('FORBIDDEN');
    expect(error?.status).toBe(403);
  });

  it.each(USER_ROLES)('no @Roles outside /admin: any signed-in user (%s)', (role) => {
    expect(decide(CUSTOMER_ROUTE, signedIn(role, '/api/v1/me/favorites'))).toBe(true);
  });

  it.each(USER_ROLES)('no @Roles under /api/v1/admin/: 403 FORBIDDEN even for %s', (role) => {
    expect(decide(CUSTOMER_ROUTE, signedIn(role, '/api/v1/admin/orders/:id'))).toBe('FORBIDDEN');
  });

  it('no @Roles: the admin check reads the registered route, not the raw path', () => {
    expect(
      decide(CUSTOMER_ROUTE, signedIn('ADMIN', '/api/v1/admin/orders', '/API/V1/Admin/Orders/')),
    ).toBe('FORBIDDEN');
    expect(decide(CUSTOMER_ROUTE, signedIn('ADMIN', '/API/V1/ADMIN/ORDERS'))).toBe('FORBIDDEN');
  });

  it('no @Roles: falls back to the request path when no route was matched', () => {
    const request: GuardedRequest = {
      headers: {},
      path: '/api/v1/admin/orders',
      user: { id: USER_ID, role: 'ADMIN', sessionId: SESSION_ID },
    };

    expect(decide(CUSTOMER_ROUTE, request)).toBe('FORBIDDEN');
  });

  it.each([
    ['/api/v1/admin', 'FORBIDDEN'],
    ['/api/v1/admin/', 'FORBIDDEN'],
    ['/api/v1/administrators', true],
    ['/api/v1/me/admin', true],
  ] as const)('no @Roles on %s: %s', (routePath, expected) => {
    expect(decide(CUSTOMER_ROUTE, signedIn('CUSTOMER', routePath))).toBe(expected);
  });

  it('@Roles on an /admin route lets the listed roles through', () => {
    expect(decide(STAFF_ROUTE, signedIn('STAFF', '/api/v1/admin/orders'))).toBe(true);
    expect(decide(STAFF_ROUTE, signedIn('CUSTOMER', '/api/v1/admin/orders'))).toBe('FORBIDDEN');
  });

  it('@Public(): allowed with no request user, under /admin too (staff login)', () => {
    expect(decide(PUBLIC_ROUTE, requestOn('/api/v1/admin/auth/login'))).toBe(true);
  });

  it('no request user on a protected route: 401 UNAUTHENTICATED (fail closed)', () => {
    expect(decide(CUSTOMER_ROUTE, requestOn('/api/v1/me'))).toBe('UNAUTHENTICATED');
  });

  it('@Roles on the controller applies to its handlers; the handler list wins', () => {
    expect(decide(CLASS_ROLES, signedIn('MANAGER'))).toBe('FORBIDDEN');
    expect(decide(CLASS_ROLES, signedIn('ADMIN'))).toBe(true);
    expect(decide(HANDLER_OVERRIDE, signedIn('STAFF'))).toBe(true);
  });
});
