import { Module } from '@nestjs/common';

import { AdminTagsController } from './admin-tags.controller.js';
import { TagsService } from './tags.service.js';

/**
 * The menu (phase 6). A6-T4 mapped the tables (`entities/`); A6-T5: `/admin/tags`
 * (`TagsService`). Uses the application's global TypeORM `DataSource`; exports no repository.
 */
@Module({
  controllers: [AdminTagsController],
  providers: [TagsService],
})
export class MenuModule {}
