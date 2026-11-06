import { Module } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import { LegalService } from './legal.service.js';

/**
 * Legal documents and consent (A2-T1: current-document lookup and consent recording). Uses the
 * application's global TypeORM `DataSource`. The consent endpoint arrives with A4-T4.
 */
@Module({
  providers: [LegalService, clockProvider],
  exports: [LegalService],
})
export class LegalModule {}
