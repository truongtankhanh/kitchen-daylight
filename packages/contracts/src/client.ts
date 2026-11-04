// `@kd/contracts/client` (decision 0004 section 5): the typed API client for the admin and the
// mobile app. Forbidden for `@kd/api`, so the API never loads `openapi-fetch`.
import createClient from 'openapi-fetch';
import type { Client, ClientOptions } from 'openapi-fetch';

import type { paths } from './generated/openapi.js';

export type { components, operations, paths } from './generated/openapi.js';

export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** Prepended to every path of the document; the paths already start with `/api`. */
  readonly baseUrl: string;
  readonly fetch?: ClientOptions['fetch'];
  readonly headers?: ClientOptions['headers'];
}

const API_ROOT_SUFFIX = /\/api\/?$/;

/**
 * Turns the API root of an app's configuration (for example `/api` or `https://host/api`) into the
 * client base URL (`''` or `https://host`), because the document's paths already carry `/api`.
 */
export function toClientBaseUrl(apiRoot: string): string {
  if (!API_ROOT_SUFFIX.test(apiRoot)) {
    throw new Error(`The API root must end with /api, got "${apiRoot}"`);
  }
  return apiRoot.replace(API_ROOT_SUFFIX, '');
}

/**
 * Returns an `openapi-fetch` client typed with the generated `paths`. Middleware (auth,
 * `X-Client`, `X-App-Version`, `Accept-Language`) is registered by the slices that need it.
 */
export function createApiClient({ baseUrl, fetch, headers }: ApiClientOptions): ApiClient {
  return createClient<paths>({
    baseUrl,
    ...(fetch === undefined ? {} : { fetch }),
    ...(headers === undefined ? {} : { headers }),
  });
}
