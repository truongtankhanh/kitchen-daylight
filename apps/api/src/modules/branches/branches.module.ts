import { Module } from '@nestjs/common';

import { BranchScopeModule } from '../../common/branch-scope/branch-scope.module.js';
import { clockProvider } from '../../common/time/clock.js';
import { AuditModule } from '../audit/audit.module.js';
import { AdminBranchHoursController } from './admin-branch-hours.controller.js';
import { AdminBranchesController } from './admin-branches.controller.js';
import { BranchHoursService } from './branch-hours.service.js';
import { BranchesService } from './branches.service.js';

/**
 * Branches (phase 5). A5-T2: `/admin/branches` list, detail, create, update and soft delete.
 * A5-T3: `/admin/branches/{id}/hours` and the `todayHours` of the list and detail (the `Clock`
 * gives today's Vietnam date). Uses the application's global TypeORM `DataSource` and the global
 * `ORDERS_FACTS` binding of `AppModule` (`OrdersFactsModule.forRoot`); exports no repository.
 */
@Module({
  imports: [AuditModule, BranchScopeModule],
  controllers: [AdminBranchesController, AdminBranchHoursController],
  providers: [BranchesService, BranchHoursService, clockProvider],
})
export class BranchesModule {}
