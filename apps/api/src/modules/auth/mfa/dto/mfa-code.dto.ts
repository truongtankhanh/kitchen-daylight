import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Longer than the six digits, so a code typed with spaces (`123 456`) reaches the service, which
 * removes whitespace and then requires exactly six ASCII digits (as email codes, decision 0008
 * section 6).
 */
export const TOTP_CODE_INPUT_MAX_LENGTH = 16;

/** `POST /me/mfa/confirm` and `POST /me/mfa/recovery-codes`. */
export class MfaCodeDto {
  /** The current 6-digit code of the authenticator app; spaces are ignored. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(TOTP_CODE_INPUT_MAX_LENGTH)
  code!: string;
}
