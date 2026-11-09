import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import type { GateSnapshot } from '../../common/gates/gate-snapshot.js';
import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import type { AuditService } from '../audit/audit.service.js';
import type { StepUpService } from '../auth/step-up/step-up.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { OutboxService } from '../realtime/outbox.service.js';
import {
  accountNumberLast5,
  AdminSettingsService,
  buildMetaConfig,
  configChangedEvent,
  NAV_COUNTS_REFETCH_SECONDS,
  SECURITY_SETTINGS,
  settingsAuditDiff,
  staleSettingError,
  toRecordView,
  withServerSince,
} from './admin-settings.service.js';
import type { MetaConfigInput } from './admin-settings.service.js';
import type { SettingValues } from './schema/registry.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';
import type { SettingRecord, SettingsService } from './settings.service.js';

const ADMIN = { id: '01930000-0000-7000-8000-0000000000d1', name: 'Quản trị Mẫu' };
const UPDATED_AT = new Date('2026-11-08T03:00:00.000Z');
const BRANCH = {
  id: '01930000-0000-7000-8000-0000000000b1',
  code: 'KD',
  name: 'Chi nhánh Mẫu',
  status: 'ACTIVE',
} as const;

/** Fictional bank details. */
const PAYMENT: SettingValues['payment'] = {
  bankName: 'Ngân hàng Mẫu',
  accountNumber: '0000000012345',
  accountHolder: 'CONG TY MAU',
  transferNoteRule: 'Mã đơn hàng',
  bankCode: '000001',
  qrMediaId: null,
};

function record<Value>(value: Value, rowVersion: number): SettingRecord<Value> {
  return { value, rowVersion, updatedBy: ADMIN, updatedAt: UPDATED_AT };
}

function metaInput(overrides: Partial<MetaConfigInput> = {}): MetaConfigInput {
  return {
    user: { id: ADMIN.id, displayName: ADMIN.name, role: 'STAFF', mfaEnabled: false },
    branches: [BRANCH],
    featureFlags: SETTING_DEFAULTS.featureFlags,
    ordering: SETTING_DEFAULTS.ordering,
    payment: PAYMENT,
    brand: { ...SETTING_DEFAULTS.brand, hotline: '+842800000001', taxCode: '0000000001' },
    reports: SETTING_DEFAULTS.reports,
    maintenance: SETTING_DEFAULTS.maintenance,
    ...overrides,
  };
}

describe('SECURITY_SETTINGS', () => {
  it('holds the staff values of decision 0008', () => {
    expect(SECURITY_SETTINGS).toEqual({
      totpRequiredRoles: ['MANAGER', 'ADMIN'],
      staffPasswordMinLength: 12,
      accessTokenMinutes: 15,
      sessionIdleDays: 1,
      sessionAbsoluteDays: 7,
      inviteHours: 48,
      resetMinutes: 30,
    });
  });
});

describe('toRecordView', () => {
  it('gives the time as ISO 8601 and keeps an unsaved key as rowVersion 0 with nulls', () => {
    expect(toRecordView(record(SETTING_DEFAULTS.reports, 3))).toEqual({
      value: SETTING_DEFAULTS.reports,
      rowVersion: 3,
      updatedBy: ADMIN,
      updatedAt: '2026-11-08T03:00:00.000Z',
    });
    expect(
      toRecordView({
        value: SETTING_DEFAULTS.reports,
        rowVersion: 0,
        updatedBy: null,
        updatedAt: null,
      }),
    ).toEqual({ value: SETTING_DEFAULTS.reports, rowVersion: 0, updatedBy: null, updatedAt: null });
  });
});

describe('staleSettingError', () => {
  it('carries the current state from the row-version helper and the current value', () => {
    const error = staleSettingError('ordering', record(SETTING_DEFAULTS.ordering, 5));

    expect(error.code).toBe('STALE_VERSION');
    expect(error.status).toBe(409);
    expect(error.extras).toEqual({
      current: {
        rowVersion: 5,
        updatedBy: ADMIN,
        updatedAt: '2026-11-08T03:00:00.000Z',
        value: SETTING_DEFAULTS.ordering,
      },
    });
  });

  it('keeps only the last five digits of the account number of a payment value', () => {
    const error = staleSettingError('payment', record(PAYMENT, 2));

    expect(error.extras).toMatchObject({
      current: { value: { accountNumberLast5: '12345', bankCode: '000001' } },
    });
    expect(JSON.stringify(error.extras)).not.toContain('0000000012345');
    expect(JSON.stringify(error.extras)).not.toContain('"accountNumber"');
  });

  it('answers updatedAt null for a key that has no row', () => {
    const error = staleSettingError('reports', {
      value: SETTING_DEFAULTS.reports,
      rowVersion: 0,
      updatedBy: null,
      updatedAt: null,
    });

    expect(error.extras).toEqual({
      current: { rowVersion: 0, updatedBy: null, updatedAt: null, value: SETTING_DEFAULTS.reports },
    });
  });
});

describe('settingsAuditDiff', () => {
  it('holds the version step and the value before and after', () => {
    const before = record(SETTING_DEFAULTS.reports, 1);
    const after = record({ businessDayStartsAt: '05:00' }, 2);

    expect(settingsAuditDiff('reports', before, after)).toEqual({
      rowVersion: { from: 1, to: 2 },
      before: { businessDayStartsAt: '04:00' },
      after: { businessDayStartsAt: '05:00' },
    });
  });

  it('keeps only the last five digits of a payment account number on both sides', () => {
    const diff = settingsAuditDiff(
      'payment',
      record(SETTING_DEFAULTS.payment, 0),
      record(PAYMENT, 1),
    );

    expect(diff).toMatchObject({
      before: { accountNumberLast5: null },
      after: { accountNumberLast5: '12345', bankName: 'Ngân hàng Mẫu' },
    });
    expect(JSON.stringify(diff)).not.toContain('0000000012345');
  });
});

describe('accountNumberLast5', () => {
  it.each([
    ['0000000012345', '12345'],
    ['123', '123'],
    [null, null],
    ['', null],
  ])('reduces %j to %j', (input, expected) => {
    expect(accountNumberLast5(input)).toBe(expected);
  });
});

describe('buildMetaConfig', () => {
  it('assembles the AdminMetaConfig shape and nothing else', () => {
    const meta = buildMetaConfig(metaInput());

    expect(meta).toEqual({
      user: { id: ADMIN.id, displayName: ADMIN.name, role: 'STAFF', mfaEnabled: false },
      branches: [BRANCH],
      permissions: ['orders.read', 'orders.write', 'reviews.read'],
      features: SETTING_DEFAULTS.featureFlags,
      ordering: {
        boardThresholds: { accept: { warn: 5, late: 10 }, ready: { warn: 15, late: 25 } },
        boardRefetchSeconds: 15,
      },
      payment: {
        bankName: 'Ngân hàng Mẫu',
        accountNumber: '0000000012345',
        holder: 'CONG TY MAU',
        bankCode: '000001',
        qrUrl: null,
      },
      brand: { hotline: '+842800000001', receipt: { paperWidth: 80 } },
      reports: { businessDayStartsAt: '04:00' },
      maintenance: { enabled: false, message: null, expectedBackAt: null, since: null },
      navCountsRefetchSeconds: NAV_COUNTS_REFETCH_SECONDS,
    });
  });

  it('never returns security, the tax code, admin-only settings or the loyalty rates', () => {
    const text = JSON.stringify(buildMetaConfig(metaInput()));

    for (const name of [
      'security',
      'taxCode',
      'supportEmail',
      'transferNoteRule',
      'minAppVersion',
      'maxItemQuantity',
      'earnVndPerPoint',
    ]) {
      expect(text).not.toContain(name);
    }
  });

  it('computes the permissions from the role and the feature flags', () => {
    const admin = metaInput({
      user: { id: ADMIN.id, displayName: ADMIN.name, role: 'ADMIN', mfaEnabled: true },
    });

    expect(buildMetaConfig(admin).permissions).toContain('admin.settings');
    expect(buildMetaConfig(admin).permissions).not.toContain('invoices.manage');
    expect(
      buildMetaConfig({
        ...admin,
        featureFlags: { ...SETTING_DEFAULTS.featureFlags, einvoice: true },
      }).permissions,
    ).toContain('invoices.manage');
  });
});

describe('AdminSettingsService.save', () => {
  it('refuses the payment key without a valid step-up token before any SQL', async () => {
    const transaction = vi.fn();
    const verify = vi.fn(() => Promise.resolve(false));
    const service = new AdminSettingsService(
      { transaction } as unknown as DataSource,
      {} as SettingsService,
      {} as AuditService,
      {} as MailService,
      { verify } as unknown as StepUpService,
      {} as BranchScopeService,
      {} as OutboxService,
      {} as GateSnapshot,
      new FixedClock(UPDATED_AT),
    );
    const actor = { id: ADMIN.id, role: 'ADMIN', sessionId: ADMIN.id } as const;
    const input = { key: 'payment', value: PAYMENT, rowVersion: 0 } as const;

    for (const token of [undefined, 'not-a-step-up-token']) {
      const error: unknown = await service.save(actor, input, token).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('FORBIDDEN');
    }
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('not-a-step-up-token', ADMIN.id, 'settings.payment');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('withServerSince', () => {
  const NOW = new Date('2026-11-09T01:00:00.000Z');
  const OFF = SETTING_DEFAULTS.maintenance;
  const ON = {
    enabled: true,
    message: 'Hệ thống đang bảo trì.',
    expectedBackAt: null,
    since: '2026-11-09T00:30:00.000Z',
  } as const;

  it('stamps now when maintenance turns on, whatever the client sent', () => {
    for (const since of [null, '2020-01-01T00:00:00.000Z', 'not an instant']) {
      expect(withServerSince({ ...ON, since }, OFF, NOW)).toEqual({
        ...ON,
        since: '2026-11-09T01:00:00.000Z',
      });
    }
    const withoutSince = { enabled: ON.enabled, message: ON.message, expectedBackAt: null };
    expect(withServerSince(withoutSince, OFF, NOW)).toEqual({
      ...ON,
      since: '2026-11-09T01:00:00.000Z',
    });
  });

  it('keeps the stored instant while maintenance stays on', () => {
    expect(withServerSince({ ...ON, message: 'Sắp xong.', since: null }, ON, NOW)).toEqual({
      ...ON,
      message: 'Sắp xong.',
      since: '2026-11-09T00:30:00.000Z',
    });
  });

  it('stamps now when maintenance is on but no instant is stored', () => {
    expect(withServerSince(ON, { ...ON, since: null }, NOW)).toEqual({
      ...ON,
      since: '2026-11-09T01:00:00.000Z',
    });
  });

  it('clears since when maintenance is off', () => {
    expect(withServerSince({ ...OFF, since: '2026-11-09T00:30:00.000Z' }, ON, NOW)).toEqual(OFF);
    expect(withServerSince({ ...OFF, enabled: 'yes' }, OFF, NOW)).toEqual({
      ...OFF,
      enabled: 'yes',
      since: null,
    });
  });

  it('leaves a value that is not an object to the validation rules', () => {
    for (const value of [null, 'on', 1, [ON]]) {
      expect(withServerSince(value, OFF, NOW)).toBe(value);
    }
  });
});

describe('configChangedEvent', () => {
  it('is a PUBLIC signal with the key and the version, never a value or the editor', () => {
    expect(configChangedEvent('minAppVersion', 'min_app_version', 3)).toEqual({
      type: 'config.changed',
      audience: 'PUBLIC',
      entityType: 'app_settings',
      entityId: 'min_app_version',
      version: 3,
      payload: { keys: ['minAppVersion'], version: 3 },
    });
  });
});
