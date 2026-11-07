import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../common/errors/api-error.js';
import type { User, UserRole, UserStatus } from '../../users/entities/user.entity.js';
import { assertCanSignIn, socialDisplayName } from './social.service.js';

// A2-T6: the pure rules of the social service. The link rules against PostgreSQL are in
// `test/integration/social.int-spec.ts`. Fictional data only.

function user(role: UserRole, status: UserStatus): User {
  return { id: '01930000-0000-7000-8000-0000000000a1', role, status } as User;
}

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
  } catch (error) {
    return error instanceof ApiError ? error.code : 'not an ApiError';
  }
  return undefined;
}

describe('assertCanSignIn', () => {
  it('lets an active customer in', () => {
    const active = user('CUSTOMER', 'ACTIVE');

    expect(assertCanSignIn(active)).toBe(active);
  });

  it('answers ACCOUNT_SUSPENDED for a suspended customer', () => {
    expect(codeOf(() => assertCanSignIn(user('CUSTOMER', 'SUSPENDED')))).toBe('ACCOUNT_SUSPENDED');
  });

  it.each(['STAFF', 'MANAGER', 'ADMIN'] as const)('refuses %s', (role) => {
    expect(codeOf(() => assertCanSignIn(user(role, 'ACTIVE')))).toBe('INVALID_CREDENTIALS');
    expect(codeOf(() => assertCanSignIn(user(role, 'SUSPENDED')))).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a deleted customer and a missing user', () => {
    expect(codeOf(() => assertCanSignIn(user('CUSTOMER', 'DELETED')))).toBe('INVALID_CREDENTIALS');
    expect(codeOf(() => assertCanSignIn(null))).toBe('INVALID_CREDENTIALS');
  });
});

describe('socialDisplayName', () => {
  const identity = { name: 'Tên từ Google', email: 'fixture-name@kd.example' };

  it('prefers the body, then the token name, then the local part of the email', () => {
    expect(socialDisplayName('  Tên từ ứng dụng ', identity)).toBe('Tên từ ứng dụng');
    expect(socialDisplayName('   ', identity)).toBe('Tên từ Google');
    expect(socialDisplayName(null, { name: null, email: 'fixture-name@kd.example' })).toBe(
      'fixture-name',
    );
  });

  it('cuts to 60 code points', () => {
    expect(Array.from(socialDisplayName('ệ'.repeat(70), identity))).toHaveLength(60);
  });
});
