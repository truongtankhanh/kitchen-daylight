import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient } from '../support/http.js';

describe('GET /api/health against PostgreSQL', () => {
  let testApp: TestApp | undefined;
  let client: TestHttpClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('returns 200 with the database up and no X-Powered-By', async () => {
    const response = await client.get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up' } });
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('answers an unknown route with problem+json and no X-Powered-By', async () => {
    const response = await client.get('/api/v1/no-such-route');

    expect(response.status).toBe(404);
    expect(response.problem).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});
