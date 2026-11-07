import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PASSWORD_INPUT_MAX_LENGTH } from './register.dto.js';

/** A bound on the token field before any work; a real token is 43 characters. */
export const LINK_TOKEN_INPUT_MAX_LENGTH = 256;

/**
 * `POST /api/v1/admin/auth/password/set` (public). The token is not checked for format here: any
 * token that is not a live link answers the same `CODE_INVALID`.
 */
export class SetPasswordDto {
  /** The token from the `#token=` fragment of the invitation or reset link. */
  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(LINK_TOKEN_INPUT_MAX_LENGTH)
  token!: string;

  /** 12 to 128 Unicode code points after NFC; not the email or its local part. */
  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  password!: string;
}
