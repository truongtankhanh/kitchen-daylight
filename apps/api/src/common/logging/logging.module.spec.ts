import type { IncomingMessage } from 'node:http';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { buildPinoHttpOptions, isHealthCheck } from './logging.module.js';
import { REDACT_PATHS, redactOptions } from './redaction.js';

type LogLine = Record<string, unknown>;

/** A pino logger writing JSON lines to memory instead of stdout. */
function capture(options: pino.LoggerOptions): {
  logger: pino.Logger;
  lines: string[];
  last: () => LogLine;
} {
  const lines: string[] = [];
  const logger = pino(options, {
    write: (line: string) => {
      lines.push(line);
    },
  });
  const last = (): LogLine => JSON.parse(lines.at(-1) ?? '{}') as LogLine;
  return { logger, lines, last };
}

/** The pino part of the module's options (the rest is read by pino-http only). */
function moduleLoggerOptions(): pino.LoggerOptions {
  const { level, redact, serializers } = buildPinoHttpOptions('info');
  return { level, redact, serializers };
}

const FIELD_NAMES = REDACT_PATHS.filter((path) => path.startsWith('*.')).map((path) =>
  path.slice(2),
);

describe('buildPinoHttpOptions', () => {
  it('uses the configured level and no transport (JSON to stdout)', () => {
    const options = buildPinoHttpOptions('warn');
    expect(options.level).toBe('warn');
    expect(options.transport).toBeUndefined();
    expect(options.redact).toEqual(redactOptions());
  });

  it('censors every field path of REDACT_PATHS', () => {
    const { logger, last } = capture(moduleLoggerOptions());
    for (const name of FIELD_NAMES) {
      logger.info({ payload: { [name]: `secret-${name}`, kept: 'visible' } }, 'field');
      const line = last();
      expect(line['payload'], name).toEqual({ [name]: '[redacted]', kept: 'visible' });
    }
  });

  it('censors every header path of REDACT_PATHS when a header reaches a log line', () => {
    // Without the serializers, so the headers stay in the object and the redaction alone is tested.
    const { logger, last } = capture({ redact: buildPinoHttpOptions('info').redact });
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer secret-token',
            cookie: 'kd_rt=secret-cookie',
            accept: 'json',
          },
        },
        res: { headers: { 'set-cookie': ['kd_rt=secret-cookie'], 'content-type': 'json' } },
      },
      'headers',
    );
    expect(last()['req']).toEqual({
      headers: { authorization: '[redacted]', cookie: '[redacted]', accept: 'json' },
    });
    expect(last()['res']).toEqual({
      headers: { 'set-cookie': '[redacted]', 'content-type': 'json' },
    });
  });

  it('writes a request line with no header, no body and a sanitized url', () => {
    const { logger, lines, last } = capture(moduleLoggerOptions());
    logger.info(
      {
        req: {
          id: '0192f0a4-7b3c-7d2e-9f10-3a4b5c6d7e8f',
          method: 'GET',
          url: '/api/v1/branches?lat=10.776543&lng=106.700981&token=secret-query-token',
          headers: { authorization: 'Bearer secret-token', cookie: 'kd_rt=secret-cookie' },
          body: { password: 'secret-password' },
        },
        res: { statusCode: 200, headers: { 'set-cookie': ['kd_rt=secret-cookie'] } },
        responseTime: 4,
      },
      'request completed',
    );

    const line = last();
    expect(line['req']).toEqual({
      id: '0192f0a4-7b3c-7d2e-9f10-3a4b5c6d7e8f',
      method: 'GET',
      url: '/api/v1/branches?lat=10.78&lng=106.7&token=[redacted]',
    });
    expect(line['res']).toEqual({ statusCode: 200 });
    expect(line['responseTime']).toBe(4);

    const raw = lines.join('');
    expect(raw).not.toContain('headers');
    expect(raw).not.toContain('secret-');
    expect(raw).not.toContain('10.776543');
  });
});

describe('isHealthCheck', () => {
  const request = (method: string, url: string, originalUrl?: string): IncomingMessage =>
    ({ method, url, originalUrl }) as unknown as IncomingMessage;

  it.each([
    ['GET', '/api/health', true],
    ['GET', '/api/health?probe=1', true],
    ['HEAD', '/api/health', false],
    ['POST', '/api/health', false],
    ['GET', '/api/healthz', false],
    ['GET', '/api/v1/health', false],
    ['GET', '/api/v1/branches', false],
  ])('%s %s → %s', (method, url, expected) => {
    expect(isHealthCheck(request(method, url))).toBe(expected);
  });

  it('reads originalUrl when Express stripped a mount path', () => {
    expect(isHealthCheck(request('GET', '/', '/api/health'))).toBe(true);
  });
});
