import type { RenderedMail } from './verify-email-code.template.js';

// Data-model `email_templates`, key `PASSWORD_RESET_CODE`; ADR-0003, "Email flows" (customers reset
// with a 6-digit code typed in the app; staff use links, A3-T3). Until the table arrives (A12-T3)
// the text lives here. Plain text only, Vietnamese, the code appears once in the body and never in
// the subject. Nothing is stored.

export interface PasswordResetCodeParams {
  /** The 6-digit code (ADR-0003). */
  readonly code: string;
  readonly expiresInMinutes: number;
}

const CODE_FORMAT = /^\d{6}$/;

export function renderPasswordResetCode({
  code,
  expiresInMinutes,
}: PasswordResetCodeParams): RenderedMail {
  // The errors name the rule, never the value.
  if (!CODE_FORMAT.test(code)) {
    throw new RangeError('PASSWORD_RESET_CODE: the code must be 6 digits');
  }
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1) {
    throw new RangeError('PASSWORD_RESET_CODE: expiresInMinutes must be a positive integer');
  }

  return Object.freeze({
    templateKey: 'PASSWORD_RESET_CODE',
    subject: 'Mã đặt lại mật khẩu của bạn',
    text: [
      'Xin chào,',
      '',
      `Mã đặt lại mật khẩu của bạn là: ${code}`,
      '',
      `Mã có hiệu lực trong ${expiresInMinutes} phút và chỉ dùng được một lần. Vui lòng không chia sẻ mã này với bất kỳ ai.`,
      '',
      'Sau khi đặt lại mật khẩu, bạn sẽ được đăng xuất khỏi mọi thiết bị.',
      '',
      'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn giữ nguyên.',
      '',
    ].join('\n'),
  });
}
