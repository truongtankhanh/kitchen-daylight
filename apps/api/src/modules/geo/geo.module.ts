import { Module } from '@nestjs/common';

import { AdminWardsController } from './admin-wards.controller.js';
import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';

/**
 * Provinces and wards (A2-T3): the two public lists for addresses. Uses the application's global
 * TypeORM `DataSource`; the rows are written by `seed reference`, never by the API. A5-T5 adds the
 * staff ward search `GET /admin/wards` (`AdminWardsController`, `GeoService.searchWards`).
 */
@Module({
  controllers: [GeoController, AdminWardsController],
  providers: [GeoService],
})
export class GeoModule {}
