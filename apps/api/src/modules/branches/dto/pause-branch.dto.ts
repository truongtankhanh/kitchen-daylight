import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsDefined } from 'class-validator';

import type { BranchPauseView } from '../branch-pause.service.js';
import { BRANCH_STATUSES } from '../entities/branch.entity.js';
import type { BranchStatus } from '../entities/branch.entity.js';

/**
 * Body of `POST /api/v1/admin/branches/{id}/pause` (api-outline "Branches"). No `rowVersion` and
 * no `reason` (brief A25 is open); `pauseMessage` is not touched.
 */
export class PauseBranchDto {
  /** `true` pauses an `ACTIVE` branch, `false` reopens a `TEMPORARILY_CLOSED` one. */
  @IsDefined()
  @IsBoolean()
  paused!: boolean;
}

/** The branch after the call (api-divergences D-145). */
@ApiSchema({ name: 'AdminBranchPauseResult' })
export class BranchPauseResultDto implements BranchPauseView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: BRANCH_STATUSES })
  status!: BranchStatus;

  @ApiProperty({ type: 'integer' })
  rowVersion!: number;
}
