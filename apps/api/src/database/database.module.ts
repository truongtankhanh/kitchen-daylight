import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/load-config.js';
import { createDataSourceOptions } from './data-source.js';

/**
 * The server's connection, as `kd_app` (decision 0005, section 7). Needs `AppConfigModule`.
 * Not imported by `AppModule` yet: importing it makes the server require a database to boot.
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
