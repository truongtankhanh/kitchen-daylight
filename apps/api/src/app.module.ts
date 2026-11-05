import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { createValidationPipe } from './common/errors/validation.pipe.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { ServerConfig } from './config/load-config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static forRoot(config: ServerConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [AppConfigModule.forRoot(config), LoggingModule, DatabaseModule, HealthModule],
      // Global pipe and filter as providers, so the filter can inject the logger (decision 0007 section 3).
      providers: [
        { provide: APP_PIPE, useFactory: createValidationPipe },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
