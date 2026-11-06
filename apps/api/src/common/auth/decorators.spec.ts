import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import { currentUserOf } from './current-user.decorator.js';
import {
  IS_PUBLIC_KEY,
  isPublicRoute,
  Public,
  PUBLIC_OPERATION_EXTENSION,
} from './public.decorator.js';
import { httpContext, requestOn } from './testing.js';

/** `DECORATORS.API_EXTENSION` of `@nestjs/swagger`, whose `exports` map hides `dist/constants`. */
const API_EXTENSION_METADATA = 'swagger/apiExtension';

@Public()
@Controller('meta')
class PublicController {
  @Get()
  read(): void {}
}

@Controller('orders')
class MixedController {
  @Get()
  list(): void {}

  @Public()
  @Get('open')
  open(): void {}
}

describe('@Public()', () => {
  const reflector = new Reflector();

  it('marks the handler for the guards and the OpenAPI document', () => {
    const handler = MixedController.prototype.open;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(API_EXTENSION_METADATA, handler)).toEqual({
      [PUBLIC_OPERATION_EXTENSION]: true,
    });
  });

  it('on a controller, marks the controller and every handler for the document', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicController)).toBe(true);
    expect(Reflect.getMetadata(API_EXTENSION_METADATA, PublicController.prototype.read)).toEqual({
      [PUBLIC_OPERATION_EXTENSION]: true,
    });
  });

  it('isPublicRoute: handler or controller marked, otherwise protected', () => {
    const request = requestOn('/api/v1/orders');
    const at = (
      controller: typeof PublicController | typeof MixedController,
      handler: () => void,
    ) => isPublicRoute(reflector, httpContext({ controller, handler }, request));

    expect(at(PublicController, PublicController.prototype.read)).toBe(true);
    expect(at(MixedController, MixedController.prototype.open)).toBe(true);
    expect(at(MixedController, MixedController.prototype.list)).toBe(false);
  });
});

describe('@CurrentUser()', () => {
  const route = { controller: MixedController, handler: MixedController.prototype.list };

  it('returns the request user set by AuthGuard', () => {
    const user = { id: '01930000-0000-7000-8000-00000000a3a1', role: 'CUSTOMER' } as const;

    expect(currentUserOf(httpContext(route, requestOn('/api/v1/orders', { user })))).toBe(user);
  });

  it('fails closed with 401 UNAUTHENTICATED when there is none', () => {
    let error: unknown;
    try {
      currentUserOf(httpContext(route, requestOn('/api/v1/orders')));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
  });
});
