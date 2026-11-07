import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

import { AdminSessionDto } from '../../dto/admin-session.dto.js';

/** Body of `POST /me/mfa/recovery-codes`: the new set, shown once. */
@ApiSchema({ name: 'MfaRecoveryCodes' })
export class MfaRecoveryCodesDto {
  /** Ten single-use codes, `XXXXX-XXXXX`; the previous set no longer works. */
  @ApiProperty({ type: [String], minItems: 10, maxItems: 10 })
  recoveryCodes!: string[];
}

/**
 * Body of `POST /me/mfa/confirm`: the recovery codes, shown once. With the enrolment token the
 * sign-in completes here (decision 0008 section 8): `session` is set and so is the `kd_refresh`
 * cookie. With an access token there is no `session`.
 */
@ApiSchema({ name: 'MfaConfirmation' })
export class MfaConfirmationDto extends MfaRecoveryCodesDto {
  @ApiPropertyOptional({ type: AdminSessionDto })
  session?: AdminSessionDto;
}
