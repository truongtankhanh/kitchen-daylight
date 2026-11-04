import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/load-config.js';
import { createDataSourceOptions } from './data-source.js';

/**
 * The server's connection, as `kd_app` (decision 0005, section 7). Needs `AppConfigModule`.
 * Imported by `AppModule` (since P4-T4), so the server connects at start-up. The OpenAPI
 * generator builds the app in preview mode, where this factory never runs (decision 0004).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ServerConfig) => createDataSourceOptions(config),
    }),
  ],
})
export class DatabaseModule {}
