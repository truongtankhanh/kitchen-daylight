import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../../modules/users/entities/user.entity.js';

export const ROLES_KEY = 'kd:auth:roles';

// The "Who" column of api-outline.md: `customer` is any signed-in user and needs no decorator;
// `staff`, `manager` and `admin` are the sets below. Branch scoping is not a role check (A3-T5).

/** `staff`: `STAFF`, `MANAGER` or `ADMIN`. */
export const STAFF_ROLES = Object.freeze(['STAFF', 'MANAGER', 'ADMIN'] as const);
/** `manager`: `MANAGER` or `ADMIN`. */
export const MANAGER_ROLES = Object.freeze(['MANAGER', 'ADMIN'] as const);
/** `admin`: `ADMIN` only. */
export const ADMIN_ROLES = Object.freeze(['ADMIN'] as const);

/**
 * Limits a handler (or a controller) to the given roles, for example `@Roles(...MANAGER_ROLES)`.
 * `RolesGuard` answers `403 FORBIDDEN` to any other role. Every protected handler under
 * `/api/v1/admin/` needs it: without it the guard refuses everyone.
 */
export function Roles(
  first: UserRole,
  ...rest: readonly UserRole[]
): ClassDecorator & MethodDecorator {
  return SetMetadata(ROLES_KEY, Object.freeze([first, ...rest]));
}
