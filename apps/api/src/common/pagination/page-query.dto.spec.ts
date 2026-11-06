import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import { createValidationPipe } from '../errors/validation.pipe.js';
import { MAX_PAGE, PageQueryDto, toOffset } from './page-query.dto.js';

const QUERY: ArgumentMetadata = { type: 'query', metatype: PageQueryDto };

async function parse(query: Record<string, string>): Promise<PageQueryDto> {
  return (await createValidationPipe().transform(query, QUERY)) as PageQueryDto;
}

async function fieldCodes(query: Record<string, string>): Promise<unknown> {
  try {
    await parse(query);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).errors;
  }
  throw new Error('expected a validation error');
}

describe('PageQueryDto', () => {
  it('defaults to page 1 of 20', async () => {
    const query = await parse({});
    expect(query).toBeInstanceOf(PageQueryDto);
    expect(query).toEqual({ page: 1, pageSize: 20 });
  });

  it('converts the query strings to integers', async () => {
    expect(await parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(await parse({ pageSize: '1' })).toEqual({ page: 1, pageSize: 1 });
    expect(await parse({ page: String(MAX_PAGE) })).toEqual({ page: MAX_PAGE, pageSize: 20 });
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '-1' }, 'page'],
    [{ page: String(MAX_PAGE + 1) }, 'page'],
    [{ page: '1e300' }, 'page'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ pageSize: '51' }, 'pageSize'],
  ])('rejects %j with OUT_OF_RANGE', async (query, field) => {
    expect(await fieldCodes(query)).toEqual([
      { field, code: 'OUT_OF_RANGE', message: 'is out of range' },
    ]);
  });

  it('rejects a page that is not an integer', async () => {
    expect(await fieldCodes({ page: '1.5' })).toEqual([
      { field: 'page', code: 'INVALID', message: 'is invalid' },
    ]);
  });
});

describe('toOffset', () => {
  it('turns a page into OFFSET and LIMIT', () => {
    expect(toOffset({ page: 1, pageSize: 20 })).toEqual({ offset: 0, limit: 20 });
    expect(toOffset({ page: 3, pageSize: 50 })).toEqual({ offset: 100, limit: 50 });
  });
});
