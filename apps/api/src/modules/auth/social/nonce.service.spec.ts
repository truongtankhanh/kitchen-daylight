import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../../common/time/testing.js';
import {
  deriveNonceKey,
  NonceService,
  SOCIAL_NONCE_MAX_CONSUMED,
  SOCIAL_NONCE_TTL_MS,
} from './nonce.service.js';

// A2-T6: the server-issued social nonce. Throw-away secret per run; no value is a real one.

const NOW = '2026-11-07T03:00:00.000Z';
const SECOND = 1000;

function service(clock = new FixedClock(NOW), secret = randomBytes(32)): NonceService {
  return new NonceService(secret, clock);
}

describe('NonceService.issue', () => {
  it('lives five minutes and is unique per call', () => {
    const nonces = service();

    const first = nonces.issue();
    const second = nonces.issue();

    expect(SOCIAL_NONCE_TTL_MS).toBe(5 * 60 * SECOND);
    expect(first.expiresAt.toISOString()).toBe('2026-11-07T03:05:00.000Z');
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.nonce).toMatch(/^\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  });
});

describe('NonceService.consume', () => {
  it('accepts a fresh nonce once, then refuses it as reused', () => {
    const nonces = service();
    const { nonce } = nonces.issue();

    expect(nonces.consume(nonce)).toEqual({ ok: true });
    expect(nonces.consume(nonce)).toEqual({ ok: false, reason: 'reused' });
  });

  it('accepts a nonce until just before its expiry, and refuses it at the expiry', () => {
    const clock = new FixedClock(NOW);
    const nonces = service(clock);
    const early = nonces.issue().nonce;
    const late = nonces.issue().nonce;

    clock.advance(SOCIAL_NONCE_TTL_MS - 1);
    expect(nonces.consume(early)).toEqual({ ok: true });

    clock.advance(1);
    expect(nonces.consume(late)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a nonce issued with another secret', () => {
    const clock = new FixedClock(NOW);
    const foreign = service(clock).issue().nonce;

    expect(service(clock).consume(foreign)).toEqual({ ok: false, reason: 'bad_mac' });
  });

  it('refuses a nonce whose expiry was changed', () => {
    const nonces = service();
    const { nonce } = nonces.issue();
    const [expiresAt, random, mac] = nonce.split('.') as [string, string, string];

    const extended = `${Number(expiresAt) + 60 * SECOND}.${random}.${mac}`;

    expect(nonces.consume(extended)).toEqual({ ok: false, reason: 'bad_mac' });
  });

  it('refuses a non-canonical spelling of a valid MAC, so a nonce is used once only', () => {
    const nonces = service();
    const { nonce } = nonces.issue();
    const [expiresAt, random, mac] = nonce.split('.') as [string, string, string];
    // The last of 43 base64url characters carries 2 unused bits: flipping them keeps the bytes.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(mac.at(-1) as string);
    const twin = `${mac.slice(0, -1)}${alphabet[last ^ 1] as string}`;
    expect(Buffer.from(twin, 'base64url').equals(Buffer.from(mac, 'base64url'))).toBe(true);

    expect(nonces.consume(nonce)).toEqual({ ok: true });
    expect(nonces.consume(`${expiresAt}.${random}.${twin}`)).toEqual({
      ok: false,
      reason: 'bad_mac',
    });
  });

  it('fails closed when the store of consumed nonces is full, and recovers as they expire', () => {
    const clock = new FixedClock(NOW);
    const nonces = service(clock);
    let accepted = 0;
    for (let i = 0; i < SOCIAL_NONCE_MAX_CONSUMED; i += 1) {
      accepted += nonces.consume(nonces.issue().nonce).ok ? 1 : 0;
    }
    expect(accepted).toBe(SOCIAL_NONCE_MAX_CONSUMED);

    expect(nonces.consume(nonces.issue().nonce)).toEqual({ ok: false, reason: 'store_full' });

    const late = nonces.issue().nonce;
    clock.advance(SOCIAL_NONCE_TTL_MS);
    expect(nonces.consume(nonces.issue().nonce)).toEqual({ ok: true });
    expect(nonces.consume(late)).toEqual({ ok: false, reason: 'expired' });
    expect(nonces.consumedCount).toBe(1);
  });

  it('sweeps an expired entry kept behind a live one before refusing a full store', () => {
    const clock = new FixedClock(NOW);
    const nonces = service(clock);
    const early = nonces.issue().nonce;
    clock.advance(SECOND);
    const later = nonces.issue().nonce;
    expect(nonces.consume(later)).toEqual({ ok: true });
    expect(nonces.consume(early)).toEqual({ ok: true });
    let accepted = 0;
    for (let i = 0; i < SOCIAL_NONCE_MAX_CONSUMED - 2; i += 1) {
      accepted += nonces.consume(nonces.issue().nonce).ok ? 1 : 0;
    }
    expect(accepted).toBe(SOCIAL_NONCE_MAX_CONSUMED - 2);

    clock.advance(SOCIAL_NONCE_TTL_MS - SECOND);

    expect(nonces.consume(nonces.issue().nonce)).toEqual({ ok: true });
    expect(nonces.consumedCount).toBe(SOCIAL_NONCE_MAX_CONSUMED);
  });

  it.each(['', 'abc', 'a.b.c', `1.${'A'.repeat(22)}.${'A'.repeat(42)}`, ' x'])(
    'refuses the malformed value %j',
    (value) => {
      expect(service().consume(value)).toEqual({ ok: false, reason: 'malformed' });
    },
  );

  it('forgets consumed nonces once they expire', () => {
    const clock = new FixedClock(NOW);
    const nonces = service(clock);
    expect(nonces.consume(nonces.issue().nonce)).toEqual({ ok: true });
    expect(nonces.consumedCount).toBe(1);

    clock.advance(SOCIAL_NONCE_TTL_MS);
    expect(nonces.consume(nonces.issue().nonce)).toEqual({ ok: true });

    expect(nonces.consumedCount).toBe(1);
  });
});

describe('deriveNonceKey', () => {
  it('is never the secret itself', () => {
    const secret = randomBytes(32);

    expect(deriveNonceKey(secret).equals(secret)).toBe(false);
    expect(deriveNonceKey(secret)).toHaveLength(32);
  });
});
