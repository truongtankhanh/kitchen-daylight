import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Longer than the six digits, so a code typed with spaces (`123 456`) reaches the service, which
 * removes whitespace and then requires exactly six ASCII digits (decision 0008 section 6).
 */
export const EMAIL_CODE_INPUT_MAX_LENGTH = 16;

/** `POST /api/v1/auth/email/verify` (customer access token required). */
export class VerifyEmailDto {
  /** The 6-digit code from the mail; spaces are ignored. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(EMAIL_CODE_INPUT_MAX_LENGTH)
  code!: string;
}
