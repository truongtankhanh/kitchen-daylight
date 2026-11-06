import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type { AuthSession, AuthUser } from '../auth.service.js';

/** The signed-in customer, as the session response carries it. */
@ApiSchema({ name: 'AuthUser' })
export class AuthUserDto implements AuthUser {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  displayName!: string;

  /** `null` until the email is verified; ordering needs it, signing in does not. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emailVerifiedAt!: string | null;
}

/**
 * Body of register, login and refresh on the customer transport (tokens in the body; shape logged
 * as api-divergences D-044).
 */
@ApiSchema({ name: 'AuthSession' })
export class AuthSessionDto implements AuthSession {
  /** ES256 JWT for `Authorization: Bearer`. */
  accessToken!: string;

  /** Opaque, single use; kept in the device's secure store. */
  refreshToken!: string;

  /** Seconds until the access token expires. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  expiresIn!: number;

  user!: AuthUserDto;
}
