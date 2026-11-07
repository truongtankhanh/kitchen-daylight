import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import { STAFF_ROLES } from '../../../common/auth/roles.decorator.js';
import type { AdminSession, AdminSessionUser, StaffRole } from '../admin-auth.service.js';

/** The signed-in staff member, as the staff session response carries it. */
@ApiSchema({ name: 'AdminSessionUser' })
export class AdminSessionUserDto implements AdminSessionUser {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  displayName!: string;

  @ApiProperty({ enum: STAFF_ROLES, enumName: 'StaffRole' })
  role!: StaffRole;
}

/**
 * Body of `POST /admin/auth/login` and `/admin/auth/refresh` (cookie transport; api-divergences
 * D-078). The refresh token is never in a body: it travels only in the `kd_refresh` cookie.
 */
@ApiSchema({ name: 'AdminSession' })
export class AdminSessionDto implements AdminSession {
  /** ES256 JWT for `Authorization: Bearer`; kept in memory by the admin web. */
  accessToken!: string;

  /** Seconds until the access token expires. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  expiresIn!: number;

  user!: AdminSessionUserDto;
}
