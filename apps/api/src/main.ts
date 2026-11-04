import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

// Placeholder until the validated config of P4-T2 (decision 0005, section 2: `PORT`, default 3000).
const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Routing fixed by decision 0005, section 1: feature endpoints are served under /api/v1.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  await app.listen(Number(process.env.PORT ?? DEFAULT_PORT));
}

await bootstrap();
