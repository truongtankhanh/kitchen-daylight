import { describe, expect, it } from 'vitest';

import { serializeRequest, serializeResponse } from './request-serializer.js';

describe('serializeRequest', () => {
  it('keeps only id, method and the sanitized url', () => {
    const req = {
      id: '0192f0a4-7b3c-7d2e-9f10-3a4b5c6d7e8f',
      method: 'GET',
      url: '/api/v1/branches?lat=10.776543&token=abc',
      headers: { authorization: 'Bearer secret-token', cookie: 'kd_rt=secret-cookie' },
      query: { lat: '10.776543', token: 'abc' },
      remoteAddress: '203.0.113.7',
      body: { password: 'secret-password' },
    };

    expect(serializeRequest(req)).toEqual({
      id: req.id,
      method: 'GET',
      url: '/api/v1/branches?lat=10.78&token=[redacted]',
    });
  });

  it('prefers originalUrl, which Express keeps when a mount path is stripped', () => {
    expect(
      serializeRequest({
        id: 1,
        method: 'POST',
        url: '/verify',
        originalUrl: '/api/v1/auth/verify?code=123456',
      }),
    ).toEqual({ id: 1, method: 'POST', url: '/api/v1/auth/verify?code=[redacted]' });
  });

  it('logs an empty url when the request has none', () => {
    expect(serializeRequest({})).toEqual({ id: undefined, method: undefined, url: '' });
  });
});

describe('serializeResponse', () => {
  it('keeps only statusCode', () => {
    const res = { statusCode: 401, headers: { 'set-cookie': ['kd_rt=secret-cookie'] } };
    expect(serializeResponse(res)).toEqual({ statusCode: 401 });
  });
});
