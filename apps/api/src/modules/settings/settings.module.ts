import { Module } from '@nestjs/common';

import { BranchScopeModule } from '../../common/branch-scope/branch-scope.module.js';
import { GateSnapshot } from '../../common/gates/gate-snapshot.js';
import { clockProvider } from '../../common/time/clock.js';
import { AuditModule } from '../audit/audit.module.js';
import { MailModule } from '../mail/mail.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AdminMetaController } from './admin-meta.controller.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { MetaController } from './meta.controller.js';
import { PublicConfigService } from './public-config.service.js';
import { SettingsService } from './settings.service.js';

/**
 * The `app_settings` store and its typed getters (A4-T1), `/admin/app-settings` and
 * `/admin/meta/config` (A4-T2), `/meta/config`, the snapshot of the request gates and the
 * `config.changed` outbox row (A4-T3). Exports `GateSnapshot` for the global `AppGatesGuard`
 * (`AppModule`). Uses the application's global TypeORM `DataSource`; `StepUpService` comes from the
 * global `AuthModule`.
 */
@Module({
  imports: [AuditModule, MailModule, BranchScopeModule, RealtimeModule],
  controllers: [AdminSettingsController, AdminMetaController, MetaController],
  providers: [
    SettingsService,
    AdminSettingsService,
    PublicConfigService,
    GateSnapshot,
    clockProvider,
  ],
  exports: [SettingsService, GateSnapshot],
})
export class SettingsModule {}
