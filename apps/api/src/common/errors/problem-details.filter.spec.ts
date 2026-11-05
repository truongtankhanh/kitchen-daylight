import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ERROR_CODES, ERROR_STATUS } from '@kd/contracts';
import type { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { HealthController } from '../../health/health.controller.js';
import { HealthService } from '../../health/health.service.js';
import { ApiError } from './api-error.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsFilter,
  STATUS_TITLE,
} from './problem-details.filter.js';

interface FakeResponse {
  headersSent: boolean;
  statusCode: number;
  body: unknown;
  headers: Map<string, unknown>;
  setHeader(name: string, value: unknown): FakeResponse;
  getHeader(name: string): unknown;
  getHeaderNames(): string[];
  status(code: number): FakeResponse;
  json(body: unknown): FakeResponse;
}

function fakeResponse(initial: Record<string, unknown> = {}): FakeResponse {
  const response: FakeResponse = {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    headers: new Map(Object.entries(initial).map(([name, value]) => [name.toLowerCase(), value])),
    setHeader(name, value) {
      response.headers.set(name.toLowerCase(), value);
      return response;
    },
    getHeader(name) {
      return response.headers.get(name.toLowerCase());
    },
    getHeaderNames() {
      return [...response.headers.keys()];
    },
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(body) {
      response.body = body;
      return response;
    },
  };
  return response;
}

function run(
  exception: unknown,
  options: { method?: string; url?: string; headers?: Record<string, unknown> } = {},
): { response: FakeResponse; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  const logger = { setContext: vi.fn(), error } as unknown as PinoLogger;
  const request = {
    method: options.method ?? 'GET',
    url: options.url ?? '/api/v1/branches',
    id: 'req-1',
  };
  const response = fakeResponse(options.headers);
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;

  new ProblemDetailsFilter(logger).catch(exception, host);
  return { response, error };
}

/** Shaped like TypeORM's `QueryFailedError` (fictional values). */
function databaseError(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "users_email_key"'),
    {
      query: 'INSERT INTO "users"("email") VALUES ($1)',
      parameters: ['buyer@example.com'],
      constraint: 'users_email_key',
      code: '23505',
      address: '10.0.0.5',
    },
  );
}

describe('ProblemDetailsFilter', () => {
  it('serializes an ApiError with its status, extras and application/problem+json', () => {
    const { response, error } = run(
      new ApiError('BRANCH_CLOSED', {
        detail: 'The branch is closed.',
        extras: { reason: 'PAUSED', nextOpenAt: null, code: 'OVERRIDE', status: 200 },
      }),
    );

    expect(response.statusCode).toBe(409);
    expect(response.getHeader('Content-Type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'BRANCH_CLOSED',
      detail: 'The branch is closed.',
      reason: 'PAUSED',
      nextOpenAt: null,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('serializes VALIDATION_FAILED with its errors', () => {
    const { response } = run(
      new ApiError('VALIDATION_FAILED', {
        errors: [{ field: 'items.0.quantity', code: 'OUT_OF_RANGE', message: 'is out of range' }],
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'items.0.quantity', code: 'OUT_OF_RANGE', message: 'is out of range' }],
    });
  });

  it.each([
    ['401', new UnauthorizedException(), 401, 'UNAUTHENTICATED', 'Unauthorized'],
    ['403', new ForbiddenException(), 403, 'FORBIDDEN', 'Forbidden'],
    [
      '404 (unknown route)',
      new NotFoundException('Cannot GET /api/v1/x?token=secret-token'),
      404,
      'NOT_FOUND',
      'Not Found',
    ],
    ['413', new PayloadTooLargeException(), 413, 'TOO_LARGE', 'Content Too Large'],
  ])('maps HttpException %s', (_case, exception, status, code, title) => {
    const { response, error } = run(exception);

    expect(response.statusCode).toBe(status);
    expect(response.getHeader('Content-Type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(response.body).toEqual({ type: 'about:blank', title, status, code });
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(error).not.toHaveBeenCalled();
  });

  it('maps 429 to RATE_LIMITED and answers a plain Retry-After from the named throttler header', () => {
    const { response } = run(new HttpException('ThrottlerException: Too Many Requests', 429), {
      headers: { 'Retry-After-auth': '30' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.body).toMatchObject({ code: 'RATE_LIMITED', title: 'Too Many Requests' });
    expect(response.getHeader('Retry-After')).toBe('30');
  });

  it('keeps a Retry-After header that is already set', () => {
    const { response } = run(new HttpException('Too Many Requests', 429), {
      headers: { 'Retry-After': '5', 'Retry-After-auth': '30' },
    });

    expect(response.getHeader('Retry-After')).toBe('5');
  });

  it('answers a malformed JSON body with 400 VALIDATION_FAILED and an empty errors list', () => {
    const syntaxError = Object.assign(
      new SyntaxError('Unexpected token } in JSON at position 12'),
      {
        type: 'entity.parse.failed',
        status: 400,
        statusCode: 400,
        expose: true,
        body: '{"password":"secret-password"}',
      },
    );

    const { response, error } = run(syntaxError, { method: 'POST' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [],
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(error).not.toHaveBeenCalled();
  });

  it('answers a body over the parser limit with 413 TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

    expect(run(tooLarge, { method: 'POST' }).response.body).toMatchObject({
      status: 413,
      code: 'TOO_LARGE',
    });
  });

  it('answers an unknown error with 500 INTERNAL_ERROR and logs it with the request id', () => {
    const exception = databaseError();
    const { response, error } = run(exception);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /INSERT|users_email_key|10\.0\.0\.5|example\.com|stack/,
    );
    expect(error).toHaveBeenCalledWith({ err: exception, requestId: 'req-1' }, 'unexpected error');
  });

  it('treats an HttpException without a catalogue mapping as unexpected', () => {
    const { response, error } = run(new ConflictException('raw conflict'));

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(error).toHaveBeenCalledOnce();
  });

  it('writes nothing once the headers are sent', () => {
    const response = fakeResponse();
    response.headersSent = true;
    const logger = { setContext: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/x' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new ProblemDetailsFilter(logger).catch(new NotFoundException(), host);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeUndefined();
  });

  describe('GET /api/health exemption', () => {
    const DOWN = { status: 'error', checks: { database: 'down' } };

    it('keeps the health report as the 503 body, not a problem+json body', async () => {
      const dataSource = {
        isInitialized: true,
        query: vi.fn(async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
        }),
      } as unknown as DataSource;
      const thrown = await new HealthController(new HealthService(dataSource))
        .check()
        .catch((caught: unknown) => caught);

      const { response, error } = run(thrown, { url: '/api/health' });

      expect(response.statusCode).toBe(503);
      expect(response.body).toEqual(DOWN);
      expect(response.getHeader('Content-Type')).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
    });

    it('applies only to GET /api/health', () => {
      const exception = new ServiceUnavailableException(DOWN);

      expect(run(exception, { url: '/api/v1/branches' }).response.body).toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(run(exception, { method: 'POST', url: '/api/health' }).response.body).toMatchObject({
        code: 'INTERNAL_ERROR',
      });
    });
  });
});

describe('STATUS_TITLE', () => {
  it('has a title for the status of every catalogue code', () => {
    for (const code of ERROR_CODES) {
      expect(STATUS_TITLE[ERROR_STATUS[code]], code).toMatch(/^[A-Z]/);
    }
  });
});
