import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/**
 * Routing shared by `main.ts` and the OpenAPI generator, so the document lists the real paths
 * (decision 0004 section 1). Decision 0005 section 1: feature endpoints are served under /api/v1.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
