import type { MailTemplateKey } from '../ports/mail.port.js';

// Data-model `email_templates`, key `VERIFY_EMAIL_CODE`; ADR-0003, "Email flows". Until the table
// arrives (A12-T3) the text lives here. Plain text only, Vietnamese, the code appears once in the
// body and never in the subject. Nothing is stored.

export interface VerifyEmailCodeParams {
  /** The 6-digit code (ADR-0003). */
  readonly code: string;
  readonly expiresInMinutes: number;
}

export interface RenderedMail {
  readonly templateKey: MailTemplateKey;
  readonly subject: string;
  readonly text: string;
}

const CODE_FORMAT = /^\d{6}$/;

export function renderVerifyEmailCode({
  code,
  expiresInMinutes,
}: VerifyEmailCodeParams): RenderedMail {
  // The errors name the rule, never the value.
  if (!CODE_FORMAT.test(code)) {
    throw new RangeError('VERIFY_EMAIL_CODE: the code must be 6 digits');
  }
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1) {
    throw new RangeError('VERIFY_EMAIL_CODE: expiresInMinutes must be a positive integer');
  }

  return Object.freeze({
    templateKey: 'VERIFY_EMAIL_CODE',
    subject: 'Mã xác minh email của bạn',
    text: [
      'Xin chào,',
      '',
      `Mã xác minh email của bạn là: ${code}`,
      '',
      `Mã có hiệu lực trong ${expiresInMinutes} phút và chỉ dùng được một lần. Vui lòng không chia sẻ mã này với bất kỳ ai.`,
      '',
      'Nếu bạn không yêu cầu mã này, hãy bỏ qua email này.',
      '',
    ].join('\n'),
  });
}
