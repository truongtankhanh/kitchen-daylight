import { describe, expect, it } from 'vitest';

import { sanitizeUrl } from './sanitize-url.js';

describe('sanitizeUrl', () => {
  it.each([
    ['no query', '/api/v1/branches', '/api/v1/branches'],
    ['empty query', '/api/v1/branches?', '/api/v1/branches?'],
    [
      'other parameters kept as sent',
      '/api/v1/menu/search?q=b%C3%B2&page=2',
      '/api/v1/menu/search?q=b%C3%B2&page=2',
    ],
    [
      'lat and lng with many decimals',
      '/api/v1/branches?lat=10.776543219&lng=106.700981234&pageSize=20',
      '/api/v1/branches?lat=10.78&lng=106.7&pageSize=20',
    ],
    [
      'latitude and longitude',
      '/api/v1/orders/quote?latitude=-33.868819&longitude=151.209295',
      '/api/v1/orders/quote?latitude=-33.87&longitude=151.21',
    ],
    [
      'repeated lat',
      '/api/v1/branches?lat=10.7766&lat=10.1234',
      '/api/v1/branches?lat=10.78&lat=10.12',
    ],
    [
      'non-numeric coordinate',
      '/api/v1/branches?lat=abc&lng=',
      '/api/v1/branches?lat=[redacted]&lng=[redacted]',
    ],
    [
      'hex and exponent are not coordinates',
      '/x?lat=0x1A&lng=1e2',
      '/x?lat=[redacted]&lng=[redacted]',
    ],
    [
      'token and code',
      '/api/v1/auth/verify?token=abc.def.ghi&code=123456&email=a',
      '/api/v1/auth/verify?token=[redacted]&code=[redacted]&email=a',
    ],
    ['repeated token', '/x?token=a&token=b', '/x?token=[redacted]&token=[redacted]'],
    [
      'mixed-case names, original spelling kept',
      '/x?LAT=10.7766&Lng=106.7009&Token=abc&CODE=123456',
      '/x?LAT=10.78&Lng=106.7&Token=[redacted]&CODE=[redacted]',
    ],
    ['percent-encoded name', '/x?%74oken=abc&l%61t=10.7766', '/x?%74oken=[redacted]&l%61t=10.78'],
    ['percent-encoded value', '/x?lat=10%2E7766', '/x?lat=10.78'],
    ['malformed % in a value', '/x?q=100%&lat=10.7766', '/x?q=100%&lat=10.78'],
    ['malformed % in a coordinate', '/x?lat=10%ZZ', '/x?lat=[redacted]'],
    ['malformed % in a name', '/x?to%ken=abc&%E0%A4%A=1', '/x?to%ken=abc&%E0%A4%A=1'],
    ['parameter without a value', '/x?token&flag', '/x?token&flag'],
    ['fragment dropped', '/x?lat=10.7766#token=abc', '/x?lat=10.78'],
    ['fragment without query', '/x#code=123456', '/x'],
    ['value containing =', '/x?code=a=b&next=c=d', '/x?code=[redacted]&next=c=d'],
  ])('%s', (_case, input, expected) => {
    expect(sanitizeUrl(input)).toBe(expected);
  });

  it('never throws, whatever the input', () => {
    for (const input of ['', '?', '#', '?&&', '/%', '/x?%', '/x?=1', '/x?lat=%', '/x?%%%=%%%']) {
      expect(() => sanitizeUrl(input)).not.toThrow();
    }
  });
});
