import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_FORMAT,
  AUDIT_ACTION_MAX_LENGTH,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  isAuditAction,
  isAuditEntityType,
} from './audit-actions.js';

describe('AUDIT_ACTIONS', () => {
  it('has no duplicate code', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it.each(AUDIT_ACTIONS.map((action) => [action]))(
    '%s is a lower-case group.verb within the length limit',
    (action) => {
      expect(action).toMatch(AUDIT_ACTION_FORMAT);
      expect(action.length).toBeLessThanOrEqual(AUDIT_ACTION_MAX_LENGTH);
    },
  );

  it('holds the codes named by data-model and api-outline', () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'order.contact_reveal',
        'user.create',
        'user.role_change',
        'settings.change',
        'menu.overwrite',
        'report.decision',
        'delivery_zone.create',
        'reservation.edit',
      ]),
    );
  });
});

describe('AUDIT_ACTION_FORMAT', () => {
  it.each(['user.role_change', 'delivery_zone.create', 'a.b'])('accepts %s', (value) => {
    expect(value).toMatch(AUDIT_ACTION_FORMAT);
  });

  it.each([
    'User.create',
    'user.Create',
    'user',
    'user.',
    '.create',
    'user.role.change',
    'user.role-change',
    'user.create2',
    '_user.create',
    'user. create',
  ])('refuses %s', (value) => {
    expect(value).not.toMatch(AUDIT_ACTION_FORMAT);
  });
});

describe('AUDIT_ENTITY_TYPES', () => {
  it('lists the eight values of data-model, then the four proposed ones, without duplicates', () => {
    expect(AUDIT_ENTITY_TYPES).toEqual([
      'ORDER',
      'MENU_ITEM',
      'VOUCHER',
      'USER',
      'REVIEW',
      'BRANCH',
      'APP_SETTINGS',
      'EXPORT_JOB',
      'RESERVATION',
      'PROMOTION',
      'REVIEW_REPORT',
      'DELIVERY_ZONE',
    ]);
  });
});

describe('isAuditAction and isAuditEntityType', () => {
  it('accept catalogue values only', () => {
    expect(isAuditAction('settings.change')).toBe(true);
    expect(isAuditAction('settings.delete')).toBe(false);
    expect(isAuditAction(42)).toBe(false);
    expect(isAuditEntityType('APP_SETTINGS')).toBe(true);
    expect(isAuditEntityType('app_settings')).toBe(false);
    expect(isAuditEntityType(undefined)).toBe(false);
  });
});
