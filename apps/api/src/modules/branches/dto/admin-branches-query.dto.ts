import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { BRANCH_STATUSES } from '../entities/branch.entity.js';
import type { BranchStatus } from '../entities/branch.entity.js';

/** A bound on `q` before any work: longer than any branch name (api-divergences D-133). */
export const ADMIN_BRANCHES_Q_MAX_LENGTH = 100;

/** Highest `rowVersion` a client can send: the PostgreSQL `integer` maximum. */
export const ROW_VERSION_MAX = 2_147_483_647;

/**
 * Query of `GET /api/v1/admin/branches` (api-outline "Branches", brief C2). Sorted by
 * `sort_order`, then name; soft-deleted branches never appear.
 */
export class AdminBranchesQueryDto extends PageQueryDto {
  /** A fragment of the name or the code, accent and case insensitive. */
  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_BRANCHES_Q_MAX_LENGTH)
  q?: string;

  @ApiProperty({ required: false, enum: BRANCH_STATUSES })
  @IsOptional()
  @IsIn(BRANCH_STATUSES)
  status?: BranchStatus;
}

/** Query of `DELETE /api/v1/admin/branches/{id}`: the version the dialog was showing. */
export class AdminBranchDeleteQueryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROW_VERSION_MAX)
  rowVersion!: number;
}
