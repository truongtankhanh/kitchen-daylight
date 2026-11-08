import { IsDefined, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';

import { defineSettingSchema, IsDigits, IsNotBlank } from './setting-rules.js';

// `payment` (data-model `app_settings`; brief A13, L14; mobile G49, G51, G52): what a customer is
// told about bank transfer. Every field null means bank transfer is off (cash only, mobile open
// question 9). Whether the key is complete, and the step-up of A3-T6, are A4-T2 and A4-T3.

/** The bank code needed for the transfer QR (brief A13). */
export const BANK_CODE_LENGTH = 6;
/** Bounds the documents do not state (api-divergences D-105). */
export const BANK_NAME_MAX_LENGTH = 100;
export const ACCOUNT_HOLDER_MAX_LENGTH = 100;
export const ACCOUNT_NUMBER_MAX_LENGTH = 30;
export const TRANSFER_NOTE_RULE_MAX_LENGTH = 100;

export interface PaymentSetting {
  readonly bankName: string | null;
  /** One continuous string of digits; the app groups it for display (mobile G51). */
  readonly accountNumber: string | null;
  readonly accountHolder: string | null;
  /** How the customer writes the transfer note; data-model says "the order number". */
  readonly transferNoteRule: string | null;
  /** 6 digits. */
  readonly bankCode: string | null;
  /** A `media` id; that it exists is checked by A6-T3 (mobile G52). */
  readonly qrMediaId: string | null;
}

/** `app_settings.value` of key `payment`, data-model names (api-divergences D-104). */
export interface PaymentStored {
  readonly bank_name: string | null;
  readonly account_number: string | null;
  readonly account_holder: string | null;
  readonly transfer_note_rule: string | null;
  readonly bank_code: string | null;
  readonly qr_media_id: string | null;
}

/** Every field is present; a nullable one takes `null`. */
export class PaymentSettingDto implements PaymentSetting {
  @ValidateIf((dto: PaymentSettingDto) => dto.bankName !== null)
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(BANK_NAME_MAX_LENGTH)
  bankName!: string | null;

  @ValidateIf((dto: PaymentSettingDto) => dto.accountNumber !== null)
  @IsDefined()
  @IsString()
  @IsDigits()
  @MaxLength(ACCOUNT_NUMBER_MAX_LENGTH)
  accountNumber!: string | null;

  @ValidateIf((dto: PaymentSettingDto) => dto.accountHolder !== null)
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(ACCOUNT_HOLDER_MAX_LENGTH)
  accountHolder!: string | null;

  @ValidateIf((dto: PaymentSettingDto) => dto.transferNoteRule !== null)
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(TRANSFER_NOTE_RULE_MAX_LENGTH)
  transferNoteRule!: string | null;

  /** Exactly 6 digits: a non-digit or another length is `INVALID_FORMAT`. */
  @ValidateIf((dto: PaymentSettingDto) => dto.bankCode !== null)
  @IsDefined()
  @IsString()
  @IsDigits()
  @Length(BANK_CODE_LENGTH, BANK_CODE_LENGTH)
  bankCode!: string | null;

  @ValidateIf((dto: PaymentSettingDto) => dto.qrMediaId !== null)
  @IsDefined()
  @IsUUID('all')
  qrMediaId!: string | null;
}

export function toPaymentStored(value: PaymentSetting): PaymentStored {
  return {
    bank_name: value.bankName,
    account_number: value.accountNumber,
    account_holder: value.accountHolder,
    transfer_note_rule: value.transferNoteRule,
    bank_code: value.bankCode,
    qr_media_id: value.qrMediaId,
  };
}

export function fromPaymentStored(stored: PaymentStored): PaymentSetting {
  return {
    bankName: stored.bank_name,
    accountNumber: stored.account_number,
    accountHolder: stored.account_holder,
    transferNoteRule: stored.transfer_note_rule,
    bankCode: stored.bank_code,
    qrMediaId: stored.qr_media_id,
  };
}

export const paymentSchema = defineSettingSchema<'payment', PaymentSetting, PaymentStored>({
  key: 'payment',
  storageKey: 'payment',
  dto: PaymentSettingDto,
  toStored: toPaymentStored,
  fromStored: fromPaymentStored,
});
