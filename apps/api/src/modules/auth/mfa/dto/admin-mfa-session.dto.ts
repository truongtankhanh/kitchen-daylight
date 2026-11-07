import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import { AdminSessionDto } from '../../dto/admin-session.dto.js';

/**
 * Body of `POST /admin/auth/mfa/verify`: the staff session (the refresh token goes into the
 * `kd_refresh` cookie only) and the recovery codes left, so the admin web warns at three and asks
 * for a new set at zero (brief E20; the server only reports).
 */
@ApiSchema({ name: 'AdminMfaSession' })
export class AdminMfaSessionDto extends AdminSessionDto {
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 10 })
  recoveryCodesLeft!: number;
}
