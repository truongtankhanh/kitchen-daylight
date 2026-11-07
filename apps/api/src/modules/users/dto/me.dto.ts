import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type { MeProfile } from '../me.service.js';

/** `GET` and `PATCH /api/v1/me`: the signed-in user's own profile (mobile G94). */
@ApiSchema({ name: 'Me' })
export class MeDto implements MeProfile {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** Changed only through the email-code flow (A2-T2), never by `PATCH /me`. */
  @ApiProperty({ format: 'email' })
  email!: string;

  /** `null` until the email is verified. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emailVerifiedAt!: string | null;

  /** 1 to 60 characters. */
  displayName!: string;

  /** E.164 (`+84…`); `null` when unset, and the next order then answers `PHONE_REQUIRED`. */
  @ApiProperty({ type: String, nullable: true, example: '+84901234567' })
  phone!: string | null;

  /** Read only: there is no avatar upload. */
  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  preferredBranchId!: string | null;
}
