import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { renderStaffInvite } from './staff-invite.template.js';
import { renderStaffPasswordReset } from './staff-password-reset.template.js';

// A throw-away token for each run; fictional origin.
const TOKEN = randomBytes(32).toString('base64url');
const INVITE_LINK = `https://admin.kitchendaylight.example/auth/set-password#token=${TOKEN}`;
const RESET_LINK = `https://admin.kitchendaylight.example/auth/reset-password#token=${TOKEN}`;

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('renderStaffInvite', () => {
  it('renders the STAFF_INVITE key as plain Vietnamese text with the link once', () => {
    const mail = renderStaffInvite({ link: INVITE_LINK, expiresInHours: 48 });

    expect(mail.templateKey).toBe('STAFF_INVITE');
    expect(mail.text).toContain('48 giờ');
    expect(occurrences(mail.text, INVITE_LINK)).toBe(1);
    expect(occurrences(mail.text, TOKEN)).toBe(1);
    expect(mail.subject).not.toContain(TOKEN);
    expect(Object.keys(mail).sort()).toEqual(['subject', 'templateKey', 'text']);
    expect(mail.text).not.toMatch(/<[a-z][^>]*>/i);
    expect(Object.isFrozen(mail)).toBe(true);
  });

  it.each([
    `https://admin.kitchendaylight.example/auth/set-password?token=${TOKEN}`,
    'https://admin.kitchendaylight.example/auth/set-password',
    `ftp://admin.kitchendaylight.example/auth/set-password#token=${TOKEN}`,
    `/auth/set-password#token=${TOKEN}`,
  ])('rejects a link without the token fragment, without echoing it (%#)', (link) => {
    expect(() => renderStaffInvite({ link, expiresInHours: 48 })).toThrow(
      'STAFF_INVITE: the link must be an http(s) URL with #token=',
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects expiresInHours=%s', (expiresInHours) => {
    expect(() => renderStaffInvite({ link: INVITE_LINK, expiresInHours })).toThrow(
      'STAFF_INVITE: expiresInHours must be a positive integer',
    );
  });
});

describe('renderStaffPasswordReset', () => {
  it('renders the STAFF_PASSWORD_RESET key as plain Vietnamese text with the link once', () => {
    const mail = renderStaffPasswordReset({ link: RESET_LINK, expiresInMinutes: 30 });

    expect(mail.templateKey).toBe('STAFF_PASSWORD_RESET');
    expect(mail.text).toContain('30 phút');
    expect(occurrences(mail.text, RESET_LINK)).toBe(1);
    expect(occurrences(mail.text, TOKEN)).toBe(1);
    expect(mail.subject).not.toContain(TOKEN);
    expect(Object.isFrozen(mail)).toBe(true);
  });

  it('rejects a link with the token in the query string', () => {
    expect(() =>
      renderStaffPasswordReset({
        link: `https://admin.kitchendaylight.example/auth/reset-password?token=${TOKEN}`,
        expiresInMinutes: 30,
      }),
    ).toThrow('STAFF_PASSWORD_RESET: the link must be an http(s) URL with #token=');
  });

  it.each([0, -1, 1.5])('rejects expiresInMinutes=%s', (expiresInMinutes) => {
    expect(() => renderStaffPasswordReset({ link: RESET_LINK, expiresInMinutes })).toThrow(
      'STAFF_PASSWORD_RESET: expiresInMinutes must be a positive integer',
    );
  });
});
