import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { EMAIL_MAX_LENGTH, PASSWORD_INPUT_MAX_LENGTH } from './register.dto.js';
import { EMAIL_CODE_INPUT_MAX_LENGTH } from './verify-email.dto.js';

/**
 * `POST /api/v1/auth/password/reset` (public). The email is not checked for format: any address
 * without a usable code answers the same `CODE_INVALID`.
 */
export class ResetPasswordDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  /** The 6-digit code from the mail; spaces are ignored. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(EMAIL_CODE_INPUT_MAX_LENGTH)
  code!: string;

  /** 10 to 128 Unicode code points after NFC; not the email or its local part. */
  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  newPassword!: string;
}
