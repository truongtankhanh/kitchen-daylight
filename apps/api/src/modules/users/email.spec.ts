import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it.each([
    ['a@kd.example', 'a@kd.example'],
    ['A@KD.Example', 'a@kd.example'],
    ['  Mixed.Case@KD.example\t', 'mixed.case@kd.example'],
    ['\nfixture-user@kd.example \n', 'fixture-user@kd.example'],
  ])('%j becomes %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('keeps inner characters as they are', () => {
    expect(normalizeEmail('first+tag@kd.example')).toBe('first+tag@kd.example');
  });
});
