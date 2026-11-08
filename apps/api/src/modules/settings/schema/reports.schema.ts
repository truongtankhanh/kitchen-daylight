import { IsDefined } from 'class-validator';

import { defineSettingSchema, IsTimeOfDay } from './setting-rules.js';

// `reports` (data-model `app_settings`; WA14; brief L17).

export interface ReportsSetting {
  /** `HH:mm` in the Vietnam zone; the cutoff of common/time/business-date.ts. */
  readonly businessDayStartsAt: string;
}

/** `app_settings.value` of key `reports`, data-model names. */
export interface ReportsStored {
  readonly business_day_starts_at: string;
}

export class ReportsSettingDto implements ReportsSetting {
  @IsDefined()
  @IsTimeOfDay()
  businessDayStartsAt!: string;
}

export function toReportsStored(value: ReportsSetting): ReportsStored {
  return { business_day_starts_at: value.businessDayStartsAt };
}

export function fromReportsStored(stored: ReportsStored): ReportsSetting {
  return { businessDayStartsAt: stored.business_day_starts_at };
}

export const reportsSchema = defineSettingSchema<'reports', ReportsSetting, ReportsStored>({
  key: 'reports',
  storageKey: 'reports',
  dto: ReportsSettingDto,
  toStored: toReportsStored,
  fromStored: fromReportsStored,
});
