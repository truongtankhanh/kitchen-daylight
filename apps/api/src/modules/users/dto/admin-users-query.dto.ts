import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { USER_ROLES, USER_STATUSES } from '../entities/user.entity.js';
import type { UserRole, UserStatus } from '../entities/user.entity.js';

/** A bound on `q` before any work: the longest email (RFC 5321). */
export const ADMIN_USERS_Q_MAX_LENGTH = 254;

/** `scope=staff`: the three staff roles (api-outline, brief E14). */
export const ADMIN_USER_SCOPES = ['staff'] as const;
export type AdminUserScope = (typeof ADMIN_USER_SCOPES)[number];

/** A repeated query parameter arrives as an array, a single one as a string. */
function toArray({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? [value] : value;
}

/**
 * Query of `GET /api/v1/admin/users` (api-outline "Users and operations"; brief E2, E12, E14, M19;
 * api-divergences D-089). `role`, `roles` and `scope` narrow the roles together (intersection).
 */
export class AdminUsersQueryDto extends PageQueryDto {
  /**
   * Staff: a fragment of the display name (accent-insensitive) or of the email. Customers: the full
   * email or the full phone only (brief E2).
   */
  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_USERS_Q_MAX_LENGTH)
  q?: string;

  @ApiProperty({ required: false, enum: USER_ROLES })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  /** Several roles, as a repeated parameter (`roles=STAFF&roles=MANAGER`). */
  @ApiProperty({ required: false, enum: USER_ROLES, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(USER_ROLES.length)
  @IsIn(USER_ROLES, { each: true })
  roles?: UserRole[];

  /** `staff`: `STAFF`, `MANAGER` and `ADMIN` only. */
  @ApiProperty({ required: false, enum: ADMIN_USER_SCOPES })
  @IsOptional()
  @IsIn(ADMIN_USER_SCOPES)
  scope?: AdminUserScope;

  /** Without it, `DELETED` accounts are left out. */
  @ApiProperty({ required: false, enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  /** Staff who work at this branch (`staff_branches`); customers and admins never match. */
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;
}
