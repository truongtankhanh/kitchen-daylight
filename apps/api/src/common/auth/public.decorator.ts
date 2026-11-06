import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ApiExtension } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'kd:auth:public';

/**
 * Marker read by the OpenAPI document builder (`openapi/document.ts`): an operation carrying it
 * gets `security: []` instead of the document-wide bearer requirement, then the marker is removed.
 */
export const PUBLIC_OPERATION_EXTENSION = 'x-kd-public';

/**
 * Opens a handler (or every handler of a controller) to callers without an access token. Every
 * other route needs `Authorization: Bearer` (deny by default, ADR-0003 "Authorization"). A
 * `@Public()` handler has no request user, so `@CurrentUser()` and `@Roles()` do not apply to it.
 */
export function Public(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    SetMetadata(IS_PUBLIC_KEY, true),
    ApiExtension(PUBLIC_OPERATION_EXTENSION, true),
  );
}

/** The handler's `@Public()` wins over its controller's; absent means protected. */
export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
