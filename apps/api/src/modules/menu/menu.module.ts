import { Module } from '@nestjs/common';

import { AdminCategoriesController } from './admin-categories.controller.js';
import { AdminTagsController } from './admin-tags.controller.js';
import { CategoriesService } from './categories.service.js';
import { TagsService } from './tags.service.js';

/**
 * The menu (phase 6). A6-T4 mapped the tables (`entities/`); A6-T5: `/admin/tags`
 * (`TagsService`); A6-T6: `/admin/menu-categories` (`CategoriesService`). Uses the application's
 * global TypeORM `DataSource`; exports no repository.
 */
@Module({
  controllers: [AdminTagsController, AdminCategoriesController],
  providers: [TagsService, CategoriesService],
})
export class MenuModule {}
