import { describe, expect, it } from 'vitest';

import { roundCoordinate } from './coordinates.js';

describe('roundCoordinate', () => {
  it.each([
    [10.776543, 10.78],
    [106.700981, 106.7],
    [-33.868819, -33.87],
    [21.004, 21],
    [0, 0],
  ])('rounds %f to %f', (input, expected) => {
    expect(roundCoordinate(input)).toBe(expected);
  });

  it('never returns -0', () => {
    expect(Object.is(roundCoordinate(-0.001), 0)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns NaN for the non-finite %f instead of throwing',
    (input) => {
      expect(roundCoordinate(input)).toBeNaN();
    },
  );
});
