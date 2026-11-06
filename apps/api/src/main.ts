import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { readEnvironment } from './config/env-file.js';
import { ConfigValidationError, loadConfig } from './config/load-config.js';
import type { ServerConfig } from './config/load-config.js';

// The repository root `.env` (decision 0005, section 3), resolved from `dist/` and `src/` alike.
const ROOT_ENV_FILE = new URL('../../../.env', import.meta.url);

/** Fails fast before Nest boots: names and rules on stderr, never a value, exit code 1. */
function loadServerConfigOrExit(): ServerConfig {
  try {
    return loadConfig(readEnvironment(ROOT_ENV_FILE, process.env), 'server');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function bootstrap(): Promise<void> {
  const config = loadServerConfigOrExit();
  // Logs written while Nest boots are buffered, then flushed through pino (decision 0005, section 11).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Client address for throttling (decision 0007 section 5): 0 hops without a proxy, 1 behind
  // Caddy. Here and not in `configureApp`, because the OpenAPI generator needs no network setting.
  app.set('trust proxy', config.trustProxyHops);

  configureApp(app);

  app.enableShutdownHooks();

  await app.listen(config.port);
}

await bootstrap();
