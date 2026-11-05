import { Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';

/**
 * Audit slice (decision 0007 section 3): the `audit_logs` writer only. The viewer endpoint is
 * A12-T7 and the 24-month purge A12-T1. A module that writes audit rows imports this one; it
 * needs the `DataSource` of `DatabaseModule`.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
