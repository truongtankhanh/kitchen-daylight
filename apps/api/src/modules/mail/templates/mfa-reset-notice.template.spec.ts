import { describe, expect, it } from 'vitest';

import { renderMfaResetNotice } from './mfa-reset-notice.template.js';

describe('renderMfaResetNotice', () => {
  it('renders the MFA_RESET_NOTICE key as plain Vietnamese text without a link', () => {
    const mail = renderMfaResetNotice();

    expect(mail.templateKey).toBe('MFA_RESET_NOTICE');
    expect(mail.subject).toBe('Xác thực hai bước của bạn đã được đặt lại');
    expect(mail.text).toContain('đăng xuất khỏi mọi thiết bị');
    expect(mail.text).not.toMatch(/https?:\/\//u);
    expect(mail.text).not.toMatch(/<[a-z][^>]*>/iu);
    expect(Object.keys(mail).sort()).toEqual(['subject', 'templateKey', 'text']);
    expect(Object.isFrozen(mail)).toBe(true);
  });
});
