import { Module } from '@nestjs/common';

import { BranchScopeModule } from '../../common/branch-scope/branch-scope.module.js';
import { clockProvider } from '../../common/time/clock.js';
import { AuditModule } from '../audit/audit.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AdminAmenitiesController } from './admin-amenities.controller.js';
import { AdminBranchHoursController } from './admin-branch-hours.controller.js';
import { AdminBranchesController } from './admin-branches.controller.js';
import { AdminDeliveryZonesController } from './admin-delivery-zones.controller.js';
import { AmenitiesService } from './amenities.service.js';
import { BranchHoursService } from './branch-hours.service.js';
import { BranchPauseService } from './branch-pause.service.js';
import { BranchesService } from './branches.service.js';
import { DeliveryZonesService } from './delivery-zones.service.js';

/**
 * Branches (phase 5). A5-T2: `/admin/branches` list, detail, create, update and soft delete.
 * A5-T3: `/admin/branches/{id}/hours` and the `todayHours` of the list and detail (the `Clock`
 * gives today's Vietnam date). A5-T4: `/admin/branches/{id}/delivery-zones` and the zone check
 * (`DeliveryZonesService.findZoneForPoint`, which the delivery quote of A8-T3 will call). A5-T5:
 * `POST /admin/branches/{id}/pause` (`BranchPauseService`, outbox through `RealtimeModule`). A6-T5:
 * `/admin/amenities` (`AmenitiesService`), the amenity vocabulary of the branch page. Uses the
 * application's global TypeORM `DataSource` and the global `ORDERS_FACTS` binding of `AppModule`
 * (`OrdersFactsModule.forRoot`); exports no repository.
 */
@Module({
  imports: [AuditModule, BranchScopeModule, RealtimeModule],
  controllers: [
    AdminBranchesController,
    AdminBranchHoursController,
    AdminDeliveryZonesController,
    AdminAmenitiesController,
  ],
  providers: [
    AmenitiesService,
    BranchesService,
    BranchHoursService,
    BranchPauseService,
    DeliveryZonesService,
    clockProvider,
  ],
})
export class BranchesModule {}
