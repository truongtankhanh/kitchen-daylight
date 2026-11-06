import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Longer than any token the API issues (43 characters); bounds the input before hashing. */
export const REFRESH_TOKEN_INPUT_MAX_LENGTH = 256;

/** `POST /api/v1/auth/refresh` and `POST /api/v1/auth/logout`. */
export class RefreshTokenDto {
  /** The opaque refresh token from the last sign-in or refresh. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(REFRESH_TOKEN_INPUT_MAX_LENGTH)
  refreshToken!: string;
}
