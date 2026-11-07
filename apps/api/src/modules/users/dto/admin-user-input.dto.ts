import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { STAFF_ROLES } from '../../../common/auth/roles.decorator.js';
import { EMAIL_MAX_LENGTH } from '../../auth/dto/register.dto.js';

/** `users.display_name` is at most 60 characters (`CHECK`; mobile G95). */
export const DISPLAY_NAME_MAX_LENGTH = 60;
/** A bound on `branchIds`; far above the branches of one restaurant. */
export const BRANCH_IDS_MAX = 50;

/** The two statuses an admin may set (`INVITED` ends through the link, `DELETED` is A11). */
export const ADMIN_SETTABLE_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type AdminSettableStatus = (typeof ADMIN_SETTABLE_STATUSES)[number];

export type StaffRoleInput = (typeof STAFF_ROLES)[number];

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** `POST /api/v1/admin/users`: a staff account, `INVITED` until its link is used (brief E1). */
export class AdminUserCreateDto {
  /** Trimmed; 1 to 60 characters. */
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  /** Trimmed; the invitation goes there. An address already in use is `ALREADY_EXISTS`. */
  @Transform(trimmed)
  @IsDefined()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ enum: STAFF_ROLES })
  @IsDefined()
  @IsIn(STAFF_ROLES)
  role!: StaffRoleInput;

  /** At least one existing branch for `STAFF` and `MANAGER`; ignored for `ADMIN`. */
  @ApiProperty({ required: false, type: String, format: 'uuid', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRANCH_IDS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

/**
 * `PATCH /api/v1/admin/users/{id}`: every field optional, no `rowVersion` (brief E4). A customer
 * account accepts `status` only (api-divergences D-091).
 */
export class AdminUserUpdateDto {
  /** Trimmed; 1 to 60 characters. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiProperty({ required: false, enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRoleInput;

  @ApiProperty({ required: false, enum: ADMIN_SETTABLE_STATUSES })
  @IsOptional()
  @IsIn(ADMIN_SETTABLE_STATUSES)
  status?: AdminSettableStatus;

  /** Replaces the whole set; at least one existing branch for `STAFF` and `MANAGER`. */
  @ApiProperty({ required: false, type: String, format: 'uuid', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRANCH_IDS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];
}
