import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import {
  isReferenceViolation,
  listWindow,
  normalizeNames,
  searchFragment,
  slugForNew,
  tagConstraintError,
  tagInUseError,
  tagNeedsVerification,
  unverifiedCountFor,
} from './tags.service.js';

function violation(fields: { code?: string; constraint?: string }): QueryFailedError {
  const driverError = Object.assign(new Error('violation'), fields);
  return new QueryFailedError('DELETE …', [], driverError);
}

describe('unverifiedCountFor', () => {
  it.each([
    ['DIETARY', 3, 3],
    ['ALLERGEN', 2, 2],
    ['ALLERGEN', 0, 0],
  ] as const)('counts the unverified links of a %s tag', (kind, links, expected) => {
    expect(tagNeedsVerification(kind)).toBe(true);
    expect(unverifiedCountFor(kind, links)).toBe(expected);
  });

  it('is 0 for a LABEL tag, whatever its links (nothing to verify)', () => {
    expect(tagNeedsVerification('LABEL')).toBe(false);
    expect(unverifiedCountFor('LABEL', 7)).toBe(0);
  });
});

describe('listWindow', () => {
  it('reads a page from page and pageSize', () => {
    expect(listWindow({ page: 3, pageSize: 10 })).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
      limit: 10,
    });
  });

  it('in select mode reads the first limit rows as page 1, whatever page says', () => {
    expect(listWindow({ page: 4, pageSize: 50, limit: 5 })).toEqual({
      page: 1,
      pageSize: 5,
      offset: 0,
      limit: 5,
    });
  });
});

describe('searchFragment', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['   ', null],
    [' đậu ', 'đậu'],
    ['50%_off\\', '50\\%\\_off\\\\'],
  ])('maps %j to %j', (q, expected) => {
    expect(searchFragment(q)).toBe(expected);
  });
});

describe('slugForNew', () => {
  it('keeps the slug sent', () => {
    expect(slugForNew('Đậu phộng', 'peanut')).toBe('peanut');
  });

  it('derives it from the Vietnamese name', () => {
    expect(slugForNew('Đậu phộng', undefined)).toBe('dau-phong');
  });

  it('cuts a long name to 60 characters without a trailing hyphen', () => {
    const slug = slugForNew(`${'a'.repeat(59)} b`, undefined);

    expect(slug).toBe('a'.repeat(59));
  });

  it('is null when the name has no letter or digit', () => {
    expect(slugForNew('!!!', undefined)).toBeNull();
  });
});

describe('normalizeNames', () => {
  it('keeps en when it is not blank, and drops it otherwise', () => {
    expect(normalizeNames({ vi: ' Cay ', en: ' Spicy ' })).toEqual({ vi: 'Cay', en: 'Spicy' });
    expect(normalizeNames({ vi: 'Cay', en: '  ' })).toEqual({ vi: 'Cay' });
    expect(normalizeNames({ vi: 'Cay' })).toEqual({ vi: 'Cay' });
  });
});

describe('tagInUseError', () => {
  it('is IN_USE (409) with the usage member', () => {
    const usage = {
      count: 7,
      sample: [{ id: '01900000-0000-7000-8000-000000000001', name: 'Gỏi cuốn' }],
      filter: { tagId: '01900000-0000-7000-8000-0000000000aa' },
    };

    const error = tagInUseError(usage, 'In use.');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('IN_USE');
    expect(error.status).toBe(409);
    expect(error.extras).toEqual({ usage });
  });
});

describe('isReferenceViolation', () => {
  it.each(['23503', '23001'])('is true for SQLSTATE %s', (code) => {
    expect(isReferenceViolation(violation({ code }))).toBe(true);
  });

  it.each([
    ['another SQLSTATE', violation({ code: '23505' })],
    ['a plain error', new Error('boom')],
  ])('is false for %s', (_case, error) => {
    expect(isReferenceViolation(error)).toBe(false);
  });
});

describe('tagConstraintError', () => {
  it('maps the slug unique constraint to ALREADY_EXISTS', () => {
    expect(
      tagConstraintError(violation({ code: '23505', constraint: 'tags_slug_unique' })),
    ).toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('is null for any other error', () => {
    expect(tagConstraintError(violation({ code: '23505', constraint: 'other_key' }))).toBeNull();
    expect(tagConstraintError(new Error('boom'))).toBeNull();
  });
});
