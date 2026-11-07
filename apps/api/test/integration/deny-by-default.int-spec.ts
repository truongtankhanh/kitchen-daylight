import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
} from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient } from '../support/http.js';
import {
  CSRF_GUARDED_PUBLIC_ROUTES,
  EXPECTED_PUBLIC_ROUTES,
  TestRoutesModule,
} from '../support/test-routes.js';

const NOW = '2026-11-06T03:00:00.000Z';
// Fictional ids; the guard never reads the database, so no row is needed.
const PATH_UUID = '01930000-0000-7000-8000-00000000a7a1';
const USER_ID = '01930000-0000-7000-8000-00000000a7b1';
const SESSION_ID = '01930000-0000-7000-8000-00000000a7c1';
const METHODS_WITH_BODY: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface RouteEntry {
  readonly method: string;
  /** The registered Express pattern, for example `/api/v1/test-guards/items/:id`. */
  readonly path: string;
}

interface ExpressLayer {
  readonly route?: { readonly path?: unknown; readonly methods?: Record<string, boolean> };
}

interface RouterEnumeration {
  /** Controller endpoints, one entry per method. */
  readonly routes: RouteEntry[];
  /** Patterns registered with `app.all` (every method, `CONNECT` included). */
  readonly allMethodPaths: string[];
}

/**
 * Every route of the running app, read from the Express router stack through the HTTP adapter
 * (Express 5: `app.router.stack`; a layer with a `route` is a registered route).
 *
 * Nest mounts a middleware bound to `RequestMethod.ALL` (the `nestjs-pino` logger, on
 * `/api{/*splat}` and `/api/v1{/*splat}`) with Express `app.all`, which registers the pattern for
 * every method Express knows, `CONNECT` included. A controller decorator never registers
 * `CONNECT`, so a route that accepts it is an `app.all` registration, not an endpoint: it is kept
 * apart and checked to be a wildcard mount below.
 */
function enumerateRouter(app: INestApplication): RouterEnumeration {
  const instance = app.getHttpAdapter().getInstance() as {
    readonly router?: { readonly stack?: readonly ExpressLayer[] };
  };
  const routes: RouteEntry[] = [];
  const allMethodPaths: string[] = [];
  for (const layer of instance.router?.stack ?? []) {
    const path = layer.route?.path;
    const methods = layer.route?.methods ?? {};
    if (typeof path !== 'string') {
      continue;
    }
    if (methods['connect'] === true || methods['_all'] === true) {
      allMethodPaths.push(path);
      continue;
    }
    for (const [method, enabled] of Object.entries(methods)) {
      if (enabled) {
        routes.push({ method: method.toUpperCase(), path });
      }
    }
  }
  return { routes, allMethodPaths };
}

/** A requestable path: each parameter becomes a UUID, optional groups are kept. */
function concretePath(pattern: string): string {
  return pattern
    .replace(/:[A-Za-z0-9_]+/g, PATH_UUID)
    .replace(/\*[A-Za-z0-9_]+/g, 'x')
    .replace(/[{}]/g, '');
}

const keyOf = ({ method, path }: RouteEntry): string => `${method} ${path}`;

describe('deny by default (every route of the real app)', () => {
  let testApp: TestApp | undefined;
  let client: TestHttpClient;
  let clock: FixedClock;
  let routes: RouteEntry[];
  let allMethodPaths: string[];

  async function bearer(role: UserRole): Promise<Record<string, string>> {
    const tokens = testApp?.app.get(AccessTokenService);
    if (tokens === undefined) {
      throw new Error('The test app is not running.');
    }
    const { token } = await tokens.sign({ userId: USER_ID, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock, imports: [TestRoutesModule] });
    client = http(testApp.baseUrl);
    ({ routes, allMethodPaths } = enumerateRouter(testApp.app));
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('enumerates a non-trivial route list', () => {
    const keys = routes.map(keyOf);

    expect(keys).toEqual(expect.arrayContaining([...EXPECTED_PUBLIC_ROUTES]));
    expect(keys).toEqual(
      expect.arrayContaining([
        'GET /api/v1/test-guards/me',
        'GET /api/v1/test-guards/items/:id',
        'POST /api/v1/test-guards/items',
        'GET /api/v1/test-guards/staff',
        'GET /api/v1/admin/test-guards/staff',
        'GET /api/v1/admin/test-guards/unmarked',
        'DELETE /api/v1/admin/test-guards/items/:id',
      ]),
    );
  });

  it('sets apart only wildcard middleware mounts, never an @All() endpoint', () => {
    // An `@All()` handler would also be an `app.all` registration; it must fail here rather than
    // escape the 401 check below.
    expect(allMethodPaths.length).toBeGreaterThan(0);
    expect(allMethodPaths.filter((path) => !/\{\/\*[A-Za-z0-9_]+\}$/.test(path))).toEqual([]);
  });

  it('answers 401 UNAUTHENTICATED without a token on every route not marked @Public()', async () => {
    const failures: string[] = [];
    const protectedRoutes = routes.filter(
      (route) => !EXPECTED_PUBLIC_ROUTES.includes(keyOf(route)),
    );
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(7);

    for (const route of protectedRoutes) {
      // An empty JSON body where one may be sent: guards run before pipes, so 401, never 400.
      const response = await client.request(concretePath(route.path), {
        method: route.method,
        ...(METHODS_WITH_BODY.has(route.method) ? { body: {} } : {}),
      });
      const challenge = response.headers.get('www-authenticate');
      if (
        response.status !== 401 ||
        response.problem?.code !== 'UNAUTHENTICATED' ||
        challenge !== 'Bearer'
      ) {
        failures.push(
          `${keyOf(route)} -> ${response.status} ${response.problem?.code ?? ''} ${challenge ?? ''}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('opens exactly the expected @Public() routes without a token', async () => {
    const failures: string[] = [];
    for (const key of EXPECTED_PUBLIC_ROUTES) {
      const [method = 'GET', path = ''] = key.split(' ');
      const response = await client.request(concretePath(path), { method });
      if (CSRF_GUARDED_PUBLIC_ROUTES.includes(key)) {
        // Past the auth guard (no 401, no Bearer challenge); refused by the CSRF check instead.
        if (
          response.status !== 403 ||
          response.problem?.code !== 'FORBIDDEN' ||
          response.headers.get('www-authenticate') !== null
        ) {
          failures.push(`${key} -> ${response.status} ${response.problem?.code ?? ''}`);
        }
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        failures.push(`${key} -> ${response.status}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('answers 401 UNAUTHENTICATED to a malformed header or a forged token', async () => {
    const cases: readonly [string, string][] = [
      ['Basic a2Q6a2Q=', 'Bearer error="invalid_request"'],
      ['Bearer', 'Bearer error="invalid_request"'],
      ['Bearer a b', 'Bearer error="invalid_request"'],
      ['Bearer not.a.jwt', 'Bearer error="invalid_token"'],
    ];
    for (const [authorization, challenge] of cases) {
      const response = await client.get('/api/v1/test-guards/me', { headers: { authorization } });

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
      expect(response.headers.get('www-authenticate')).toBe(challenge);
    }
  });

  it('answers 401 TOKEN_EXPIRED to an authentic but expired token', async () => {
    const headers = await bearer('CUSTOMER');
    clock.advance((ACCESS_TOKEN_TTL_SECONDS + 60) * 1000);
    try {
      const response = await client.get('/api/v1/test-guards/me', { headers });

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('TOKEN_EXPIRED');
      expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    } finally {
      clock.set(NOW);
    }
  });

  it('sets the request user from the token only', async () => {
    const response = await client.get('/api/v1/test-guards/me', {
      headers: await bearer('CUSTOMER'),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: USER_ID, role: 'CUSTOMER' });
  });

  it('validates the body only after the token is accepted', async () => {
    const response = await client.post(
      '/api/v1/test-guards/items',
      {},
      {
        headers: await bearer('CUSTOMER'),
      },
    );

    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
  });

  it('answers 403 FORBIDDEN on a role mismatch', async () => {
    const cases: readonly [UserRole, string, string, number][] = [
      ['CUSTOMER', 'GET', '/api/v1/test-guards/staff', 403],
      ['STAFF', 'GET', '/api/v1/test-guards/staff', 200],
      ['CUSTOMER', 'GET', '/api/v1/admin/test-guards/staff', 403],
      ['STAFF', 'GET', '/api/v1/admin/test-guards/staff', 200],
      ['MANAGER', 'DELETE', `/api/v1/admin/test-guards/items/${PATH_UUID}`, 403],
      ['ADMIN', 'DELETE', `/api/v1/admin/test-guards/items/${PATH_UUID}`, 200],
    ];
    for (const [role, method, path, status] of cases) {
      const response = await client.request(path, { method, headers: await bearer(role) });

      expect({ role, method, path, status: response.status }).toEqual({
        role,
        method,
        path,
        status,
      });
      if (status === 403) {
        expect(response.problem?.code).toBe('FORBIDDEN');
      }
    }
  });

  it('refuses an admin route without @Roles to every role, whatever the case of the URL', async () => {
    for (const role of ['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'] as const) {
      for (const path of [
        '/api/v1/admin/test-guards/unmarked',
        '/API/V1/Admin/Test-Guards/Unmarked/',
      ]) {
        const response = await client.get(path, { headers: await bearer(role) });

        expect({ role, path, status: response.status, code: response.problem?.code }).toEqual({
          role,
          path,
          status: 403,
          code: 'FORBIDDEN',
        });
      }
    }
  });
});
