import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/** Needs the `DataSource` of `DatabaseModule`. */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
