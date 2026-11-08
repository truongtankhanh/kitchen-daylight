import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import { brandSchema, fromBrandStored, toBrandStored } from './brand.schema.js';
import type { BrandSetting } from './brand.schema.js';

const DEFAULTS = SETTING_DEFAULTS.brand;
const MEDIA_ID = '01930000-0000-7000-8000-0000000000a1';

/** A complete, fictional brand. */
const FILLED: BrandSetting = {
  name: 'Kitchen Daylight',
  logo: MEDIA_ID,
  hotline: '+842800000001',
  supportEmail: 'support@kitchendaylight.example',
  businessAddress: '1 Đường Mẫu, Phường Mẫu',
  taxCode: '0000000001',
  receipt: { title: 'HÓA ĐƠN', footer: 'Cảm ơn quý khách', paperWidth: 58, showTaxCode: true },
};

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = brandSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

function withChanges(changes: Record<string, unknown>): Record<string, unknown> {
  return { ...FILLED, ...changes };
}

function withReceipt(changes: Record<string, unknown>): Record<string, unknown> {
  return withChanges({ receipt: { ...FILLED.receipt, ...changes } });
}

describe('brandSchema', () => {
  it('accepts its own defaults', () => {
    expect(brandSchema.parse(DEFAULTS)).toEqual({ ok: true, value: DEFAULTS });
  });

  it('holds the placeholder name, null contact fields and the receipt defaults', () => {
    expect(DEFAULTS).toEqual({
      name: 'Kitchen Daylight',
      logo: null,
      hotline: null,
      supportEmail: null,
      businessAddress: null,
      taxCode: null,
      receipt: { title: 'HÓA ĐƠN BÁN HÀNG', footer: '', paperWidth: 80, showTaxCode: false },
    });
  });

  it('accepts a complete brand', () => {
    expect(brandSchema.parse(FILLED)).toEqual({ ok: true, value: FILLED });
  });

  it('maps to the snake_case names of data-model and back', () => {
    const stored = toBrandStored(FILLED);

    expect(stored).toEqual({
      name: 'Kitchen Daylight',
      logo: MEDIA_ID,
      hotline: '+842800000001',
      support_email: 'support@kitchendaylight.example',
      business_address: '1 Đường Mẫu, Phường Mẫu',
      tax_code: '0000000001',
      receipt: {
        title: 'HÓA ĐƠN',
        footer: 'Cảm ơn quý khách',
        paper_width: 58,
        show_tax_code: true,
      },
    });
    expect(fromBrandStored(stored)).toEqual(FILLED);
    expect(fromBrandStored(toBrandStored(DEFAULTS))).toEqual(DEFAULTS);
  });

  it.each([
    ['a 13-digit tax code', { taxCode: '0000000001001' }],
    ['a mobile hotline', { hotline: '+84900000001' }],
    ['a name of 100 characters', { name: 'a'.repeat(100) }],
  ])('accepts %s', (_case, changes) => {
    expect(errorsOf(withChanges(changes))).toEqual([]);
  });

  it.each([
    ['a missing name', { name: undefined }, 'brand.name', 'REQUIRED'],
    ['a blank name', { name: '   ' }, 'brand.name', 'REQUIRED'],
    ['a name of 101 characters', { name: 'a'.repeat(101) }, 'brand.name', 'TOO_LONG'],
    ['a number as name', { name: 5 }, 'brand.name', 'INVALID'],
    ['a missing hotline', { hotline: undefined }, 'brand.hotline', 'REQUIRED'],
    ['a hotline in national form', { hotline: '02800000001' }, 'brand.hotline', 'INVALID_PHONE'],
    ['a hotline with spaces', { hotline: '+84 28 0000 0001' }, 'brand.hotline', 'INVALID_PHONE'],
    ['a malformed email', { supportEmail: 'support' }, 'brand.supportEmail', 'INVALID_EMAIL'],
    ['a 9-digit tax code', { taxCode: '000000001' }, 'brand.taxCode', 'INVALID_TAX_CODE'],
    ['a tax code with a dash', { taxCode: '0000000001-001' }, 'brand.taxCode', 'INVALID_TAX_CODE'],
    ['a logo that is not a uuid', { logo: 'logo.png' }, 'brand.logo', 'INVALID'],
    [
      'a business address of 256 characters',
      { businessAddress: 'a'.repeat(256) },
      'brand.businessAddress',
      'TOO_LONG',
    ],
    ['a missing receipt', { receipt: undefined }, 'brand.receipt', 'REQUIRED'],
  ])('reports %s', (_case, changes, field, code) => {
    expect(errorsOf(withChanges(changes))).toEqual([{ field, code }]);
  });

  it.each([
    ['a title of 40 characters', { title: 'a'.repeat(40) }],
    ['an empty footer', { footer: '' }],
    ['a footer of 200 characters', { footer: 'a'.repeat(200) }],
    ['a footer of 4 lines', { footer: 'a\nb\r\nc\nd' }],
    ['paper width 80', { paperWidth: 80 }],
  ])('accepts a receipt with %s', (_case, changes) => {
    expect(errorsOf(withReceipt(changes))).toEqual([]);
  });

  it.each([
    ['a title of 41 characters', { title: 'a'.repeat(41) }, 'title', 'TOO_LONG'],
    ['an empty title', { title: '' }, 'title', 'REQUIRED'],
    ['a footer of 201 characters', { footer: 'a'.repeat(201) }, 'footer', 'TOO_LONG'],
    ['a footer of 5 lines', { footer: 'a\nb\nc\nd\ne' }, 'footer', 'TOO_LONG'],
    ['paper width 70', { paperWidth: 70 }, 'paperWidth', 'OUT_OF_RANGE'],
    ['a missing showTaxCode', { showTaxCode: undefined }, 'showTaxCode', 'REQUIRED'],
    ['a string showTaxCode', { showTaxCode: 'true' }, 'showTaxCode', 'INVALID'],
  ])('reports a receipt with %s', (_case, changes, field, code) => {
    expect(errorsOf(withReceipt(changes))).toEqual([{ field: `brand.receipt.${field}`, code }]);
  });

  it('never puts the rejected value in an error', () => {
    const result = brandSchema.parse(withChanges({ hotline: '02800000001', taxCode: '123' }));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('02800000001');
  });
});
