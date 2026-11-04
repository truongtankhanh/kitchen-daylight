import { createApiClient, toClientBaseUrl } from '@kd/contracts/client';
import type { ApiClient } from '@kd/contracts/client';

import { environment } from '../../environments/environment';

/**
 * The typed API client of the admin (decision 0004 section 5), same origin: Caddy, or the
 * `ng serve` proxy, routes `/api` to the API.
 */
export function createAdminApiClient(): ApiClient {
  return createApiClient({ baseUrl: toClientBaseUrl(environment.apiBaseUrl) });
}
