import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { Clock } from '../../../common/time/clock.js';

/** Lifetime of a social sign-in nonce (A2-T6 prompt; api-divergences D-069). */
export const SOCIAL_NONCE_TTL_MS = 5 * 60_000;

/**
 * Most consumed nonces held at once. Only nonces with a valid MAC that have not expired are held,
 * and `POST /auth/social/nonce` is throttled per IP, so the cap is reached only under abuse; then
 * the service refuses (fails closed) instead of forgetting a consumed nonce, which would allow a
 * replay.
 */
export const SOCIAL_NONCE_MAX_CONSUMED = 50_000;

/** Random part: 16 bytes (128 bits) in base64url. */
const NONCE_RANDOM_BYTES = 16;

/** Domain separation: the nonce key is derived from `OTP_HMAC_SECRET`, never the secret itself. */
const NONCE_KEY_LABEL = 'kd.social-nonce.v1';

/** The bytes of `OTP_HMAC_SECRET`; the nonce key is derived from them. */
export const SOCIAL_NONCE_SECRET = Symbol('SOCIAL_NONCE_SECRET');

const NONCE_PATTERN = /^([0-9]{1,15})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export interface IssuedNonce {
  readonly nonce: string;
  readonly expiresAt: Date;
}

/** Why a nonce was refused; for the log line only, never sent to the client. */
export type NonceRejection = 'malformed' | 'bad_mac' | 'expired' | 'reused' | 'store_full';

export type NonceConsumption =
  { readonly ok: true } | { readonly ok: false; readonly reason: NonceRejection };

/** HMAC-SHA256 key for the nonces: `HMAC(secret, label)`. */
export function deriveNonceKey(secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(NONCE_KEY_LABEL).digest();
}

/**
 * Server-issued nonces for social sign-in (ADR-0003 "a `nonce` we issued"; A2-T6).
 *
 * A nonce is `<expiresAtMs>.<16 random bytes, base64url>.<HMAC-SHA256 of the first two parts,
 * base64url>`. The MAC proves the server issued it and fixes its expiry, so no table is needed.
 * Single use comes from an in-process map of consumed nonces (MAC → expiry), pruned as entries
 * expire.
 *
 * **Revisit trigger:** the map lives in this process. The API runs one instance per tier
 * (ADR-0004, ADR-0003 "Abuse protection"); a second instance would accept a nonce consumed on the
 * other one, so before scaling out the consumed set moves to a shared store (Redis or PostgreSQL),
 * together with the throttle counters and the refresh grace map (decision 0008, Consequences).
 * A restart forgets the map; a nonce issued before it can then be used once more until it expires
 * (at most 5 minutes), and only with an ID token that carries it.
 *
 * No nonce is logged.
 */
@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name);
  private readonly key: Buffer;
  /**
   * Canonical MAC (base64url) → expiry in ms. Entries are inserted when a nonce is consumed, so the
   * order is roughly, not strictly, the expiry order: `prune` drops expired entries from the front
   * and sweeps the whole map before the cap refuses a nonce.
   */
  private readonly consumed = new Map<string, number>();

  constructor(
    @Inject(SOCIAL_NONCE_SECRET) secret: Buffer,
    @Inject(Clock) private readonly clock: Clock,
  ) {
    this.key = deriveNonceKey(secret);
  }

  issue(): IssuedNonce {
    const expiresAtMs = this.clock.now().getTime() + SOCIAL_NONCE_TTL_MS;
    const payload = `${expiresAtMs}.${randomBytes(NONCE_RANDOM_BYTES).toString('base64url')}`;
    return { nonce: `${payload}.${this.mac(payload)}`, expiresAt: new Date(expiresAtMs) };
  }

  /**
   * Marks `nonce` as used if it is well formed, carries our MAC, has not expired and was not used
   * before. Check and mark run in one synchronous step, so two parallel requests cannot both pass.
   */
  consume(nonce: string): NonceConsumption {
    const match = NONCE_PATTERN.exec(nonce);
    if (match === null) {
      return { ok: false, reason: 'malformed' };
    }
    const [, expiresAtText, random, mac] = match as unknown as [string, string, string, string];
    const expected = Buffer.from(this.mac(`${expiresAtText}.${random}`), 'base64url');
    const given = Buffer.from(mac, 'base64url');
    // A 43-character base64url MAC carries 2 unused trailing bits: a non-canonical spelling decodes
    // to the same bytes, so it is refused, and the consumed map is keyed by the canonical form only.
    if (
      given.length !== expected.length ||
      given.toString('base64url') !== mac ||
      !timingSafeEqual(given, expected)
    ) {
      return { ok: false, reason: 'bad_mac' };
    }
    const now = this.clock.now().getTime();
    const expiresAtMs = Number(expiresAtText);
    if (expiresAtMs <= now) {
      return { ok: false, reason: 'expired' };
    }
    this.prune(now);
    if (this.consumed.has(mac)) {
      return { ok: false, reason: 'reused' };
    }
    if (this.consumed.size >= SOCIAL_NONCE_MAX_CONSUMED) {
      // O(n) over at most 50 000 entries, and only while the map is full: an abuse case already
      // bounded by the per-IP throttle of `POST /auth/social/nonce`.
      this.sweep(now);
    }
    if (this.consumed.size >= SOCIAL_NONCE_MAX_CONSUMED) {
      this.logger.warn(
        { event: 'auth.social_nonce_store_full', size: this.consumed.size },
        'social nonce store full',
      );
      return { ok: false, reason: 'store_full' };
    }
    this.consumed.set(mac, expiresAtMs);
    return { ok: true };
  }

  /** Number of consumed nonces held; for specs. */
  get consumedCount(): number {
    return this.consumed.size;
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  /** Drops expired entries from the front, up to the first live one: cheap, run on every consume. */
  private prune(now: number): void {
    for (const [mac, expiresAtMs] of this.consumed) {
      if (expiresAtMs > now) {
        return;
      }
      this.consumed.delete(mac);
    }
  }

  /** Drops every expired entry; run only when the map is full. */
  private sweep(now: number): void {
    for (const [mac, expiresAtMs] of this.consumed) {
      if (expiresAtMs <= now) {
        this.consumed.delete(mac);
      }
    }
  }
}
