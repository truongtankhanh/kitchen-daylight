import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import { STAFF_ROLES } from '../../../common/auth/roles.decorator.js';
import { BRANCH_STATUSES } from '../../branches/entities/branch.entity.js';
import type { BranchStatus } from '../../branches/entities/branch.entity.js';
import type {
  AdminMetaConfigView,
  MetaBranchView,
  MetaBrandView,
  MetaOrderingView,
  MetaPaymentView,
  MetaUserView,
} from '../admin-settings.service.js';
import { PERMISSION_KEYS } from '../permissions.js';
import type { PermissionKey, StaffRole } from '../permissions.js';
import { RECEIPT_PAPER_WIDTHS } from '../schema/brand.schema.js';
import type { ReceiptPaperWidth } from '../schema/brand.schema.js';
import {
  BoardThresholdsValueDto,
  FeatureFlagsValueDto,
  MaintenanceValueDto,
  ReportsValueDto,
} from './setting-values.dto.js';

@ApiSchema({ name: 'AdminMetaUser' })
export class MetaUserDto implements MetaUserView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  displayName!: string;

  /** The role of the access token. */
  @ApiProperty({ enum: STAFF_ROLES })
  role!: StaffRole;

  /** A confirmed TOTP credential exists. */
  mfaEnabled!: boolean;
}

/** A branch of the switcher: every non-deleted branch for `ADMIN`, the caller's otherwise. */
@ApiSchema({ name: 'AdminMetaBranch' })
export class MetaBranchDto implements MetaBranchView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  code!: string;

  name!: string;

  @ApiProperty({ enum: BRANCH_STATUSES })
  status!: BranchStatus;
}

@ApiSchema({ name: 'AdminMetaOrdering' })
export class MetaOrderingDto implements MetaOrderingView {
  boardThresholds!: BoardThresholdsValueDto;

  boardRefetchSeconds!: number;
}

/** What the counter order shows a customer who pays by transfer (brief A13). */
@ApiSchema({ name: 'AdminMetaPayment' })
export class MetaPaymentDto implements MetaPaymentView {
  @ApiProperty({ type: String, nullable: true })
  bankName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  accountNumber!: string | null;

  /** The account holder. */
  @ApiProperty({ type: String, nullable: true })
  holder!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankCode!: string | null;

  /** The QR image URL; `null` until media uploads exist (A6). */
  @ApiProperty({ type: String, format: 'uri', nullable: true })
  qrUrl!: string | null;
}

@ApiSchema({ name: 'AdminMetaReceipt' })
export class MetaReceiptDto {
  @ApiProperty({ enum: RECEIPT_PAPER_WIDTHS, type: Number })
  paperWidth!: ReceiptPaperWidth;
}

@ApiSchema({ name: 'AdminMetaBrand' })
export class MetaBrandDto implements MetaBrandView {
  /** E.164 (brief C33). */
  @ApiProperty({ type: String, nullable: true })
  hotline!: string | null;

  receipt!: MetaReceiptDto;
}

/**
 * `GET /admin/meta/config` (api-outline AdminMetaConfig; admin-shell-design section 2): what the
 * console needs that the admin-only settings do not give. No secret and no admin-only setting.
 */
@ApiSchema({ name: 'AdminMetaConfig' })
export class AdminMetaConfigDto implements AdminMetaConfigView {
  user!: MetaUserDto;

  @ApiProperty({ type: MetaBranchDto, isArray: true })
  branches!: MetaBranchDto[];

  /** Capability keys computed from the role and the feature flags (brief Z2). */
  @ApiProperty({ enum: PERMISSION_KEYS, isArray: true })
  permissions!: PermissionKey[];

  features!: FeatureFlagsValueDto;

  ordering!: MetaOrderingDto;

  payment!: MetaPaymentDto;

  brand!: MetaBrandDto;

  reports!: ReportsValueDto;

  maintenance!: MaintenanceValueDto;

  /** How often the sidebar counts are refetched (brief Z4); a code constant, not a setting. */
  navCountsRefetchSeconds!: number;
}
