import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { TOTP_CODE_INPUT_MAX_LENGTH } from '../../mfa/dto/mfa-code.dto.js';
import { STEP_UP_PURPOSES } from '../step-up.service.js';
import type { StepUpPurpose } from '../step-up.service.js';

/** `POST /admin/auth/step-up` (api-divergences D-101: `purpose` is added to the outline's `{ code }`). */
export class StepUpDto {
  /** The current 6-digit code of the authenticator app (not a recovery code); spaces are ignored. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(TOTP_CODE_INPUT_MAX_LENGTH)
  code!: string;

  /** The action the token will authorise; the protected route checks it. */
  @ApiProperty({ enum: STEP_UP_PURPOSES })
  @IsDefined()
  @IsIn(STEP_UP_PURPOSES)
  purpose!: StepUpPurpose;
}
