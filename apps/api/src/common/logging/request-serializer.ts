import { sanitizeUrl } from './sanitize-url.js';

/**
 * What the serializer reads: the object pino-http's wrapped serializer passes (`id`, `method`,
 * `url`, …) or a raw request (`originalUrl` set by Express). Nothing else is read.
 */
export interface SerializableRequest {
  readonly id?: unknown;
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly originalUrl?: string | undefined;
}

export interface LoggedRequest {
  readonly id: unknown;
  readonly method: string | undefined;
  readonly url: string;
}

export interface SerializableResponse {
  readonly statusCode?: number | undefined;
}

export interface LoggedResponse {
  readonly statusCode: number | undefined;
}

/**
 * `req` serializer (decision 0005, section 11): `id`, `method` and the sanitized `url` only.
 * No header, no body, no query object and no remote address.
 */
export function serializeRequest(req: SerializableRequest): LoggedRequest {
  return {
    id: req.id,
    method: req.method,
    url: sanitizeUrl(req.originalUrl ?? req.url ?? ''),
  };
}

/** `res` serializer: `statusCode` only; pino-http adds `responseTime` beside it. */
export function serializeResponse(res: SerializableResponse): LoggedResponse {
  return { statusCode: res.statusCode };
}
