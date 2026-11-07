import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

import { DISPLAY_NAME_MAX_LENGTH } from '../../auth/dto/register.dto.js';

/**
 * `PATCH /api/v1/me`: every field is optional and a missing one is left as it is. `phone` and
 * `preferredBranchId` take `null` to clear; `displayName` does not. The email cannot be changed
 * here, and any other property is refused by the global pipe.
 */
export class MeUpdateDto {
  /** 1 to 60 characters after trimming (`TOO_LONG`; mobile G95). */
  @ValidateIf((dto: MeUpdateDto) => dto.displayName !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  /**
   * A Vietnamese mobile number in national (`0…`) or international (`+84…`, `84…`) form, stored in
   * E.164; anything else is `INVALID_PHONE` (mobile G97). `null` clears it (mobile G96).
   */
  @ApiProperty({ type: String, nullable: true, required: false, example: '0901234567' })
  @ValidateIf((dto: MeUpdateDto) => dto.phone !== undefined && dto.phone !== null)
  @IsString()
  phone?: string | null;

  /** An existing, not deleted branch (`NOT_FOUND` otherwise), or `null` to clear. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true, required: false })
  @ValidateIf(
    (dto: MeUpdateDto) => dto.preferredBranchId !== undefined && dto.preferredBranchId !== null,
  )
  @IsUUID('all')
  preferredBranchId?: string | null;
}
