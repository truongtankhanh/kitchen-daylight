import { describe, expect, it } from 'vitest';

import { renderPaymentSettingsNotice } from './payment-settings-notice.template.js';

// 2026-11-08 03:05 UTC is 10:05 in Vietnam (UTC+7).
const CHANGED_AT = new Date('2026-11-08T03:05:00.000Z');

describe('renderPaymentSettingsNotice', () => {
  it('names who, when (Vietnam time) and the last five digits, as plain text without a link', () => {
    const mail = renderPaymentSettingsNotice({
      actorName: 'Quản trị Mẫu',
      changedAt: CHANGED_AT,
      accountNumberLast5: '00001',
    });

    expect(mail.templateKey).toBe('PAYMENT_SETTINGS_NOTICE');
    expect(mail.subject).toBe('Thông tin chuyển khoản của nhà hàng vừa được thay đổi');
    expect(mail.text).toContain('Quản trị Mẫu vừa thay đổi thông tin chuyển khoản');
    expect(mail.text).toContain('lúc 10:05 08/11/2026 (giờ Việt Nam)');
    expect(mail.text).toContain('kết thúc bằng 00001');
    expect(mail.text).not.toMatch(/https?:\/\//u);
    expect(mail.text).not.toMatch(/<[a-z][^>]*>/iu);
    expect(Object.keys(mail).sort()).toEqual(['subject', 'templateKey', 'text']);
    expect(Object.isFrozen(mail)).toBe(true);
  });

  it('says the account was cleared when there is no account number', () => {
    const mail = renderPaymentSettingsNotice({
      actorName: 'Quản trị Mẫu',
      changedAt: CHANGED_AT,
      accountNumberLast5: null,
    });

    expect(mail.text).toContain('Số tài khoản nhận chuyển khoản đã được xóa.');
  });

  it('refuses more than five digits, so a full account number never reaches a mail', () => {
    expect(() =>
      renderPaymentSettingsNotice({
        actorName: 'Quản trị Mẫu',
        changedAt: CHANGED_AT,
        accountNumberLast5: '0000000001',
      }),
    ).toThrow(new RangeError('PAYMENT_SETTINGS_NOTICE: at most the last 5 digits of the account'));
  });

  it('refuses a blank actor name', () => {
    expect(() =>
      renderPaymentSettingsNotice({
        actorName: ' ',
        changedAt: CHANGED_AT,
        accountNumberLast5: null,
      }),
    ).toThrow(RangeError);
  });
});
