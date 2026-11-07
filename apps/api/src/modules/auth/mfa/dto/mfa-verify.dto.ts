import { IsDefined, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { RECOVERY_CODE_INPUT_MAX_LENGTH } from '../recovery-codes.js';
import { TOTP_CODE_INPUT_MAX_LENGTH } from './mfa-code.dto.js';

/** Far above an ES256 challenge token (about 300 characters); a cheap guard on the body size. */
export const MFA_CHALLENGE_INPUT_MAX_LENGTH = 2048;

/**
 * `POST /admin/auth/mfa/verify`: the challenge of `MFA_REQUIRED` (`mfaToken`) with exactly one of
 * `code` and `recoveryCode`; both or neither is `VALIDATION_FAILED`.
 */
export class MfaVerifyDto {
  /** The `mfaToken` of the `MFA_REQUIRED` answer (challenge token, 5 minutes). */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(MFA_CHALLENGE_INPUT_MAX_LENGTH)
  challenge!: string;

  /** The current 6-digit TOTP code; spaces are ignored. */
  @IsOptional()
  @IsString()
  @MaxLength(TOTP_CODE_INPUT_MAX_LENGTH)
  code?: string;

  /** One unused recovery code, `XXXXX-XXXXX`; case, spaces and hyphens are ignored. */
  @IsOptional()
  @IsString()
  @MaxLength(RECOVERY_CODE_INPUT_MAX_LENGTH)
  recoveryCode?: string;
}
