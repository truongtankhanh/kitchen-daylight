import { Module } from '@nestjs/common';

import { SettingsService } from './settings.service.js';

/**
 * The `app_settings` store and its typed getters (A4-T1). No controller yet: `/admin/app-settings`
 * (A4-T2) and `/meta/config` (A4-T3) add them. Uses the application's global TypeORM `DataSource`.
 */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
