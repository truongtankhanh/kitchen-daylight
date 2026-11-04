import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

import { AppModule } from '../app.module.js';
import { loadConfig } from '../config/load-config.js';
import { configureApp } from '../configure-app.js';
import { FieldErrorDto, ProblemDetailsDto } from './problem-details.dto.js';

/** `info.version` of the contract. Set by the release step that writes `openapi.released.json`. */
export const API_DOCUMENT_VERSION = '0.0.0';

// Decision 0004 section 1: placeholders only, no secret and no real host. Port 1 on loopback makes
// any connection attempt fail at once instead of hanging. `AppModule` receives the config as an
// argument, so `process.env` is neither read nor written.
const PLACEHOLDER_ENV = {
  APP_ENV: 'test',
  DATABASE_URL_APP: 'postgres://openapi@127.0.0.1:1/openapi',
} as const;

/**
 * Builds the OpenAPI document without a database or network (decision 0004 section 1). In preview
 * mode no provider or controller is instantiated, so no factory runs and nothing connects. The
 * application is never initialised and never listens.
 */
export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const config = loadConfig(PLACEHOLDER_ENV, 'server');
  const app = await NestFactory.create(AppModule.forRoot(config), {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  try {
    configureApp(app);
    const base = new DocumentBuilder().setTitle('KD API').setVersion(API_DOCUMENT_VERSION).build();
    // The shared error schemas are listed even before a route declares them (decision 0004 section 7).
    return SwaggerModule.createDocument(app, base, {
      excludeDynamicDefaults: true,
      extraModels: [ProblemDetailsDto, FieldErrorDto],
    });
  } finally {
    await app.close();
  }
}

/** Recursively sorts object keys in code-point order; array order is kept (decision 0004 section 2). */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
  }
  return value;
}

/** Deterministic snapshot text: sorted keys, two-space indent, one trailing LF. */
export function serializeDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}
