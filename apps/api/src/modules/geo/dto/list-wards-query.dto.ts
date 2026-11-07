import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Longer than any official code (2 digits), so an unknown code reaches the lookup. */
export const PROVINCE_CODE_INPUT_MAX_LENGTH = 16;

/** Query of `GET /api/v1/wards`. */
export class ListWardsQueryDto {
  /** Official province code from `GET /api/v1/provinces` (for example `79`). */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PROVINCE_CODE_INPUT_MAX_LENGTH)
  provinceCode!: string;
}
