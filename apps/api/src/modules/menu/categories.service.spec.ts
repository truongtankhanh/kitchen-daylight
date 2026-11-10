import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import {
  categoryConstraintError,
  categoryInUseError,
  isCategoryIconKey,
  isPermutationOf,
  nextSortOrder,
} from './categories.service.js';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const C = '01900000-0000-7000-8000-00000000000c';
const D = '01900000-0000-7000-8000-00000000000d';

function violation(fields: { code?: string; constraint?: string }): QueryFailedError {
  const driverError = Object.assign(new Error('violation'), fields);
  return new QueryFailedError('INSERT …', [], driverError);
}

describe('isPermutationOf', () => {
  it.each([
    ['the same order', [A, B, C]],
    ['another order', [C, A, B]],
    ['upper-case ids', [B.toUpperCase(), A, C]],
  ])('accepts %s', (_case, ids) => {
    expect(isPermutationOf(ids, [A, B, C])).toBe(true);
  });

  it('accepts two empty lists', () => {
    expect(isPermutationOf([], [])).toBe(true);
  });

  it.each([
    ['a missing id', [A, B]],
    ['an extra id', [A, B, C, D]],
    ['an unknown id in place of one', [A, B, D]],
    ['a repeated id', [A, B, B]],
    ['a repeated id in other case', [A, B, B.toUpperCase()]],
  ])('refuses %s', (_case, ids) => {
    expect(isPermutationOf(ids, [A, B, C])).toBe(false);
  });
});

describe('isCategoryIconKey', () => {
  it.each(['noodle', 'rice-bowl', 'drink2', 'a', 'x'.repeat(40), '-'])('accepts %j', (key) => {
    expect(isCategoryIconKey(key)).toBe(true);
  });

  it.each([
    ['upper case', 'Noodle'],
    ['a space', 'rice bowl'],
    ['an underscore', 'rice_bowl'],
    ['a diacritic', 'phở'],
    ['empty', ''],
    ['41 characters', 'x'.repeat(41)],
    ['not a string', 1],
    ['null', null],
  ])('refuses %s', (_case, key) => {
    expect(isCategoryIconKey(key)).toBe(false);
  });
});

describe('nextSortOrder', () => {
  it('is 1 for the first category and one after the last otherwise', () => {
    expect(nextSortOrder(null)).toBe(1);
    expect(nextSortOrder(7)).toBe(8);
  });
});

describe('categoryInUseError', () => {
  it('is IN_USE (409) with the usage member', () => {
    const usage = { count: 3, sample: [{ id: A, name: 'Phở bò' }], filter: { categoryId: B } };

    const error = categoryInUseError(usage);

    expect(error.code).toBe('IN_USE');
    expect(error.status).toBe(409);
    expect(error.extras).toEqual({ usage });
  });
});

describe('categoryConstraintError', () => {
  it('maps the slug unique constraint to ALREADY_EXISTS', () => {
    expect(
      categoryConstraintError(
        violation({ code: '23505', constraint: 'menu_categories_slug_unique' }),
      ),
    ).toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('is null for any other error', () => {
    expect(categoryConstraintError(violation({ code: '23505', constraint: 'x' }))).toBeNull();
    expect(categoryConstraintError(new Error('boom'))).toBeNull();
  });
});
