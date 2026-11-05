import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { REQUEST_ID_HEADER, genReqId, resolveRequestId } from './request-id.js';

const INCOMING = '0192f0a4-7b3c-7d2e-9f10-3a4b5c6d7e8f';
const GENERATED = '11111111-2222-4333-8444-555555555555';
const generate = (): string => GENERATED;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('accepts an incoming UUID', () => {
    expect(resolveRequestId(INCOMING, generate)).toBe(INCOMING);
  });

  it('lower-cases an upper-case UUID', () => {
    expect(resolveRequestId(INCOMING.toUpperCase(), generate)).toBe(INCOMING);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a UUID', 'abc'],
    ['a UUID with spaces', ` ${INCOMING} `],
    ['a UUID with extra text', `${INCOMING}x`],
    ['a UUID without hyphens', INCOMING.replaceAll('-', '')],
    ['an injection attempt', `${INCOMING}\n{"level":60}`],
    ['a repeated header', [INCOMING, INCOMING]],
  ])('replaces %s with a new id', (_case, incoming) => {
    expect(resolveRequestId(incoming, generate)).toBe(GENERATED);
  });

  it('generates a UUID by default', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
  });
});

describe('genReqId', () => {
  function call(header: string | undefined): { id: string; setHeader: ReturnType<typeof vi.fn> } {
    const setHeader = vi.fn();
    const req = { headers: header === undefined ? {} : { 'x-request-id': header } };
    const res = { setHeader };
    const id = genReqId(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    return { id, setHeader };
  }

  it('keeps an incoming UUID and echoes it in the response header', () => {
    const { id, setHeader } = call(INCOMING);
    expect(id).toBe(INCOMING);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, INCOMING);
  });

  it('replaces anything else and echoes the new id, never the incoming text', () => {
    const { id, setHeader } = call('not-a-uuid');
    expect(id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, id);
    expect(setHeader).not.toHaveBeenCalledWith(REQUEST_ID_HEADER, 'not-a-uuid');
  });

  it('names the header X-Request-Id', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
  });
});
