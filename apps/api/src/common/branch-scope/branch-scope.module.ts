import { Module } from '@nestjs/common';

import { BranchScopeService } from './branch-scope.service.js';

/**
 * Branch scoping (A3-T5). `AppModule` imports it for the global `BranchScopeGuard`; a feature
 * module imports it for `BranchScopeService.assertBranchAccess`. Uses the application's global
 * TypeORM `DataSource`.
 */
@Module({
  providers: [BranchScopeService],
  exports: [BranchScopeService],
})
export class BranchScopeModule {}
