import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import type { ServerConfig } from './config/load-config.js';

@Module({})
export class AppModule {
  static forRoot(config: ServerConfig): DynamicModule {
    return { module: AppModule, imports: [AppConfigModule.forRoot(config)] };
  }
}
