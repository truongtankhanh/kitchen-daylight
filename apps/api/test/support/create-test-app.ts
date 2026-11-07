import type { Server } from 'node:http';

import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { inject } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/common/time/clock.js';
import type { FixedClock } from '../../src/common/time/testing.js';
import { createEphemeralAuthEnvironment } from '../../src/config/ephemeral-auth-environment.js';
import { loadConfig } from '../../src/config/load-config.js';
import { describeViolation, productionGuardViolations } from '../../src/config/production-guard.js';
import { configureApp } from '../../src/configure-app.js';

export interface TestAppOptions {
  /** Replaces every `Clock` provider of the app (`overrideProvider`). */
  readonly clock?: FixedClock;
  /** Extra modules, for example the test-only controllers of `test-routes.ts`. */
  readonly imports?: NonNullable<ModuleMetadata['imports']>;
  /**
   * Providers replaced by value (`overrideProvider`), for example the social verifier test double
   * of `fake-social-identity-verifier.ts` (A2-T6). The only way a test double reaches the app.
   */
  readonly providers?: readonly { readonly provide: unknown; readonly useValue: unknown }[];
}

export interface TestApp {
  readonly app: INestApplication;
  /** `http://127.0.0.1:<ephemeral port>`, for `http.ts`. */
  readonly baseUrl: string;
  /** The app's own `DataSource`, as `kd_app`. */
  readonly dataSource: DataSource;
  /** Closes the app and its `DataSource`. Call in `afterAll`. */
  close(): Promise<void>;
}

/**
 * Boots the real `AppModule` against the test database as `kd_app`, wired like `main.ts`
 * (`configureApp`, pino logger), and listens on an ephemeral loopback port (decision 0007
 * section 2). Logs below `warn` are dropped so the suite output stays readable.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { appUrl } = inject('kdTestDatabase');
  // Throw-away auth values for each app (decision 0008, section 12); no key literal in the repository.
  const config = loadConfig(
    {
      APP_ENV: 'test',
      DATABASE_URL_APP: appUrl,
      LOG_LEVEL: 'warn',
      // `AppModule` binds no mail adapter yet; port 1 on loopback makes a stray send fail at once.
      // `mail-smtp.int-spec.ts` reads the Mailpit address of the root `.env` instead.
      MAIL_SMTP_HOST: '127.0.0.1',
      MAIL_SMTP_PORT: '1',
      ...createEphemeralAuthEnvironment('kd-test-'),
    },
    'server',
  );
  // The production guard of `main.ts` (decision 0005, section 5): `test` refuses a real adapter.
  const violations = productionGuardViolations(config);
  if (violations.length > 0) {
    throw new Error(violations.map(describeViolation).join('\n'));
  }

  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config), ...(options.imports ?? [])],
  });
  if (options.clock !== undefined) {
    builder.overrideProvider(Clock).useValue(options.clock);
  }
  for (const { provide, useValue } of options.providers ?? []) {
    builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('The test app is not listening on a TCP port.');
  }
  const dataSource = app.get<DataSource>(getDataSourceToken());

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    dataSource,
    async close() {
      await app.close();
      // TypeOrmModule destroys it on shutdown; this guards a module that did not.
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    },
  };
}
