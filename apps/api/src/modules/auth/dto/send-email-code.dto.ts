import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, MaxLength } from 'class-validator';

import { EMAIL_MAX_LENGTH } from './register.dto.js';

/** `POST /api/v1/auth/email/send-code` (customer access token required). */
export class SendEmailCodeDto {
  /**
   * Another address to verify instead of the account email (the "another email" path), only while
   * the account is unverified. Trimmed and lower-cased; absent sends the code to the account email.
   */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string | null;
}
