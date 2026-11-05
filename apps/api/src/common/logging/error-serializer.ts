/**
 * What an error may write to a log line. pino's default `err` serializer copies every enumerable
 * property, and TypeORM's `QueryFailedError` carries the SQL `parameters`, the `driverError` and
 * PostgreSQL's `detail` (`Key (email)=(…) already exists.`): values that are personal data or
 * secrets. Only this allow-list is kept (decision 0005 section 11: no secret, code, token,
 * password or contact in logs).
 */
export interface LoggedError {
  readonly type?: string;
  readonly message?: string;
  readonly stack?: string;
  /** PostgreSQL SQLSTATE (`23505`) or Node error code (`ECONNREFUSED`). */
  readonly code?: string;
  /** Name of the violated constraint: a schema identifier, never a value. */
  readonly constraint?: string;
  /** HTTP status of an `HttpException`. */
  readonly status?: number;
}

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

function errorType(source: Record<string, unknown>): string | undefined {
  if (typeof source['type'] === 'string') {
    return source['type'];
  }
  const name = (source as { constructor?: { name?: unknown } }).constructor?.name;
  if (typeof name === 'string' && name !== 'Object') {
    return name;
  }
  return typeof source['name'] === 'string' ? source['name'] : undefined;
}

function httpStatus(source: Record<string, unknown>): number | undefined {
  for (const key of ['status', 'statusCode']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

/**
 * `err` serializer. Receives what pino-http's wrapper passes (the standard serialized error) or a
 * raw `Error`, and returns `type`, `message`, `stack` and the allow-listed fields above. Anything
 * that is not an object is returned unchanged, as pino's own serializer does.
 */
export function serializeError(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) {
    return err;
  }
  const source = err as Record<string, unknown>;
  const logged: { -readonly [K in keyof LoggedError]: LoggedError[K] } = {};

  const type = errorType(source);
  if (type !== undefined) {
    logged.type = type;
  }
  if (typeof source['message'] === 'string') {
    logged.message = source['message'];
  }
  if (typeof source['stack'] === 'string') {
    logged.stack = source['stack'];
  }
  const code = source['code'];
  if (typeof code === 'string' && CODE.test(code)) {
    logged.code = code;
  }
  const constraint = source['constraint'];
  if (typeof constraint === 'string' && IDENTIFIER.test(constraint)) {
    logged.constraint = constraint;
  }
  const status = httpStatus(source);
  if (status !== undefined) {
    logged.status = status;
  }
  return logged;
}
