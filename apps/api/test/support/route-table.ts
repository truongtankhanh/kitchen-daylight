import { RequestMethod, VERSION_NEUTRAL } from '@nestjs/common';
import type { INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { Reflector } from '@nestjs/core';

// The route table of a running app, shared by the route-enumerating specs: the 401 test of A1-T7
// (`deny-by-default.int-spec.ts`) and the branch-scoping test of A3-T5
// (`branch-scoping.int-spec.ts`). The router is the source of truth, so a new endpoint cannot be
// left out of either check.

export interface RouteEntry {
  readonly method: string;
  /** The registered Express pattern, for example `/api/v1/test-guards/items/:id`. */
  readonly path: string;
}

export interface RouterEnumeration {
  /** Controller endpoints, one entry per method. */
  readonly routes: RouteEntry[];
  /** Patterns registered with `app.all` (every method, `CONNECT` included). */
  readonly allMethodPaths: string[];
}

interface ExpressLayer {
  readonly route?: { readonly path?: unknown; readonly methods?: Record<string, boolean> };
}

/** `METHOD path`, for example `GET /api/v1/admin/users/:id`. */
export const keyOf = ({ method, path }: RouteEntry): string => `${method} ${path}`;

/**
 * Every route of the running app, read from the Express router stack through the HTTP adapter
 * (Express 5: `app.router.stack`; a layer with a `route` is a registered route).
 *
 * Nest mounts a middleware bound to `RequestMethod.ALL` (the `nestjs-pino` logger, on
 * `/api{/*splat}` and `/api/v1{/*splat}`) with Express `app.all`, which registers the pattern for
 * every method Express knows, `CONNECT` included. A controller decorator never registers
 * `CONNECT`, so a route that accepts it is an `app.all` registration, not an endpoint: it is kept
 * apart in `allMethodPaths`, which a spec checks to be wildcard mounts only.
 */
export function enumerateRouter(app: INestApplication): RouterEnumeration {
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

export type RouteHandler = (...args: never[]) => unknown;

/** A controller handler and one `METHOD path` key Nest registers it under. */
export interface HandlerRoute {
  readonly key: string;
  /** `Controller.method`, for failure messages. */
  readonly name: string;
  readonly controller: Type<unknown>;
  readonly handler: RouteHandler;
}

const listOf = <T>(value: T | readonly T[] | undefined, fallback: T): readonly T[] =>
  value === undefined ? [fallback] : Array.isArray(value) ? (value as readonly T[]) : [value as T];

/** Segments joined with one `/`, without a trailing one, as Nest's `RoutePathFactory` does. */
function joinPath(...segments: readonly string[]): string {
  const parts = segments.map((segment) => segment.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${parts.join('/')}`;
}

/**
 * Every handler of every controller of the app, with the keys Nest routes it under (global prefix
 * `api` and URI version `1` by default, as `configureApp` sets them; no version segment for
 * `VERSION_NEUTRAL`), so each router entry can be traced back to its handler and decorators.
 */
export function discoverHandlers(app: INestApplication, reflector: Reflector): HandlerRoute[] {
  const scanner = new MetadataScanner();
  const seen = new Set<unknown>();
  const result: HandlerRoute[] = [];
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (controller === null || seen.has(controller)) {
        continue;
      }
      seen.add(controller);
      const prototype = controller.prototype as Record<string, unknown>;
      const controllerPaths = listOf(
        reflector.get<string | string[] | undefined>(PATH_METADATA, controller),
        '/',
      );
      for (const name of scanner.getAllMethodNames(prototype)) {
        const candidate = prototype[name];
        if (typeof candidate !== 'function') {
          continue;
        }
        const handler = candidate as RouteHandler;
        const methodPaths = reflector.get<string | string[] | undefined>(PATH_METADATA, handler);
        if (methodPaths === undefined) {
          continue;
        }
        const method = RequestMethod[reflector.get<RequestMethod>(METHOD_METADATA, handler)];
        // The handler's version wins over the controller's; `configureApp` defaults to `1`.
        const versions = listOf<unknown>(
          reflector.get<unknown>(VERSION_METADATA, handler) ??
            reflector.get<unknown>(VERSION_METADATA, controller),
          '1',
        );
        for (const version of versions) {
          const versionSegment = version === VERSION_NEUTRAL ? '' : `v${String(version)}`;
          for (const controllerPath of controllerPaths) {
            for (const methodPath of listOf(methodPaths, '/')) {
              result.push({
                key: `${method} ${joinPath('api', versionSegment, controllerPath, methodPath)}`,
                name: `${controller.name}.${name}`,
                controller,
                handler,
              });
            }
          }
        }
      }
    }
  }
  return result;
}
