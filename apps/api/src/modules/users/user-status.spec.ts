import { describe, expect, it } from 'vitest';

import { USER_STATUSES } from './entities/user.entity.js';
import type { UserStatus } from './entities/user.entity.js';
import { canTransition, endsSessions, USER_STATUS_TRANSITIONS } from './user-status.js';

/** Every allowed move; any pair not listed is refused (api-divergences D-038). */
const ALLOWED: readonly (readonly [UserStatus, UserStatus])[] = [
  ['INVITED', 'ACTIVE'],
  ['INVITED', 'SUSPENDED'],
  ['ACTIVE', 'SUSPENDED'],
  ['ACTIVE', 'DELETED'],
  ['SUSPENDED', 'ACTIVE'],
  ['SUSPENDED', 'DELETED'],
];

const ALL_PAIRS = USER_STATUSES.flatMap((from) => USER_STATUSES.map((to) => [from, to] as const));

describe('canTransition', () => {
  it.each(ALL_PAIRS)('%s → %s', (from, to) => {
    const expected = ALLOWED.some(([a, b]) => a === from && b === to);
    expect(canTransition(from, to)).toBe(expected);
  });

  it('covers every status and leaves DELETED final', () => {
    expect(ALL_PAIRS).toHaveLength(16);
    expect(Object.keys(USER_STATUS_TRANSITIONS).sort()).toEqual([...USER_STATUSES].sort());
    expect(USER_STATUS_TRANSITIONS.DELETED).toEqual([]);
  });
});

describe('endsSessions', () => {
  it.each(USER_STATUSES.map((status) => [status, status === 'SUSPENDED' || status === 'DELETED']))(
    '%s → %s',
    (status, expected) => {
      expect(endsSessions(status)).toBe(expected);
    },
  );
});
