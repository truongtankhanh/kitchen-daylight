import { createHash } from 'node:crypto';

/** Orders the members of every plain object; arrays keep their order. Runs after `toJSON`. */
function sortedMembers(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

/**
 * Canonical JSON of a request body: object keys sorted at every level, array order kept, no
 * whitespace. JSON rules otherwise apply: `1` and `1.0` are the same number, a `Date` is its ISO
 * string, an `undefined` member is left out, and a missing body is `null`.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, sortedMembers);
}

/** Values of the route template's parameters, by name: `{ id: '…' }` for `/admin/users/{id}/points`. */
export type PathParams = Readonly<Record<string, string>>;

/**
 * SHA-256 (lower-case hex) of the request an `Idempotency-Key` stands for: the method, the route
 * template, its path parameters and the canonical body (decision 0007 section 10). Key order and
 * whitespace of the body do not change it; array order does.
 *
 * The path parameters are hashed because the route template alone does not tell two targets apart:
 * without them, the same key and body sent to two users of `POST /admin/users/{id}/points` would
 * replay the first adjustment (api-divergences D-023).
 */
export function hashRequest(
  method: string,
  routeTemplate: string,
  body: unknown,
  pathParams: PathParams = {},
): string {
  const request = canonicalJson({ params: pathParams, body: body ?? null });
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${routeTemplate}\n${request}`)
    .digest('hex');
}
