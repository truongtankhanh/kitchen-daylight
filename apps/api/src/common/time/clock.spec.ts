import { describe, expect, it } from 'vitest';

import { Clock, SystemClock, clockProvider } from './clock.js';
import { FixedClock } from './testing.js';

describe('SystemClock', () => {
  it('reads the system time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('is the provider bound to the Clock token', () => {
    expect(clockProvider).toEqual({ provide: Clock, useClass: SystemClock });
  });
});

describe('FixedClock', () => {
  it('stands still until it is moved', () => {
    const clock = new FixedClock('2026-10-27T03:00:00Z');
    expect(clock).toBeInstanceOf(Clock);
    expect(clock.now().toISOString()).toBe('2026-10-27T03:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });

  it('sets and advances', () => {
    const clock = new FixedClock(new Date('2026-10-27T03:00:00Z'));
    clock.advance(90 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-10-27T04:30:00.000Z');
    clock.set('2027-01-01T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
    clock.advance(-1);
    expect(clock.now().toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('returns a copy that cannot move the clock', () => {
    const clock = new FixedClock('2026-10-27T03:00:00Z');
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });

  it('rejects an invalid instant', () => {
    expect(() => new FixedClock('not a date')).toThrow(RangeError);
  });
});
