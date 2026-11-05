import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';

import { APP_CONFIG } from '../../config/config.module.js';
import type { LogLevel } from '../../config/config.schema.js';
import type { ServerConfig } from '../../config/load-config.js';
import { serializeError } from './error-serializer.js';
import { redactOptions } from './redaction.js';
import { genReqId } from './request-id.js';
import { serializeRequest, serializeResponse } from './request-serializer.js';

// The global prefix `api` of `configure-app.ts` plus the version-neutral health route (decision 0005, section 1).
const HEALTH_PATH = '/api/health';

type LoggedIncomingMessage = IncomingMessage & { readonly originalUrl?: string };

/** `GET /api/health` is never logged (decision 0005, section 11); every other request is. */
export function isHealthCheck(req: LoggedIncomingMessage): boolean {
  if (req.method !== 'GET') {
    return false;
  }
  const url = req.originalUrl ?? req.url ?? '';
  const end = url.search(/[?#]/);
  return (end === -1 ? url : url.slice(0, end)) === HEALTH_PATH;
}

/**
 * The pino-http options of the API: level from the validated config, the redaction list, the
 * request id, the health exclusion and the `req`/`res`/`err` serializers (decision 0005 section 11,
 * decision 0007 section 4). JSON to stdout in every tier: no transport, no pretty printer.
 * Pure, so the unit test builds a pino instance from exactly these options.
 */
export function buildPinoHttpOptions(
  level: LogLevel,
): Options<LoggedIncomingMessage, ServerResponse> {
  return {
    level,
    redact: redactOptions(),
    genReqId,
    autoLogging: { ignore: isHealthCheck },
    serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
  };
}

/**
 * Wires `nestjs-pino` with the options above. The logger is built when Nest instantiates the
 * provider, never at import time, so the OpenAPI generator (preview mode) stays free of I/O.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ServerConfig) => ({
        pinoHttp: buildPinoHttpOptions(config.logLevel),
      }),
    }),
  ],
})
export class LoggingModule {}
