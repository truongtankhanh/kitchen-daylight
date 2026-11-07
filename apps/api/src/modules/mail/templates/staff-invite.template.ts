import { isStaffLink } from './staff-link.js';
import type { RenderedMail } from './verify-email-code.template.js';

// Data-model `email_templates`, key `STAFF_INVITE`; ADR-0003, "Email flows" (staff: invitation
// link, single use, 48 hours; ADR-0008 #2). Until the table arrives (A12-T3) the text lives here.
// Plain text only, Vietnamese, the link appears once in the body and never in the subject. Nothing
// is stored.

export interface StaffInviteParams {
  /** `<admin origin>/auth/set-password#token=<token>` (decision 0008 section 6). */
  readonly link: string;
  readonly expiresInHours: number;
}

export function renderStaffInvite({ link, expiresInHours }: StaffInviteParams): RenderedMail {
  // The errors name the rule, never the value.
  if (!isStaffLink(link)) {
    throw new RangeError('STAFF_INVITE: the link must be an http(s) URL with #token=');
  }
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1) {
    throw new RangeError('STAFF_INVITE: expiresInHours must be a positive integer');
  }

  return Object.freeze({
    templateKey: 'STAFF_INVITE',
    subject: 'Lời mời tham gia trang quản trị Kitchen Daylight',
    text: [
      'Xin chào,',
      '',
      'Bạn được mời sử dụng trang quản trị Kitchen Daylight. Hãy mở liên kết sau để đặt mật khẩu và kích hoạt tài khoản:',
      '',
      link,
      '',
      `Liên kết có hiệu lực trong ${expiresInHours} giờ và chỉ dùng được một lần. Vui lòng không chia sẻ liên kết này với bất kỳ ai.`,
      '',
      'Nếu bạn không chờ đợi lời mời này, hãy bỏ qua email này.',
      '',
    ].join('\n'),
  });
}
