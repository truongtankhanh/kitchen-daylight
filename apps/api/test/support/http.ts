import { isProblemDetails } from '@kd/contracts';
import type { ProblemDetails } from '@kd/contracts';

/** What a spec sends. A `body` other than `undefined` is sent as JSON. */
export interface TestRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface TestResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON for `application/json` and `application/problem+json`, text otherwise, `null` when empty. */
  readonly body: unknown;
  /** The body when the response is `application/problem+json` with the RFC 9457 shape, else `null`. */
  readonly problem: ProblemDetails | null;
}

export interface TestHttpClient {
  request(path: string, request?: TestRequest): Promise<TestResponse>;
  get(path: string, request?: Omit<TestRequest, 'method' | 'body'>): Promise<TestResponse>;
  post(
    path: string,
    body?: unknown,
    request?: Omit<TestRequest, 'method' | 'body'>,
  ): Promise<TestResponse>;
}

const REQUEST_TIMEOUT_MS = 10_000;

function mediaTypeOf(headers: Headers): string {
  return (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return null;
  }
  const mediaType = mediaTypeOf(response.headers);
  if (mediaType === 'application/json' || mediaType === 'application/problem+json') {
    return JSON.parse(text) as unknown;
  }
  return text;
}

/**
 * A thin wrapper of the global `fetch` of Node 26 (decision 0007 section 2: no `supertest`) bound to
 * a test app's `baseUrl`. Never follows a redirect, so a spec sees the real status.
 */
export function http(baseUrl: string): TestHttpClient {
  async function request(path: string, init: TestRequest = {}): Promise<TestResponse> {
    const headers = new Headers(init.headers);
    let body: string | undefined;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
    const response = await fetch(new URL(path, baseUrl), {
      method: init.method ?? 'GET',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = await parseBody(response);
    const problem =
      mediaTypeOf(response.headers) === 'application/problem+json' && isProblemDetails(parsed)
        ? parsed
        : null;
    return { status: response.status, headers: response.headers, body: parsed, problem };
  }

  return {
    request,
    get: (path, init = {}) => request(path, { ...init, method: 'GET' }),
    post: (path, body, init = {}) => request(path, { ...init, method: 'POST', body }),
  };
}
