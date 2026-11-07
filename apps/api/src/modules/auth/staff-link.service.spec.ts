import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/time/testing.js';
import type { UserRole, UserStatus } from '../users/entities/user.entity.js';
import {
  dailyCapRetryAfterSeconds,
  generateLinkToken,
  hashLinkToken,
  isLinkTokenFormat,
  isStaffLinkLive,
  STAFF_INVITE_TTL_HOURS,
  STAFF_LINK_PATHS,
  STAFF_LINK_TOKEN_BYTES,
  STAFF_LINK_TTL_MS,
  STAFF_RESET_TTL_MINUTES,
  staffLinkExpiresAt,
  staffLinkTypeFor,
  staffLinkUrl,
} from './staff-link.service.js';

// A3-T3: token generation, hashing and lifetime decisions of staff links (decision 0008 section 6),
// with a fixed clock. The database, mail and HTTP paths are in `admin-links.int-spec.ts`.

const NOW = '2026-11-07T03:00:00.000Z';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ORIGIN = 'https://admin.kitchendaylight.example';

describe('generateLinkToken', () => {
  it('draws 32 bytes and encodes them as unpadded base64url (43 characters)', () => {
    const sizes: number[] = [];
    const token = generateLinkToken((size) => {
      sizes.push(size);
      return Buffer.alloc(size, 0xfb);
    });

    expect(sizes).toEqual([STAFF_LINK_TOKEN_BYTES]);
    expect(STAFF_LINK_TOKEN_BYTES).toBe(32);
    expect(token).toBe(Buffer.alloc(32, 0xfb).toString('base64url'));
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('uses the CSPRNG by default: two tokens differ and both have the link shape', () => {
    const first = generateLinkToken();
    const second = generateLinkToken();

    expect(first).not.toBe(second);
    expect(isLinkTokenFormat(first)).toBe(true);
    expect(isLinkTokenFormat(second)).toBe(true);
  });
});

describe('isLinkTokenFormat', () => {
  it.each([
    ['', false],
    ['a'.repeat(42), false],
    ['a'.repeat(44), false],
    [`${'a'.repeat(42)}=`, false],
    [`${'a'.repeat(42)}+`, false],
    [`${'a'.repeat(42)}/`, false],
    [`${'a'.repeat(21)} ${'a'.repeat(21)}`, false],
    [`${'A'.repeat(20)}-_${'9'.repeat(21)}`, true],
  ])('%j is %s', (token, expected) => {
    expect(isLinkTokenFormat(token)).toBe(expected);
  });
});

describe('hashLinkToken', () => {
  it('is the plain SHA-256 of the token text, 32 bytes, deterministic', () => {
    const token = generateLinkToken();
    const hash = hashLinkToken(token);

    expect(hash).toHaveLength(32);
    expect(hash.equals(createHash('sha256').update(token, 'utf8').digest())).toBe(true);
    expect(hashLinkToken(token).equals(hash)).toBe(true);
  });

  it('never contains the token and differs for different tokens', () => {
    const token = generateLinkToken();
    const hash = hashLinkToken(token);

    expect(hash.toString('base64url')).not.toBe(token);
    expect(hash.toString('utf8')).not.toContain(token);
    expect(hashLinkToken(generateLinkToken()).equals(hash)).toBe(false);
  });
});

describe('lifetimes', () => {
  it('are 48 hours for an invitation and 30 minutes for a reset', () => {
    expect(STAFF_INVITE_TTL_HOURS).toBe(48);
    expect(STAFF_RESET_TTL_MINUTES).toBe(30);
    expect(STAFF_LINK_TTL_MS.INVITE).toBe(48 * HOUR);
    expect(STAFF_LINK_TTL_MS.RESET_PASSWORD).toBe(30 * MINUTE);
  });

  it('expire at the issue time plus the lifetime of the type', () => {
    const clock = new FixedClock(NOW);

    expect(staffLinkExpiresAt('INVITE', clock.now()).toISOString()).toBe(
      '2026-11-09T03:00:00.000Z',
    );
    expect(staffLinkExpiresAt('RESET_PASSWORD', clock.now()).toISOString()).toBe(
      '2026-11-07T03:30:00.000Z',
    );
  });

  it.each([
    ['INVITE', 48 * HOUR],
    ['RESET_PASSWORD', 30 * MINUTE],
  ] as const)('a %s link is live until its expiry, exclusive', (type, ttl) => {
    const clock = new FixedClock(NOW);
    const row = { usedAt: null, expiresAt: staffLinkExpiresAt(type, clock.now()) };

    expect(isStaffLinkLive(row, clock.now())).toBe(true);
    clock.advance(ttl - 1);
    expect(isStaffLinkLive(row, clock.now())).toBe(true);
    clock.advance(1);
    expect(isStaffLinkLive(row, clock.now())).toBe(false);
  });

  it('a used or superseded link is dead before its expiry', () => {
    const clock = new FixedClock(NOW);
    const row = {
      usedAt: clock.now(),
      expiresAt: staffLinkExpiresAt('INVITE', clock.now()),
    };

    expect(isStaffLinkLive(row, clock.now())).toBe(false);
  });
});

describe('staffLinkUrl', () => {
  it('puts the token in the fragment of the admin route of each type', () => {
    expect(STAFF_LINK_PATHS).toEqual({
      INVITE: '/auth/set-password',
      RESET_PASSWORD: '/auth/reset-password',
    });

    const token = generateLinkToken();
    const invite = new URL(staffLinkUrl(ORIGIN, 'INVITE', token));
    const reset = new URL(staffLinkUrl(ORIGIN, 'RESET_PASSWORD', token));

    expect(invite.origin).toBe(ORIGIN);
    expect(invite.pathname).toBe('/auth/set-password');
    expect(invite.search).toBe('');
    expect(invite.hash).toBe(`#token=${token}`);
    expect(reset.pathname).toBe('/auth/reset-password');
    expect(reset.hash).toBe(`#token=${token}`);
  });
});

describe('staffLinkTypeFor', () => {
  it.each([
    ['STAFF', 'INVITED', 'INVITE'],
    ['MANAGER', 'INVITED', 'INVITE'],
    ['ADMIN', 'INVITED', 'INVITE'],
    ['STAFF', 'ACTIVE', 'RESET_PASSWORD'],
    ['MANAGER', 'ACTIVE', 'RESET_PASSWORD'],
    ['ADMIN', 'ACTIVE', 'RESET_PASSWORD'],
    ['STAFF', 'SUSPENDED', null],
    ['ADMIN', 'DELETED', null],
    ['CUSTOMER', 'ACTIVE', null],
    ['CUSTOMER', 'INVITED', null],
  ] as const)('%s %s gets %s', (role: UserRole, status: UserStatus, expected) => {
    expect(staffLinkTypeFor({ role, status })).toBe(expected);
  });
});

describe('dailyCapRetryAfterSeconds', () => {
  it('is the time until the oldest message leaves the 24-hour window, at least one second', () => {
    const clock = new FixedClock(NOW);
    const oldest = new Date(clock.now().getTime() - 23 * HOUR);

    expect(dailyCapRetryAfterSeconds(oldest, clock.now())).toBe(3600);
    expect(dailyCapRetryAfterSeconds(new Date(oldest.getTime() - 500), clock.now())).toBe(3600);
    expect(
      dailyCapRetryAfterSeconds(new Date(clock.now().getTime() - 24 * HOUR), clock.now()),
    ).toBe(1);
  });
});
