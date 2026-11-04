import { createApiClient, toClientBaseUrl } from '@kd/contracts/client';
import type { ApiClient } from '@kd/contracts/client';
import Constants from 'expo-constants';

/**
 * The typed API client of the mobile app (decision 0004 section 5). The API root comes from
 * `extra.apiBaseUrl`, set per variant by `app.config.ts` (decision 0006 item 9).
 */
export function createMobileApiClient(): ApiClient {
  const apiRoot: unknown = Constants.expoConfig?.extra?.['apiBaseUrl'];
  if (typeof apiRoot !== 'string') {
    throw new Error('extra.apiBaseUrl is missing from the app config');
  }
  return createApiClient({ baseUrl: toClientBaseUrl(apiRoot) });
}
