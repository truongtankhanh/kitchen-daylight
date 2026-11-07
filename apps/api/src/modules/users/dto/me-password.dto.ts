import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PASSWORD_INPUT_MAX_LENGTH } from '../../auth/dto/register.dto.js';

/** `POST /api/v1/me/password`. */
export class MePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  currentPassword!: string;

  /** The password policy of the account's role (customers 10 to 128 code points after NFC). */
  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  newPassword!: string;
}
