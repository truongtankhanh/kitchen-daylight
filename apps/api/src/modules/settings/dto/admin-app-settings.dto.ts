import { ApiExtraModels, ApiProperty, ApiSchema, getSchemaPath } from '@nestjs/swagger';
import { IsDefined, IsIn, IsInt, IsObject, Min } from 'class-validator';

import { STAFF_ROLES } from '../../../common/auth/roles.decorator.js';
import type {
  AdminAppSettingsView,
  SavedSettingView,
  SecuritySettingsView,
  SettingActorView,
  SettingRecordView,
} from '../admin-settings.service.js';
import type { StaffRole } from '../permissions.js';
import type { SettingValues } from '../schema/registry.js';
import { SETTING_KEYS } from '../schema/setting-rules.js';
import type { SettingKey } from '../schema/setting-rules.js';
import {
  BrandValueDto,
  FeatureFlagsValueDto,
  LoyaltyValueDto,
  MaintenanceValueDto,
  MinAppVersionValueDto,
  OrderingValueDto,
  PaymentValueDto,
  ReportsValueDto,
  SETTING_VALUE_DTOS,
} from './setting-values.dto.js';

const VALUE_SCHEMA = { oneOf: SETTING_VALUE_DTOS.map((dto) => ({ $ref: getSchemaPath(dto) })) };

/** Who last saved a key: the display name, never an email (brief L1). */
@ApiSchema({ name: 'SettingActor' })
export class SettingActorDto implements SettingActorView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  name!: string;
}

/** Fields every key carries besides its value (brief L1). */
class SettingStateDto {
  /** `0` for a key never saved: it reads as its default, and the first save sends 0. */
  rowVersion!: number;

  /** `null` for a key never saved or written by the seed. */
  @ApiProperty({ type: SettingActorDto, nullable: true })
  updatedBy!: SettingActorDto | null;

  /** `null` for a key never saved. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

@ApiSchema({ name: 'BrandSettingRecord' })
export class BrandRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['brand']>
{
  value!: BrandValueDto;
}

@ApiSchema({ name: 'ReportsSettingRecord' })
export class ReportsRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['reports']>
{
  value!: ReportsValueDto;
}

@ApiSchema({ name: 'MinAppVersionSettingRecord' })
export class MinAppVersionRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['minAppVersion']>
{
  value!: MinAppVersionValueDto;
}

@ApiSchema({ name: 'MaintenanceSettingRecord' })
export class MaintenanceRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['maintenance']>
{
  value!: MaintenanceValueDto;
}

@ApiSchema({ name: 'FeatureFlagsSettingRecord' })
export class FeatureFlagsRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['featureFlags']>
{
  value!: FeatureFlagsValueDto;
}

@ApiSchema({ name: 'PaymentSettingRecord' })
export class PaymentRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['payment']>
{
  value!: PaymentValueDto;
}

@ApiSchema({ name: 'OrderingSettingRecord' })
export class OrderingRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['ordering']>
{
  value!: OrderingValueDto;
}

@ApiSchema({ name: 'LoyaltySettingRecord' })
export class LoyaltyRecordDto
  extends SettingStateDto
  implements SettingRecordView<SettingValues['loyalty']>
{
  value!: LoyaltyValueDto;
}

/**
 * Read-only server configuration (decision 0008 sections 1, 4 and 6; brief L15): shown on the
 * Settings page, never a stored key, refused by `PUT`.
 */
@ApiSchema({ name: 'SecuritySettings' })
export class SecuritySettingsDto implements SecuritySettingsView {
  @ApiProperty({ enum: STAFF_ROLES, isArray: true })
  totpRequiredRoles!: StaffRole[];

  /** Code points, after NFC. */
  staffPasswordMinLength!: number;

  accessTokenMinutes!: number;

  /** Staff refresh idle lifetime. */
  sessionIdleDays!: number;

  /** Staff refresh absolute lifetime. */
  sessionAbsoluteDays!: number;

  /** Lifetime of an invitation link. */
  inviteHours!: number;

  /** Lifetime of a staff password reset link. */
  resetMinutes!: number;
}

/** `GET /admin/app-settings`: every key with its concurrency state, plus `security`. */
@ApiSchema({ name: 'AdminAppSettings' })
export class AdminAppSettingsDto implements AdminAppSettingsView {
  brand!: BrandRecordDto;

  reports!: ReportsRecordDto;

  minAppVersion!: MinAppVersionRecordDto;

  maintenance!: MaintenanceRecordDto;

  featureFlags!: FeatureFlagsRecordDto;

  payment!: PaymentRecordDto;

  ordering!: OrderingRecordDto;

  loyalty!: LoyaltyRecordDto;

  security!: SecuritySettingsDto;
}

/**
 * `PUT /admin/app-settings`: one key per call. `value` is the whole camelCase value of `key`
 * (every field present, a nullable one as `null`), validated by the key's rules; `rowVersion` is
 * the one read (0 for a key never saved). `security` is not a key and is refused.
 */
@ApiSchema({ name: 'AppSettingSave' })
@ApiExtraModels(...SETTING_VALUE_DTOS)
export class AppSettingSaveDto {
  @ApiProperty({ enum: SETTING_KEYS })
  @IsDefined()
  @IsIn(SETTING_KEYS)
  key!: SettingKey;

  @ApiProperty(VALUE_SCHEMA)
  @IsDefined()
  @IsObject()
  value!: Record<string, unknown>;

  @IsDefined()
  @IsInt()
  @Min(0)
  rowVersion!: number;
}

/** The key as saved: the new `rowVersion`, the caller as `updatedBy`, the time of the save. */
@ApiSchema({ name: 'AppSettingSaved' })
export class AppSettingSavedDto extends SettingStateDto implements SavedSettingView {
  @ApiProperty({ enum: SETTING_KEYS })
  key!: SettingKey;

  @ApiProperty(VALUE_SCHEMA)
  value!: SettingValues[SettingKey];
}
