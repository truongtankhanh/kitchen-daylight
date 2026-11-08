import { vietnamDateParts } from '../../../common/time/vietnam-time.js';
import type { RenderedMail } from './verify-email-code.template.js';

// api-outline staff transport, step-up bullet (brief L14): a change of the `payment` settings key
// emails the other `ACTIVE` admins "who, when, last five digits" (A4-T2). The key is not one of the
// five of data-model `email_templates`, so the text lives here only (api-divergences D-110). Plain
// text, Vietnamese, no link, never more than the last 5 digits of the account number.

export interface PaymentSettingsNoticeParams {
  /** Display name of the admin who saved the key, never an email. */
  readonly actorName: string;
  readonly changedAt: Date;
  /** The last 5 digits of the new account number, or `null` when it was cleared. */
  readonly accountNumberLast5: string | null;
}

const LAST_FIVE = /^\d{1,5}$/u;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `HH:mm dd/MM/yyyy`, Vietnam time. */
function formatChangedAt(instant: Date): string {
  const { year, month, day, hour, minute } = vietnamDateParts(instant);
  return `${pad(hour)}:${pad(minute)} ${pad(day)}/${pad(month)}/${String(year)}`;
}

export function renderPaymentSettingsNotice({
  actorName,
  changedAt,
  accountNumberLast5,
}: PaymentSettingsNoticeParams): RenderedMail {
  // The errors name the rule, never the value.
  if (actorName.trim() === '') {
    throw new RangeError('PAYMENT_SETTINGS_NOTICE: actorName is required');
  }
  if (accountNumberLast5 !== null && !LAST_FIVE.test(accountNumberLast5)) {
    throw new RangeError('PAYMENT_SETTINGS_NOTICE: at most the last 5 digits of the account');
  }
  const account =
    accountNumberLast5 === null
      ? 'Số tài khoản nhận chuyển khoản đã được xóa.'
      : `Số tài khoản nhận chuyển khoản mới kết thúc bằng ${accountNumberLast5}.`;
  return Object.freeze({
    templateKey: 'PAYMENT_SETTINGS_NOTICE',
    subject: 'Thông tin chuyển khoản của nhà hàng vừa được thay đổi',
    text: [
      'Xin chào,',
      '',
      `${actorName.trim()} vừa thay đổi thông tin chuyển khoản trong phần Cài đặt của Kitchen Daylight lúc ${formatChangedAt(changedAt)} (giờ Việt Nam).`,
      '',
      account,
      '',
      'Nếu thay đổi này không được thống nhất trước, hãy kiểm tra lại phần Cài đặt và nhật ký thao tác ngay.',
      '',
    ].join('\n'),
  });
}
