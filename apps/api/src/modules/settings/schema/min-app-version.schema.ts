import { IsDefined } from 'class-validator';

import { defineSettingSchema, IsVersion } from './setting-rules.js';

// `min_app_version` (data-model `app_settings`; brief L12): the forced-update floor per platform.

export interface MinAppVersionSetting {
  /** `x.y.z`. */
  readonly ios: string;
  /** `x.y.z`. */
  readonly android: string;
}

/** `app_settings.value` of key `min_app_version`; the field names are the same. */
export interface MinAppVersionStored {
  readonly ios: string;
  readonly android: string;
}

export class MinAppVersionSettingDto implements MinAppVersionSetting {
  @IsDefined()
  @IsVersion()
  ios!: string;

  @IsDefined()
  @IsVersion()
  android!: string;
}

export function toMinAppVersionStored(value: MinAppVersionSetting): MinAppVersionStored {
  return { ios: value.ios, android: value.android };
}

export function fromMinAppVersionStored(stored: MinAppVersionStored): MinAppVersionSetting {
  return { ios: stored.ios, android: stored.android };
}

export const minAppVersionSchema = defineSettingSchema<
  'minAppVersion',
  MinAppVersionSetting,
  MinAppVersionStored
>({
  key: 'minAppVersion',
  storageKey: 'min_app_version',
  dto: MinAppVersionSettingDto,
  toStored: toMinAppVersionStored,
  fromStored: fromMinAppVersionStored,
});
