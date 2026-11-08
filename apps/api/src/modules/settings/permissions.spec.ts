import { describe, expect, it } from 'vitest';

import { STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import { PERMISSION_KEYS, permissionsFor, ROLE_PERMISSIONS } from './permissions.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';

const FLAGS = SETTING_DEFAULTS.featureFlags;
const EINVOICE_ON = { ...FLAGS, einvoice: true };

describe('permissions', () => {
  it.each(STAFF_ROLES)('gives %s only known keys, each once', (role) => {
    const known: ReadonlySet<string> = new Set(PERMISSION_KEYS);
    const keys = ROLE_PERMISSIONS[role];

    expect(keys.filter((key) => !known.has(key))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives STAFF the orders and read-only reviews', () => {
    expect(permissionsFor('STAFF', EINVOICE_ON)).toEqual([
      'orders.read',
      'orders.write',
      'reviews.read',
    ]);
  });

  it('gives MANAGER menu, branches, moderation, reports, exports and promotions on top', () => {
    expect(permissionsFor('MANAGER', EINVOICE_ON)).toEqual([
      'orders.read',
      'orders.write',
      'menu.write',
      'branches.write',
      'reviews.read',
      'reviews.moderate',
      'reports.read',
      'exports.read',
      'promotions.write',
    ]);
  });

  it('gives ADMIN every key while einvoice is on', () => {
    expect(permissionsFor('ADMIN', EINVOICE_ON)).toEqual([...PERMISSION_KEYS]);
  });

  it('withholds invoices.manage while einvoice is off (the default)', () => {
    expect(FLAGS.einvoice).toBe(false);
    expect(permissionsFor('ADMIN', FLAGS)).toEqual(
      PERMISSION_KEYS.filter((key) => key !== 'invoices.manage'),
    );
  });

  it('keeps every admin.* key for ADMIN only', () => {
    for (const role of ['STAFF', 'MANAGER'] as const) {
      expect(permissionsFor(role, EINVOICE_ON).filter((key) => key.startsWith('admin.'))).toEqual(
        [],
      );
    }
  });
});
