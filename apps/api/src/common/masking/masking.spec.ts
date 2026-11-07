import { describe, expect, it } from 'vitest';

import { maskEmail, maskPhone } from './masking.js';

// Fictional contact values only.

describe('maskEmail', () => {
  it.each([
    ['nguyen.van.a@kd.example', 'n***@kd.example'],
    ['a@kd.example', 'a***@kd.example'],
    ['ánh@kd.example', 'á***@kd.example'],
    ['first+tag@sub.kd.example', 'f***@sub.kd.example'],
  ])('%s → %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it('hides the length of the local part', () => {
    expect(maskEmail('ab@kd.example')).toHaveLength('a***@kd.example'.length);
    expect(maskEmail('abcdefghij@kd.example')).toHaveLength('a***@kd.example'.length);
  });

  it.each(['', 'no-at-sign', '@kd.example', 'local@'])('masks %j entirely', (value) => {
    expect(maskEmail(value)).toBe('***');
  });

  it('keeps null', () => {
    expect(maskEmail(null)).toBeNull();
  });

  it('never returns the local part beyond its first character', () => {
    expect(maskEmail('secretname@kd.example')).not.toContain('ecretname');
  });
});

describe('maskPhone', () => {
  it.each([
    ['+84901234567', '+84******567'],
    ['+84300000001', '+84******001'],
    ['+6591234567', '+*******567'],
    ['+123', '+***'],
    ['0901234567', '*******567'],
  ])('%s → %s', (phone, masked) => {
    expect(maskPhone(phone)).toBe(masked);
  });

  it('keeps the length and shows only the last three digits', () => {
    const masked = maskPhone('+84912345678') ?? '';

    expect(masked).toHaveLength('+84912345678'.length);
    expect(masked.replace(/\*/gu, '')).toBe('+84678');
  });

  it('keeps null', () => {
    expect(maskPhone(null)).toBeNull();
  });
});
