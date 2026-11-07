import { Module } from '@nestjs/common';

import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';

/**
 * Provinces and wards (A2-T3): the two public lists for addresses. Uses the application's global
 * TypeORM `DataSource`; the rows are written by `seed reference`, never by the API.
 */
@Module({
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
