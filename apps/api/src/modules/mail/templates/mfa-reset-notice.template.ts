import type { RenderedMail } from './verify-email-code.template.js';

// Data-model `email_templates`, key `MFA_RESET_NOTICE`; api-outline `/admin/users/{id}/mfa-reset`
// (brief E9) and ADR-0009 WA20 (an admin resets another user's second factor, with a notice email).
// Until the table arrives (A12-T3) the text lives here. Plain text only, Vietnamese, no link, no
// code, no name of the admin who acted. Nothing is stored.

export function renderMfaResetNotice(): RenderedMail {
  return Object.freeze({
    templateKey: 'MFA_RESET_NOTICE',
    subject: 'Xác thực hai bước của bạn đã được đặt lại',
    text: [
      'Xin chào,',
      '',
      'Quản trị viên vừa đặt lại xác thực hai bước cho tài khoản quản trị Kitchen Daylight của bạn. Bạn đã được đăng xuất khỏi mọi thiết bị.',
      '',
      'Ở lần đăng nhập tiếp theo, bạn sẽ thiết lập lại ứng dụng xác thực và nhận bộ mã khôi phục mới.',
      '',
      'Nếu bạn không yêu cầu việc này, hãy liên hệ ngay với quản trị viên của nhà hàng.',
      '',
    ].join('\n'),
  });
}
