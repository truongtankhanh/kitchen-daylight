import type { User, UserRole } from './entities/user.entity.js';

/** Consecutive failures before the first lock (decision 0008 section 4): customers 10, staff 5. */
export const LOCKOUT_THRESHOLD = { customer: 10, staff: 5 } as const;

/** The first lock lasts 15 minutes, doubles at each further failure and stops at 4 hours. */
export const LOCKOUT_BASE_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_MS = 4 * 60 * 60 * 1000;

export function lockoutThreshold(role: UserRole): number {
  return role === 'CUSTOMER' ? LOCKOUT_THRESHOLD.customer : LOCKOUT_THRESHOLD.staff;
}

/** Lock length after failure number `failureCount`, or `null` below the threshold. */
export function lockoutDurationMs(failureCount: number, role: UserRole): number | null {
  const beyond = failureCount - lockoutThreshold(role);
  if (beyond < 0) {
    return null;
  }
  // 15 min × 2^beyond reaches the 4-hour cap at beyond = 4; stop doubling before it can overflow.
  let duration = LOCKOUT_BASE_MS;
  for (let step = 0; step < beyond && duration < LOCKOUT_MAX_MS; step += 1) {
    duration *= 2;
  }
  return Math.min(duration, LOCKOUT_MAX_MS);
}

/**
 * `locked_until` after failure number `failureCount` at `now`:
 * `now + min(15 min × 2^(n − T), 4 h)` for `n ≥ T`, otherwise `null` (no lock).
 */
export function lockedUntilAfter(failureCount: number, role: UserRole, now: Date): Date | null {
  const duration = lockoutDurationMs(failureCount, role);
  return duration === null ? null : new Date(now.getTime() + duration);
}

/** Locked while `locked_until` is later than `now`; the lock ends at that instant. */
export function isLocked(user: Pick<User, 'lockedUntil'>, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
}
