import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/time/testing.js';
import { isLocked, lockedUntilAfter, lockoutDurationMs, lockoutThreshold } from './lockout.js';

const MINUTE = 60 * 1000;
const NOW = '2026-11-06T03:00:00.000Z';

describe('lockout schedule', () => {
  it('locks customers at 10 failures and staff at 5', () => {
    expect(lockoutThreshold('CUSTOMER')).toBe(10);
    expect(lockoutThreshold('STAFF')).toBe(5);
    expect(lockoutThreshold('MANAGER')).toBe(5);
    expect(lockoutThreshold('ADMIN')).toBe(5);
  });

  it.each([
    // [failures past the threshold, minutes]
    [0, 15],
    [1, 30],
    [2, 60],
    [3, 120],
    [4, 240],
    [5, 240],
    [50, 240],
    [5000, 240],
  ])('threshold + %i failures locks for %i minutes', (beyond, minutes) => {
    const clock = new FixedClock(NOW);
    for (const [role, threshold] of [
      ['CUSTOMER', 10],
      ['STAFF', 5],
    ] as const) {
      const until = lockedUntilAfter(threshold + beyond, role, clock.now());
      expect(until?.getTime(), role).toBe(clock.now().getTime() + minutes * MINUTE);
    }
  });

  it('does not lock below the threshold', () => {
    const clock = new FixedClock(NOW);
    expect(lockedUntilAfter(0, 'CUSTOMER', clock.now())).toBeNull();
    expect(lockedUntilAfter(9, 'CUSTOMER', clock.now())).toBeNull();
    expect(lockedUntilAfter(4, 'ADMIN', clock.now())).toBeNull();
    expect(lockoutDurationMs(9, 'CUSTOMER')).toBeNull();
  });
});

describe('isLocked', () => {
  it('is locked strictly before locked_until', () => {
    const clock = new FixedClock(NOW);
    const until = new Date(clock.now().getTime() + 15 * MINUTE);

    expect(isLocked({ lockedUntil: null }, clock.now())).toBe(false);
    expect(isLocked({ lockedUntil: until }, clock.now())).toBe(true);

    clock.advance(15 * MINUTE - 1);
    expect(isLocked({ lockedUntil: until }, clock.now())).toBe(true);
    clock.advance(1);
    expect(isLocked({ lockedUntil: until }, clock.now())).toBe(false);
    clock.advance(MINUTE);
    expect(isLocked({ lockedUntil: until }, clock.now())).toBe(false);
  });
});
