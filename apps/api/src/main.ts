import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
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
  const app = await NestFactory.create(AppModule.forRoot(config));

  // Routing fixed by decision 0005, section 1: feature endpoints are served under /api/v1.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  await app.listen(config.port);
}

await bootstrap();
