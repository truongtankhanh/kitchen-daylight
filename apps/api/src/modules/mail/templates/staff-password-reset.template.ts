import { isStaffLink } from './staff-link.js';
import type { RenderedMail } from './verify-email-code.template.js';

// Data-model `email_templates`, key `STAFF_PASSWORD_RESET`; ADR-0003, "Email flows" (staff
// password reset link, 30 minutes; ADR-0008 #2). Until the table arrives (A12-T3) the text lives
// here. Plain text only, Vietnamese, the link appears once in the body and never in the subject.
// Nothing is stored.

export interface StaffPasswordResetParams {
  /** `<admin origin>/auth/reset-password#token=<token>` (decision 0008 section 6). */
  readonly link: string;
  readonly expiresInMinutes: number;
}

export function renderStaffPasswordReset({
  link,
  expiresInMinutes,
}: StaffPasswordResetParams): RenderedMail {
  // The errors name the rule, never the value.
  if (!isStaffLink(link)) {
    throw new RangeError('STAFF_PASSWORD_RESET: the link must be an http(s) URL with #token=');
  }
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1) {
    throw new RangeError('STAFF_PASSWORD_RESET: expiresInMinutes must be a positive integer');
  }

  return Object.freeze({
    templateKey: 'STAFF_PASSWORD_RESET',
    subject: 'Đặt lại mật khẩu trang quản trị Kitchen Daylight',
    text: [
      'Xin chào,',
      '',
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản quản trị của bạn. Hãy mở liên kết sau để đặt mật khẩu mới:',
      '',
      link,
      '',
      `Liên kết có hiệu lực trong ${expiresInMinutes} phút và chỉ dùng được một lần. Vui lòng không chia sẻ liên kết này với bất kỳ ai.`,
      '',
      'Sau khi đặt lại mật khẩu, bạn sẽ được đăng xuất khỏi mọi thiết bị.',
      '',
      'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn giữ nguyên.',
      '',
    ].join('\n'),
  });
}
