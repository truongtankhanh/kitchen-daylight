import type { ExecutionContext } from '@nestjs/common';

import type { GuardedRequest } from './request-user.js';

/** A route handler and its controller, as the guards see them through `ExecutionContext`. */
export interface FakeRoute {
  readonly controller: abstract new (...args: never[]) => unknown;
  readonly handler: (...args: never[]) => unknown;
}

/**
 * For specs only: an HTTP `ExecutionContext` for `request` on `route`. The guards read the
 * handler and controller metadata through the real `Reflector`, so the decorators under test
 * apply unchanged.
 */
export function httpContext(
  route: FakeRoute,
  request: GuardedRequest,
  response: object = {},
  type: 'http' | 'ws' = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    getClass: () => route.controller,
    getHandler: () => route.handler,
    getArgs: () => [request, response],
    getArgByIndex: (index: number) => [request, response][index],
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    switchToRpc: () => {
      throw new Error('not an RPC context');
    },
    switchToWs: () => {
      throw new Error('not a WebSocket context');
    },
  } as unknown as ExecutionContext;
}

/** A request on the registered route `routePath` (raw path defaults to the same text). */
export function requestOn(
  routePath: string,
  init: Partial<Omit<GuardedRequest, 'route'>> = {},
): GuardedRequest {
  return { headers: {}, route: { path: routePath }, path: routePath, ...init };
}
