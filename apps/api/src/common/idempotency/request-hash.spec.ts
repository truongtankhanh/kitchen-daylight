import { describe, expect, it } from 'vitest';

import { canonicalJson, hashRequest } from './request-hash.js';

const hash = (body: unknown): string => hashRequest('POST', '/orders', body);

describe('canonicalJson', () => {
  it('sorts object keys at every level and keeps array order, without whitespace', () => {
    expect(canonicalJson({ b: [3, 1, { y: 2, x: 1 }], a: { d: true, c: null } })).toBe(
      '{"a":{"c":null,"d":true},"b":[3,1,{"x":1,"y":2}]}',
    );
  });

  it('follows JSON for dates, undefined members and a missing body', () => {
    expect(canonicalJson({ at: new Date('2026-11-05T03:00:00.000Z'), gone: undefined })).toBe(
      '{"at":"2026-11-05T03:00:00.000Z"}',
    );
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('hashRequest', () => {
  const body = {
    branchId: 'b1',
    items: [
      { menuItemId: 'm1', quantity: 2, optionIds: ['o2', 'o1'] },
      { menuItemId: 'm2', quantity: 1, optionIds: [] },
    ],
    paymentMethod: 'CASH',
    expectedTotal: 125000,
  };

  it('is a lower-case SHA-256 hex digest', () => {
    expect(hash(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores the key order of objects at every level', () => {
    const reordered = {
      expectedTotal: 125000,
      paymentMethod: 'CASH',
      items: [
        { optionIds: ['o2', 'o1'], quantity: 2, menuItemId: 'm1' },
        { quantity: 1, optionIds: [], menuItemId: 'm2' },
      ],
      branchId: 'b1',
    };

    expect(hash(reordered)).toBe(hash(body));
  });

  it('ignores the whitespace of the JSON the client sent', () => {
    const compact = '{"a":1,"b":[1,2],"c":{"d":"x y"}}';
    const spaced = '{\n  "c" : { "d" : "x y" },\n  "b" : [ 1, 2 ],\n  "a" : 1\n}';

    expect(hash(JSON.parse(spaced))).toBe(hash(JSON.parse(compact)));
  });

  it('keeps array order significant', () => {
    expect(hash({ optionIds: ['o1', 'o2'] })).not.toBe(hash({ optionIds: ['o2', 'o1'] }));
  });

  it('compares numbers by value, and never as strings', () => {
    expect(hash({ quantity: 1 })).toBe(hash({ quantity: 1.0 }));
    expect(hash({ total: 10 })).toBe(hash({ total: 1e1 }));
    expect(hash(JSON.parse('{"total":125000.0}'))).toBe(hash({ total: 125000 }));
    expect(hash({ quantity: 1 })).not.toBe(hash({ quantity: '1' }));
    expect(hash({ quantity: 1 })).not.toBe(hash({ quantity: 2 }));
  });

  it('treats a missing body as null and leaves out undefined members', () => {
    expect(hash(undefined)).toBe(hash(null));
    expect(hash({ a: 1, note: undefined })).toBe(hash({ a: 1 }));
    expect(hash({ a: 1, note: null })).not.toBe(hash({ a: 1 }));
  });

  it('includes the method, case-insensitively, and the route template', () => {
    expect(hashRequest('post', '/orders', body)).toBe(hashRequest('POST', '/orders', body));
    expect(hashRequest('PUT', '/orders', body)).not.toBe(hashRequest('POST', '/orders', body));
    expect(hashRequest('POST', '/reservations', body)).not.toBe(
      hashRequest('POST', '/orders', body),
    );
  });

  it('includes the path parameters, whatever their key order', () => {
    const route = '/admin/users/{id}/points';
    const dto = { delta: 100, note: 'Goodwill gesture' };

    expect(hashRequest('POST', route, dto, { id: 'u1' })).not.toBe(
      hashRequest('POST', route, dto, { id: 'u2' }),
    );
    expect(hashRequest('POST', '/a/{x}/b/{y}', dto, { x: '1', y: '2' })).toBe(
      hashRequest('POST', '/a/{x}/b/{y}', dto, { y: '2', x: '1' }),
    );
    expect(hashRequest('POST', '/orders', dto)).toBe(hashRequest('POST', '/orders', dto, {}));
  });
});
