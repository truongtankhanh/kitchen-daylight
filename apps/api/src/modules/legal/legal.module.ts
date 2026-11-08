import { Module } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import { LegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';

/**
 * Legal documents and consent (A2-T1: current-document lookup and consent recording; A4-T4:
 * `GET /legal/documents/current`). Uses the application's global TypeORM `DataSource`.
 */
@Module({
  controllers: [LegalController],
  providers: [LegalService, clockProvider],
  exports: [LegalService],
})
export class LegalModule {}
