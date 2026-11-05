import type { IncomingMessage, ServerResponse } from 'node:http';

import { Catch, HttpException, Inject } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ERROR_STATUS } from '@kd/contracts';
import type { ErrorCode, ErrorStatus, ProblemDetails } from '@kd/contracts';
import { PinoLogger } from 'nestjs-pino';

import { isHealthCheck } from '../logging/logging.module.js';
import { ApiError } from './api-error.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** `title` of the body: the RFC 9110 reason phrase of the status (RFC 9457 section 4.2.1). */
export const STATUS_TITLE: Readonly<Record<ErrorStatus, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

// A Nest `HttpException` (or a body-parser error) that is not an `ApiError` maps by its status.
// Any other status is a programming error: it becomes `500 INTERNAL_ERROR` and is logged.
const CODE_BY_HTTP_STATUS: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'TOO_LARGE',
  415: 'UNSUPPORTED_TYPE',
  429: 'RATE_LIMITED',
};

const INTERNAL_DETAIL = 'An unexpected error occurred.';

type FilterRequest = IncomingMessage & { readonly originalUrl?: string; readonly id?: unknown };
type FilterResponse = ServerResponse & {
  status(code: number): unknown;
  json(body: unknown): unknown;
};

/** An error thrown by Express's body parser: `{ type: 'entity.parse.failed', status: 400, … }`. */
function bodyParserStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const { type, status } = exception as { type?: unknown; status?: unknown };
  if (typeof type !== 'string' || typeof status !== 'number' || status < 400 || status > 499) {
    return undefined;
  }
  return type === 'entity.parse.failed' ? 400 : status;
}

function problem(
  code: ErrorCode,
  fields: Partial<Pick<ProblemDetails<ErrorCode>, 'detail' | 'errors'>> = {},
  extras: Readonly<Record<string, unknown>> = {},
): ProblemDetails<ErrorCode> {
  const status = ERROR_STATUS[code];
  return {
    ...extras,
    type: 'about:blank',
    title: STATUS_TITLE[status],
    status,
    code,
    ...(fields.detail === undefined ? {} : { detail: fields.detail }),
    ...(fields.errors === undefined ? {} : { errors: fields.errors }),
  };
}

export interface ResolvedProblem {
  readonly body: ProblemDetails<ErrorCode>;
  /** True when the error was not expected: it is logged and its details never reach the body. */
  readonly unexpected: boolean;
}

/** Pure mapping from anything thrown to the problem+json body (decision 0007 section 9). */
export function resolveProblem(exception: unknown): ResolvedProblem {
  if (exception instanceof ApiError) {
    const fields = {
      ...(exception.detail === undefined ? {} : { detail: exception.detail }),
      ...(exception.errors === undefined ? {} : { errors: [...exception.errors] }),
    };
    return { body: problem(exception.code, fields, exception.extras), unexpected: false };
  }

  const status =
    exception instanceof HttpException ? exception.getStatus() : bodyParserStatus(exception);
  const code = status === undefined ? undefined : CODE_BY_HTTP_STATUS[status];
  if (code !== undefined) {
    // No `detail`: Nest's messages repeat the URL ("Cannot GET /…"), which may carry a token.
    return {
      body: problem(code, code === 'VALIDATION_FAILED' ? { errors: [] } : {}),
      unexpected: false,
    };
  }

  return { body: problem('INTERNAL_ERROR', { detail: INTERNAL_DETAIL }), unexpected: true };
}

/**
 * Writes every error as `application/problem+json` typed with `ProblemDetails<ErrorCode>`.
 * Exemption: `GET /api/health` keeps its own report as the `503` body (decision 0005 section 1).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@Inject(PinoLogger) private readonly logger: PinoLogger) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FilterRequest>();
    const response = http.getResponse<FilterResponse>();

    if (exception instanceof HttpException && isHealthCheck(request)) {
      this.reply(response, exception.getStatus(), exception.getResponse());
      return;
    }

    const { body, unexpected } = resolveProblem(exception);
    if (unexpected) {
      // The real error goes to the log only (the `err` serializer keeps its allow-list).
      this.logger.error({ err: exception, requestId: request.id }, 'unexpected error');
    }
    if (body.code === 'RATE_LIMITED') {
      copyNamedRetryAfter(response);
    }
    response.setHeader('Content-Type', PROBLEM_CONTENT_TYPE);
    this.reply(response, body.status, body);
  }

  private reply(response: FilterResponse, status: number, body: unknown): void {
    if (response.headersSent) {
      return;
    }
    response.status(status);
    response.json(body);
  }
}

/**
 * `@nestjs/throttler` names the header `Retry-After-<name>` for a throttler not named `default`;
 * the API always answers a plain `Retry-After` (decision 0007 section 5).
 */
function copyNamedRetryAfter(response: FilterResponse): void {
  if (response.getHeader('Retry-After') !== undefined) {
    return;
  }
  const named = response.getHeaderNames().find((name) => name.startsWith('retry-after-'));
  const value = named === undefined ? undefined : response.getHeader(named);
  if (value !== undefined) {
    response.setHeader('Retry-After', value);
  }
}
