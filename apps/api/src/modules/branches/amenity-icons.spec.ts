import { describe, expect, it } from 'vitest';

import { AMENITY_ICONS, isAmenityIcon } from './amenity-icons.js';

describe('AMENITY_ICONS', () => {
  it('holds the eight keys of brief B32, once each', () => {
    expect([...AMENITY_ICONS]).toEqual([
      'wifi',
      'car',
      'snow',
      'tree',
      'door',
      'child',
      'wheelchair',
      'box',
    ]);
    expect(new Set(AMENITY_ICONS).size).toBe(AMENITY_ICONS.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(AMENITY_ICONS)).toBe(true);
  });
});

describe('isAmenityIcon', () => {
  it.each(AMENITY_ICONS)('accepts %s', (icon) => {
    expect(isAmenityIcon(icon)).toBe(true);
  });

  it.each([['pool'], ['WIFI'], [' wifi'], [''], [null], [1]])('refuses %j', (value) => {
    expect(isAmenityIcon(value)).toBe(false);
  });
});
