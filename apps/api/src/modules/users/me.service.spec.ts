import { describe, expect, it } from 'vitest';

import { User } from './entities/user.entity.js';
import { planProfilePatch, toMeProfile } from './me.service.js';
import { toMySession } from './sessions.service.js';
import type { LiveFamilyRow } from './sessions.service.js';

// Fictional values only; the phone numbers are well-formed but made up.

const BRANCH_ID = '01930000-0000-7000-8000-00000000b001';

describe('planProfilePatch', () => {
  it('changes nothing for an empty body', () => {
    expect(planProfilePatch({})).toEqual({ changes: {}, errors: [] });
  });

  it('writes only the fields the body names', () => {
    expect(planProfilePatch({ displayName: 'Khách Mẫu' })).toEqual({
      changes: { displayName: 'Khách Mẫu' },
      errors: [],
    });
  });

  it('trims displayName and refuses a blank one with REQUIRED', () => {
    expect(planProfilePatch({ displayName: '  Khách Mẫu  ' }).changes).toEqual({
      displayName: 'Khách Mẫu',
    });
    expect(planProfilePatch({ displayName: '   ' })).toEqual({
      changes: {},
      errors: [{ field: 'displayName', code: 'REQUIRED', message: 'is required' }],
    });
  });

  it.each([
    ['0901234567', '+84901234567'],
    ['090 123 4567', '+84901234567'],
    ['+84 90 123 4567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['0351234567', '+84351234567'],
  ])('normalises the phone %j to E.164', (input, stored) => {
    expect(planProfilePatch({ phone: input })).toEqual({ changes: { phone: stored }, errors: [] });
  });

  it.each([
    ['a landline', '0281234567'],
    ['too short', '090123456'],
    ['too long', '09012345678'],
    ['0084 prefix', '0084901234567'],
    ['blank', '  '],
    ['empty', ''],
    ['letters', 'không có'],
  ])('refuses %s with INVALID_PHONE and never echoes it', (_case, input) => {
    const { changes, errors } = planProfilePatch({ phone: input });

    expect(changes).toEqual({});
    expect(errors).toEqual([
      { field: 'phone', code: 'INVALID_PHONE', message: 'must be a Vietnamese mobile number' },
    ]);
    if (input.trim() !== '') {
      expect(JSON.stringify(errors)).not.toContain(input);
    }
  });

  it('clears the phone and the preferred branch with null', () => {
    expect(planProfilePatch({ phone: null, preferredBranchId: null })).toEqual({
      changes: { phone: null, preferredBranchId: null },
      errors: [],
    });
  });

  it('copies a preferred branch id; its existence is the service check', () => {
    expect(planProfilePatch({ preferredBranchId: BRANCH_ID }).changes).toEqual({
      preferredBranchId: BRANCH_ID,
    });
  });

  it('collects every field error and keeps no change from a refused body', () => {
    const { changes, errors } = planProfilePatch({
      displayName: '',
      phone: '123',
      preferredBranchId: BRANCH_ID,
    });

    expect(errors.map((error) => [error.field, error.code])).toEqual([
      ['displayName', 'REQUIRED'],
      ['phone', 'INVALID_PHONE'],
    ]);
    // The service throws before writing when there is any error.
    expect(changes).toEqual({ preferredBranchId: BRANCH_ID });
  });
});

describe('toMeProfile', () => {
  it('projects the public fields only, with ISO dates', () => {
    const user = Object.assign(new User(), {
      id: '01930000-0000-7000-8000-00000000c001',
      email: 'khach@kitchendaylight.example',
      passwordHash: '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA',
      displayName: 'Khách Mẫu',
      phone: '+84901234567',
      avatarUrl: null,
      preferredBranchId: BRANCH_ID,
      emailVerifiedAt: new Date('2026-11-01T02:03:04.000Z'),
      failedLoginCount: 3,
    });

    expect(toMeProfile(user)).toEqual({
      id: '01930000-0000-7000-8000-00000000c001',
      email: 'khach@kitchendaylight.example',
      emailVerifiedAt: '2026-11-01T02:03:04.000Z',
      displayName: 'Khách Mẫu',
      phone: '+84901234567',
      avatarUrl: null,
      preferredBranchId: BRANCH_ID,
    });
  });

  it('answers null for an unverified email', () => {
    const user = Object.assign(new User(), { emailVerifiedAt: null });

    expect(toMeProfile(user).emailVerifiedAt).toBeNull();
  });
});

describe('toMySession', () => {
  const row: LiveFamilyRow = {
    family_id: '01930000-0000-7000-8000-00000000f001',
    device_label: 'iPhone mẫu',
    created_at: new Date('2026-11-01T00:00:00.000Z'),
    last_used_at: new Date('2026-11-06T08:30:00.000Z'),
  };

  it('uses the family id as the session id, with ISO dates', () => {
    expect(toMySession(row, '01930000-0000-7000-8000-00000000f999')).toEqual({
      id: '01930000-0000-7000-8000-00000000f001',
      deviceLabel: 'iPhone mẫu',
      createdAt: '2026-11-01T00:00:00.000Z',
      lastUsedAt: '2026-11-06T08:30:00.000Z',
      isCurrent: false,
    });
  });

  it('marks the family of the access token as current', () => {
    expect(toMySession(row, row.family_id).isCurrent).toBe(true);
  });
});
