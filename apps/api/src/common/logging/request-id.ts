import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Request and response header of the request id (decision 0005 section 11, decision 0007 section 4). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id of a request: the incoming `X-Request-Id` when it is one UUID (lower-cased), otherwise a
 * new UUID. A repeated header, an empty value or any other text is replaced, never echoed.
 */
export function resolveRequestId(
  incoming: string | readonly string[] | undefined,
  generate: () => string = randomUUID,
): string {
  if (typeof incoming === 'string' && UUID.test(incoming)) {
    return incoming.toLowerCase();
  }
  return generate();
}

/**
 * `genReqId` of pino-http: picks the id and echoes it in the `X-Request-Id` response header on
 * every response (decision 0007, section 4).
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const id = resolveRequestId(req.headers['x-request-id']);
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
