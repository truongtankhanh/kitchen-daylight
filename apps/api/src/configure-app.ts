import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

interface ExpressLike {
  disable(setting: string): unknown;
}

function isExpressLike(instance: unknown): instance is ExpressLike {
  return (
    typeof instance === 'function' &&
    typeof (instance as Partial<ExpressLike>).disable === 'function'
  );
}

/**
 * Routing shared by `main.ts` and the OpenAPI generator, so the document lists the real paths
 * (decision 0004 section 1). Decision 0005 section 1: feature endpoints are served under /api/v1.
 * The validation pipe and the problem+json filter are global providers of `AppModule`
 * (decision 0007 section 3), not registered here.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // No `X-Powered-By: Express` (foundation.md section 6.B; decision 0007 row 5).
  const instance: unknown = app.getHttpAdapter().getInstance();
  if (isExpressLike(instance)) {
    instance.disable('x-powered-by');
  }
}
