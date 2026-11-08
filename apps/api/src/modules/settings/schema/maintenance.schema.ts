import { IsBoolean, IsDefined, IsISO8601, IsString, MaxLength, ValidateIf } from 'class-validator';

import { defineSettingSchema, IsNotBlank } from './setting-rules.js';

// `maintenance` (data-model `app_settings`; brief L13, E18): blocks customer-facing paths only.

/** A bound the documents do not state (api-divergences D-105). */
export const MAINTENANCE_MESSAGE_MAX_LENGTH = 500;

export interface MaintenanceSetting {
  readonly enabled: boolean;
  readonly message: string | null;
  /** ISO 8601 instant, or `null` when unknown. */
  readonly expectedBackAt: string | null;
  /** ISO 8601 instant at which maintenance began, or `null`. */
  readonly since: string | null;
}

/** `app_settings.value` of key `maintenance`, data-model names. */
export interface MaintenanceStored {
  readonly enabled: boolean;
  readonly message: string | null;
  readonly expected_back_at: string | null;
  readonly since: string | null;
}

/** Every field is present; a nullable one takes `null`. */
export class MaintenanceSettingDto implements MaintenanceSetting {
  @IsDefined()
  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((dto: MaintenanceSettingDto) => dto.message !== null)
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(MAINTENANCE_MESSAGE_MAX_LENGTH)
  message!: string | null;

  @ValidateIf((dto: MaintenanceSettingDto) => dto.expectedBackAt !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  expectedBackAt!: string | null;

  @ValidateIf((dto: MaintenanceSettingDto) => dto.since !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  since!: string | null;
}

export function toMaintenanceStored(value: MaintenanceSetting): MaintenanceStored {
  return {
    enabled: value.enabled,
    message: value.message,
    expected_back_at: value.expectedBackAt,
    since: value.since,
  };
}

export function fromMaintenanceStored(stored: MaintenanceStored): MaintenanceSetting {
  return {
    enabled: stored.enabled,
    message: stored.message,
    expectedBackAt: stored.expected_back_at,
    since: stored.since,
  };
}

export const maintenanceSchema = defineSettingSchema<
  'maintenance',
  MaintenanceSetting,
  MaintenanceStored
>({
  key: 'maintenance',
  storageKey: 'maintenance',
  dto: MaintenanceSettingDto,
  toStored: toMaintenanceStored,
  fromStored: fromMaintenanceStored,
});
