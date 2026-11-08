import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';

import { AuthGuard } from './common/auth/auth.guard.js';
import { RolesGuard } from './common/auth/roles.guard.js';
import { BranchScopeGuard } from './common/branch-scope/branch-scope.guard.js';
import { BranchScopeModule } from './common/branch-scope/branch-scope.module.js';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { createValidationPipe } from './common/errors/validation.pipe.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { AppThrottlerGuard } from './common/throttling/app-throttler.guard.js';
import { ThrottlingModule } from './common/throttling/throttling.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { ServerConfig } from './config/load-config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(config: ServerConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule,
        DatabaseModule,
        // Global: `AuthGuard` verifies access tokens with its `AccessTokenService`.
        AuthModule.forRoot(config.auth),
        ThrottlingModule,
        HealthModule,
        GeoModule,
        // `/me` (A2-T4). Also imported by `AuthModule`; Nest keeps one instance.
        UsersModule,
        // `BranchScopeService` for the global `BranchScopeGuard` (A3-T5).
        BranchScopeModule,
        // The `app_settings` store and typed getters (A4-T1).
        SettingsModule,
      ],
      // Global pipe and filter as providers, so the filter can inject the logger (decision 0007 section 3).
      // The global guards run in the order listed here: throttler, authentication, roles (A1-T7),
      // branch scoping (A3-T5).
      providers: [
        { provide: APP_PIPE, useFactory: createValidationPipe },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: BranchScopeGuard },
      ],
    };
  }
}
