import { Inject, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { ServerConfig } from './load-config.js';

/** Injection token of the validated, frozen `ServerConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Typed accessor: `constructor(@InjectAppConfig() private readonly config: ServerConfig)`. */
export const InjectAppConfig = (): PropertyDecorator & ParameterDecorator => Inject(APP_CONFIG);

/** Provides the config validated in `main.ts` before Nest boots (decision 0005, section 4). */
@Module({})
export class AppConfigModule {
  static forRoot(config: ServerConfig): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
