import { describe, expect, it } from 'vitest';

import { compareAppVersions, isBelowMinimum, parseAppVersion } from './semver.js';

function compare(a: string, b: string): number {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);
  if (left === null || right === null) {
    throw new Error('fixture is not a version');
  }
  return Math.sign(compareAppVersions(left, right));
}

describe('parseAppVersion', () => {
  it('reads the three parts', () => {
    expect(parseAppVersion('1.10.3')).toEqual({ major: 1, minor: 10, patch: 3 });
    expect(parseAppVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it.each([
    ['two parts', '1.2'],
    ['four parts', '1.2.3.4'],
    ['a leading zero', '01.2.3'],
    ['a pre-release', '1.2.3-beta'],
    ['a v prefix', 'v1.2.3'],
    ['letters', 'a.b.c'],
    ['an empty string', ''],
    ['a long value', `1.2.${'3'.repeat(40)}`],
    ['seven digits', '1234567.0.0'],
  ])('refuses %s', (_case, value) => {
    expect(parseAppVersion(value)).toBeNull();
  });

  it.each([undefined, null, 1, ['1.2.3']])('refuses a non-string %j', (value) => {
    expect(parseAppVersion(value)).toBeNull();
  });
});

describe('compareAppVersions', () => {
  it.each([
    ['1.2.3', '1.2.3', 0],
    ['1.2.2', '1.2.3', -1],
    ['1.3.0', '1.2.9', 1],
    ['2.0.0', '1.99.99', 1],
    ['1.10.0', '1.9.0', 1],
    ['1.9.0', '1.10.0', -1],
  ])('compares %s with %s numerically', (a, b, expected) => {
    expect(compare(a, b)).toBe(expected);
  });
});

describe('isBelowMinimum', () => {
  it('is true only for a lower version', () => {
    expect(isBelowMinimum('1.2.2', '1.2.3')).toBe(true);
    expect(isBelowMinimum('1.2.3', '1.2.3')).toBe(false);
    expect(isBelowMinimum('1.10.0', '1.9.0')).toBe(false);
  });

  it('never treats a malformed side as below', () => {
    expect(isBelowMinimum('garbage', '9.9.9')).toBe(false);
    expect(isBelowMinimum(undefined, '9.9.9')).toBe(false);
    expect(isBelowMinimum('1.0.0', 'bad')).toBe(false);
  });
});
