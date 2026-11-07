import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { FreshRoleGuard, SENSITIVE_KEY } from './fresh-role.guard.js';

/**
 * Marks a handler (or every handler of a controller) as sensitive: `FreshRoleGuard` re-reads the
 * caller's `role` and `status` from the database on each request instead of trusting the access
 * token until it expires (ADR-0003; A3-T6). Use it with `@Roles(...)`, which names the roles the
 * stored role must still have. Applied to the admin user routes (A3-T6), settings writes (A4-T2)
 * and branch create and delete (A5-T2).
 */
export function Sensitive(): ClassDecorator & MethodDecorator {
  return applyDecorators(SetMetadata(SENSITIVE_KEY, true), UseGuards(FreshRoleGuard));
}
