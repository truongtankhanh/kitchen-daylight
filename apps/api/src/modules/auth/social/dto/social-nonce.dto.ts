import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** `POST /api/v1/auth/social/nonce`: a single-use nonce for the native Google or Apple flow. */
@ApiSchema({ name: 'SocialNonce' })
export class SocialNonceDto {
  /** Passed unchanged to the native SDK, then sent back with the ID token. Single use. */
  nonce!: string;

  /** Five minutes after issue; a later sign-in with it is `UNAUTHENTICATED`. */
  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
