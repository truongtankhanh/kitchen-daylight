import { Transform } from 'class-transformer';
import { IsDefined, IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

import { EMAIL_MAX_LENGTH } from './register.dto.js';

/**
 * `POST /api/v1/auth/password/forgot` (public). The answer is the same `202` whether or not the
 * address belongs to an account.
 */
export class ForgotPasswordDto {
  /** Trimmed before validation, as at registration. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsDefined()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}
