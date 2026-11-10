import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../common/errors/api-error.js';
import { createValidationPipe } from '../../../common/errors/validation.pipe.js';
import { AdminCategoryCreateDto, AdminCategoryUpdateDto } from './category.dto.js';

const CREATE: ArgumentMetadata = { type: 'body', metatype: AdminCategoryCreateDto };
const UPDATE: ArgumentMetadata = { type: 'body', metatype: AdminCategoryUpdateDto };

async function errorsOf(
  body: Record<string, unknown>,
  metadata: ArgumentMetadata,
): Promise<{ field: string; code: string }[]> {
  try {
    await createValidationPipe().transform(body, metadata);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return ((error as ApiError).errors ?? []).map(({ field, code }) => ({ field, code }));
  }
}

const CREATE_BODY = { names: { vi: 'Món chính' }, isActive: true };

describe('AdminCategoryCreateDto icon', () => {
  it.each([
    ['absent', {}],
    ['null', { icon: null }],
    ['a key', { icon: 'rice-bowl' }],
  ])('accepts %s', async (_case, extra) => {
    expect(await errorsOf({ ...CREATE_BODY, ...extra }, CREATE)).toEqual([]);
  });

  it.each([
    ['upper case', 'Rice'],
    ['a space', 'rice bowl'],
    ['empty', ''],
    ['41 characters', 'x'.repeat(41)],
    ['a number', 5],
  ])('refuses %s with INVALID on icon', async (_case, icon) => {
    expect(await errorsOf({ ...CREATE_BODY, icon }, CREATE)).toEqual([
      { field: 'icon', code: 'INVALID' },
    ]);
  });
});

describe('AdminCategoryUpdateDto', () => {
  it('accepts icon null (clears it) and refuses an icon of the wrong shape', async () => {
    expect(await errorsOf({ rowVersion: 1, icon: null }, UPDATE)).toEqual([]);
    expect(await errorsOf({ rowVersion: 1, icon: 'Phở' }, UPDATE)).toEqual([
      { field: 'icon', code: 'INVALID' },
    ]);
  });

  it('refuses a slug: it is immutable', async () => {
    expect(await errorsOf({ rowVersion: 1, slug: 'mon-chinh' }, UPDATE)).toEqual([
      { field: 'slug', code: 'INVALID' },
    ]);
  });

  it('refuses isActive null and a sortOrder of 0', async () => {
    expect(await errorsOf({ rowVersion: 1, isActive: null, sortOrder: 0 }, UPDATE)).toEqual(
      expect.arrayContaining([
        { field: 'isActive', code: 'INVALID' },
        { field: 'sortOrder', code: 'OUT_OF_RANGE' },
      ]),
    );
  });
});
