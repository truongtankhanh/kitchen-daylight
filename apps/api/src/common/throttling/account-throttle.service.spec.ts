import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { EmailToken } from '../../modules/auth/entities/email-token.entity.js';
import { User } from '../../modules/users/entities/user.entity.js';
import { FixedClock } from '../time/testing.js';
import { AccountThrottleService, RESEND_INTERVAL_MS } from './account-throttle.service.js';

const NOW = '2026-11-06T03:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const USER_ID = '01930000-0000-7000-8000-00000000a4a1';

function managerReturning(row: unknown): EntityManager {
  return { findOne: vi.fn(async () => row) } as unknown as EntityManager;
}

function serviceWith(manager: EntityManager): AccountThrottleService {
  return new AccountThrottleService({ manager } as unknown as DataSource, new FixedClock(NOW));
}

describe('AccountThrottleService.isSignInLocked', () => {
  it.each([
    ['no lock', null, false],
    ['lock in the future', new Date(NOW_MS + 1000), true],
    ['lock ending now', new Date(NOW_MS), false],
    ['lock in the past', new Date(NOW_MS - 1000), false],
  ])('%s', async (_case, lockedUntil, locked) => {
    const manager = managerReturning({ id: USER_ID, lockedUntil });

    await expect(serviceWith(manager).isSignInLocked(USER_ID)).resolves.toBe(locked);
    expect(manager.findOne).toHaveBeenCalledWith(User, {
      select: { id: true, lockedUntil: true },
      where: { id: USER_ID },
    });
  });

  it('an unknown user is not locked (the caller runs its dummy-hash path)', async () => {
    await expect(serviceWith(managerReturning(null)).isSignInLocked(USER_ID)).resolves.toBe(false);
  });

  it("reads through the caller's EntityManager when given", async () => {
    const own = managerReturning(null);
    const caller = managerReturning({ id: USER_ID, lockedUntil: new Date(NOW_MS + 1000) });

    await expect(serviceWith(own).isSignInLocked(USER_ID, caller)).resolves.toBe(true);
    expect(own.findOne).not.toHaveBeenCalled();
  });
});

describe('AccountThrottleService.resendDecision (60 s rule)', () => {
  it('allows the first message', async () => {
    const manager = managerReturning(null);

    await expect(serviceWith(manager).resendDecision(USER_ID, 'VERIFY_EMAIL')).resolves.toEqual({
      allowed: true,
    });
    expect(manager.findOne).toHaveBeenCalledWith(EmailToken, {
      select: { id: true, createdAt: true },
      where: { userId: USER_ID, type: 'VERIFY_EMAIL' },
      order: { createdAt: 'DESC' },
    });
  });

  it.each([
    [1, 60],
    [30_000, 30],
    [59_001, 1],
    [59_999, 1],
  ])('refuses %i ms after the newest token, retry after %i s', async (elapsedMs, seconds) => {
    const manager = managerReturning({ createdAt: new Date(NOW_MS - elapsedMs) });

    await expect(serviceWith(manager).resendDecision(USER_ID, 'INVITE')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: seconds,
    });
  });

  it.each([RESEND_INTERVAL_MS, RESEND_INTERVAL_MS + 1, 24 * 60 * 60 * 1000])(
    'allows %i ms after the newest token',
    async (elapsedMs) => {
      const manager = managerReturning({ createdAt: new Date(NOW_MS - elapsedMs) });

      await expect(serviceWith(manager).resendDecision(USER_ID, 'RESET_PASSWORD')).resolves.toEqual(
        { allowed: true },
      );
    },
  );
});
