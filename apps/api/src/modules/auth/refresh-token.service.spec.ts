import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DEVICE_LABEL_FALLBACK,
  generateRefreshToken,
  hashRefreshToken,
  LIVE_FAMILY_LIMITS,
  liveFamilyLimitOf,
  normalizeDeviceLabel,
  SESSION_PROFILES,
  sessionProfileOf,
} from './refresh-token.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('refresh token values', () => {
  it('generates 256 random bits as base64url', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
  });

  it('stores only the SHA-256 of the token, 32 bytes', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toHaveLength(32);
    expect(hash.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(hash.toString('base64url')).not.toBe(token);
  });
});

describe('session profiles', () => {
  it('gives customers 30 days idle and 90 absolute, staff 24 hours and 7 days', () => {
    expect(SESSION_PROFILES.customer).toEqual({ idleMs: 30 * DAY_MS, absoluteMs: 90 * DAY_MS });
    expect(SESSION_PROFILES.staff).toEqual({ idleMs: DAY_MS, absoluteMs: 7 * DAY_MS });
    expect(sessionProfileOf('CUSTOMER')).toBe(SESSION_PROFILES.customer);
    expect(sessionProfileOf('STAFF')).toBe(SESSION_PROFILES.staff);
    expect(sessionProfileOf('MANAGER')).toBe(SESSION_PROFILES.staff);
    expect(sessionProfileOf('ADMIN')).toBe(SESSION_PROFILES.staff);
  });
});

describe('live-family limits', () => {
  it('allows 10 live families per customer and 5 per staff member (decision 0008 section 1)', () => {
    expect(LIVE_FAMILY_LIMITS).toEqual({ customer: 10, staff: 5 });
    expect(liveFamilyLimitOf('CUSTOMER')).toBe(10);
    expect(liveFamilyLimitOf('STAFF')).toBe(5);
    expect(liveFamilyLimitOf('MANAGER')).toBe(5);
    expect(liveFamilyLimitOf('ADMIN')).toBe(5);
  });
});

describe('normalizeDeviceLabel', () => {
  it.each([
    [undefined, DEVICE_LABEL_FALLBACK],
    [null, DEVICE_LABEL_FALLBACK],
    ['', DEVICE_LABEL_FALLBACK],
    ['   \t ', DEVICE_LABEL_FALLBACK],
    ['  Fixture   Phone  ', 'Fixture Phone'],
    ['Fixture\u0000\u0007Phone\nModel', 'Fixture Phone Model'],
    ['Chrome trên macOS', 'Chrome trên macOS'],
  ])('%j becomes %j', (input, expected) => {
    expect(normalizeDeviceLabel(input)).toBe(expected);
  });

  it('applies NFC', () => {
    const decomposed = `Me${String.fromCodePoint(0x0301)}t`;
    expect(normalizeDeviceLabel(decomposed)).toBe(`M${String.fromCodePoint(0x00e9)}t`);
  });

  it('cuts at 60 code points instead of refusing', () => {
    const emoji = String.fromCodePoint(0x1f4f1);
    expect(normalizeDeviceLabel('x'.repeat(61))).toBe('x'.repeat(60));
    expect(Array.from(normalizeDeviceLabel(emoji.repeat(70)))).toHaveLength(60);
    expect(normalizeDeviceLabel(`${'x'.repeat(59)} tail`)).toBe('x'.repeat(59));
  });
});
