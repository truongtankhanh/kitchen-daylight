import { Module } from '@nestjs/common';

import { BranchScopeModule } from '../../common/branch-scope/branch-scope.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AdminBranchesController } from './admin-branches.controller.js';
import { BranchesService } from './branches.service.js';

/**
 * Branches (phase 5). A5-T2: `/admin/branches` list, detail, create, update and soft delete. Uses
 * the application's global TypeORM `DataSource` and the global `ORDERS_FACTS` binding of
 * `AppModule` (`OrdersFactsModule.forRoot`); exports no repository.
 */
@Module({
  imports: [AuditModule, BranchScopeModule],
  controllers: [AdminBranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
