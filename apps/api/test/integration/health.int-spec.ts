import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient } from '../support/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    expect(response.headers.get('x-request-id')).toMatch(UUID);
  });

  it('echoes X-Request-Id on a malformed JSON body, which never reaches pino-http', async () => {
    const requestId = '0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11';
    // The http() helper always sends valid JSON, so this request uses fetch directly.
    const response = await fetch(new URL('/api/v1/no-such-route', testApp?.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: '{bad',
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(response.headers.get('x-request-id')).toBe(requestId);
    expect(body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(body)).not.toContain('{bad');
  });
});
