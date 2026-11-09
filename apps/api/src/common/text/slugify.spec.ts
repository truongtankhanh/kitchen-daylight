import { describe, expect, it } from 'vitest';

import { SLUG_PATTERN, slugify } from './slugify.js';

describe('slugify', () => {
  it('strips the Vietnamese tone marks and lowers the case', () => {
    expect(slugify('Chi nhánh Bến Thành')).toBe('chi-nhanh-ben-thanh');
    expect(slugify('Phở Ngõ Huế')).toBe('pho-ngo-hue');
    expect(slugify('Ấm Áp Ồn Ào Ửng Ững')).toBe('am-ap-on-ao-ung-ung');
  });

  it('turns đ and Đ into d', () => {
    expect(slugify('Đà Lạt')).toBe('da-lat');
    expect(slugify('Quận đông')).toBe('quan-dong');
    expect(slugify('ĐĐđđ')).toBe('dddd');
  });

  it('strips the marks of ơ, ư, ă and â', () => {
    expect(slugify('Ơn Ưu Ăn Âm')).toBe('on-uu-an-am');
  });

  it('handles text that arrives already decomposed (NFD)', () => {
    expect(slugify('Bến')).toBe('ben');
  });

  it('collapses every run of other characters into one hyphen', () => {
    expect(slugify('Bến  Thành -- Quận 1')).toBe('ben-thanh-quan-1');
    expect(slugify('Kitchen & Daylight / số 2')).toBe('kitchen-daylight-so-2');
    expect(slugify('a___b...c')).toBe('a-b-c');
  });

  it('trims hyphens at both ends', () => {
    expect(slugify('  -- Bến Thành! --  ')).toBe('ben-thanh');
  });

  it('returns the empty string when no letter or digit is left', () => {
    expect(slugify('')).toBe('');
    expect(slugify(' — !!! ')).toBe('');
  });

  it('always returns a value of the slug shape, or the empty string', () => {
    for (const name of ['Chi nhánh Đông', '123', 'x', '  Ẩm thực  Sài Gòn  ']) {
      expect(slugify(name)).toMatch(SLUG_PATTERN);
    }
  });
});
