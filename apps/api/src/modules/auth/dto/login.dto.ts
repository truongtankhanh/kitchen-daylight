import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  DEVICE_LABEL_INPUT_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_INPUT_MAX_LENGTH,
} from './register.dto.js';

/**
 * `POST /api/v1/auth/login`. The email is not checked for format: any string answers the same
 * `401 INVALID_CREDENTIALS` as an unknown address.
 */
export class LoginDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  password!: string;

  /** Shown in the session list; display only. Defaults to `X-Client`. */
  @IsOptional()
  @IsString()
  @MaxLength(DEVICE_LABEL_INPUT_MAX_LENGTH)
  deviceLabel?: string | null;
}
