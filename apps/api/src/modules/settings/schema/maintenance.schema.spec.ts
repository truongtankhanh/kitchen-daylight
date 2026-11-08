import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import {
  fromMaintenanceStored,
  maintenanceSchema,
  toMaintenanceStored,
} from './maintenance.schema.js';
import type { MaintenanceSetting } from './maintenance.schema.js';

const ON: MaintenanceSetting = {
  enabled: true,
  message: 'Hệ thống đang bảo trì.',
  expectedBackAt: '2026-11-08T10:00:00+07:00',
  since: '2026-11-08T02:00:00.000Z',
};

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = maintenanceSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

describe('maintenanceSchema', () => {
  it('accepts its own default, off with every other field null', () => {
    expect(SETTING_DEFAULTS.maintenance).toEqual({
      enabled: false,
      message: null,
      expectedBackAt: null,
      since: null,
    });
    expect(maintenanceSchema.parse(SETTING_DEFAULTS.maintenance)).toEqual({
      ok: true,
      value: SETTING_DEFAULTS.maintenance,
    });
  });

  it('accepts maintenance switched on with a message and times', () => {
    expect(errorsOf(ON)).toEqual([]);
  });

  it('maps to the snake_case names of data-model and back', () => {
    expect(toMaintenanceStored(ON)).toEqual({
      enabled: true,
      message: 'Hệ thống đang bảo trì.',
      expected_back_at: '2026-11-08T10:00:00+07:00',
      since: '2026-11-08T02:00:00.000Z',
    });
    expect(fromMaintenanceStored(toMaintenanceStored(ON))).toEqual(ON);
  });

  it.each([
    ['a missing enabled', { enabled: undefined }, 'enabled', 'REQUIRED'],
    ['a string enabled', { enabled: 'true' }, 'enabled', 'INVALID'],
    ['a missing message', { message: undefined }, 'message', 'REQUIRED'],
    ['a blank message', { message: ' ' }, 'message', 'REQUIRED'],
    ['a message of 501 characters', { message: 'a'.repeat(501) }, 'message', 'TOO_LONG'],
    [
      'an expectedBackAt that is no instant',
      { expectedBackAt: 'tomorrow' },
      'expectedBackAt',
      'INVALID_FORMAT',
    ],
    ['a since that is no instant', { since: '2026-13-01' }, 'since', 'INVALID_FORMAT'],
  ])('reports %s', (_case, changes, field, code) => {
    expect(errorsOf({ ...ON, ...changes })).toEqual([{ field: `maintenance.${field}`, code }]);
  });
});
