import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  defineSettingSchema,
  IsE164Phone,
  IsNotBlank,
  IsTaxCode,
  MaxLines,
} from './setting-rules.js';

// `brand` (data-model `app_settings`; brief L5, L6, L7, L11).

export const RECEIPT_TITLE_MAX_LENGTH = 40;
export const RECEIPT_FOOTER_MAX_LENGTH = 200;
export const RECEIPT_FOOTER_MAX_LINES = 4;
export const RECEIPT_PAPER_WIDTHS = [58, 80] as const;
export type ReceiptPaperWidth = (typeof RECEIPT_PAPER_WIDTHS)[number];

/** Bounds the documents do not state (api-divergences D-105). */
export const BRAND_NAME_MAX_LENGTH = 100;
export const BUSINESS_ADDRESS_MAX_LENGTH = 255;
/** RFC 5321 path limit, as for `users.email`. */
export const SUPPORT_EMAIL_MAX_LENGTH = 254;

export interface ReceiptSetting {
  readonly title: string;
  readonly footer: string;
  /** Millimetres. */
  readonly paperWidth: ReceiptPaperWidth;
  /** The tax code is printed only when this is true and a code exists (brief L6). */
  readonly showTaxCode: boolean;
}

export interface BrandSetting {
  readonly name: string;
  /** A `media` id; that it exists is checked by A6-T3 (brief L5). */
  readonly logo: string | null;
  /** E.164; a landline is allowed. */
  readonly hotline: string | null;
  readonly supportEmail: string | null;
  /** No stated use yet (brief L11). */
  readonly businessAddress: string | null;
  /** 10 or 13 digits (brief L6). */
  readonly taxCode: string | null;
  readonly receipt: ReceiptSetting;
}

/** `app_settings.value` of key `brand`, data-model names. */
export interface BrandStored {
  readonly name: string;
  readonly logo: string | null;
  readonly hotline: string | null;
  readonly support_email: string | null;
  readonly business_address: string | null;
  readonly tax_code: string | null;
  readonly receipt: {
    readonly title: string;
    readonly footer: string;
    readonly paper_width: ReceiptPaperWidth;
    readonly show_tax_code: boolean;
  };
}

export class ReceiptSettingDto implements ReceiptSetting {
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(RECEIPT_TITLE_MAX_LENGTH)
  title!: string;

  /** May be empty. */
  @IsDefined()
  @IsString()
  @MaxLength(RECEIPT_FOOTER_MAX_LENGTH)
  @MaxLines(RECEIPT_FOOTER_MAX_LINES)
  footer!: string;

  @IsDefined()
  @IsIn(RECEIPT_PAPER_WIDTHS)
  paperWidth!: ReceiptPaperWidth;

  @IsDefined()
  @IsBoolean()
  showTaxCode!: boolean;
}

/** Every field is present; a nullable one takes `null`. */
export class BrandSettingDto implements BrandSetting {
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(BRAND_NAME_MAX_LENGTH)
  name!: string;

  @ValidateIf((dto: BrandSettingDto) => dto.logo !== null)
  @IsDefined()
  @IsUUID('all')
  logo!: string | null;

  @ValidateIf((dto: BrandSettingDto) => dto.hotline !== null)
  @IsDefined()
  @IsE164Phone()
  hotline!: string | null;

  @ValidateIf((dto: BrandSettingDto) => dto.supportEmail !== null)
  @IsDefined()
  @IsString()
  @IsEmail()
  @MaxLength(SUPPORT_EMAIL_MAX_LENGTH)
  supportEmail!: string | null;

  @ValidateIf((dto: BrandSettingDto) => dto.businessAddress !== null)
  @IsDefined()
  @IsString()
  @IsNotBlank()
  @MaxLength(BUSINESS_ADDRESS_MAX_LENGTH)
  businessAddress!: string | null;

  @ValidateIf((dto: BrandSettingDto) => dto.taxCode !== null)
  @IsDefined()
  @IsTaxCode()
  taxCode!: string | null;

  @IsDefined()
  @ValidateNested()
  @Type(() => ReceiptSettingDto)
  receipt!: ReceiptSettingDto;
}

export function toBrandStored(value: BrandSetting): BrandStored {
  return {
    name: value.name,
    logo: value.logo,
    hotline: value.hotline,
    support_email: value.supportEmail,
    business_address: value.businessAddress,
    tax_code: value.taxCode,
    receipt: {
      title: value.receipt.title,
      footer: value.receipt.footer,
      paper_width: value.receipt.paperWidth,
      show_tax_code: value.receipt.showTaxCode,
    },
  };
}

export function fromBrandStored(stored: BrandStored): BrandSetting {
  return {
    name: stored.name,
    logo: stored.logo,
    hotline: stored.hotline,
    supportEmail: stored.support_email,
    businessAddress: stored.business_address,
    taxCode: stored.tax_code,
    receipt: {
      title: stored.receipt.title,
      footer: stored.receipt.footer,
      paperWidth: stored.receipt.paper_width,
      showTaxCode: stored.receipt.show_tax_code,
    },
  };
}

export const brandSchema = defineSettingSchema<'brand', BrandSetting, BrandStored>({
  key: 'brand',
  storageKey: 'brand',
  dto: BrandSettingDto,
  toStored: toBrandStored,
  fromStored: fromBrandStored,
});
