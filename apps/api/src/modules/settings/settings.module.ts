import { Module } from '@nestjs/common';

import { BranchScopeModule } from '../../common/branch-scope/branch-scope.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AdminMetaController } from './admin-meta.controller.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { SettingsService } from './settings.service.js';

/**
 * The `app_settings` store and its typed getters (A4-T1), `/admin/app-settings` and
 * `/admin/meta/config` (A4-T2). `/meta/config` and `config.changed` come with A4-T3. Uses the
 * application's global TypeORM `DataSource`; `StepUpService` comes from the global `AuthModule`.
 */
@Module({
  imports: [AuditModule, MailModule, BranchScopeModule],
  controllers: [AdminSettingsController, AdminMetaController],
  providers: [SettingsService, AdminSettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
