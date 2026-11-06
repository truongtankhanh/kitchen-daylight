import type { PageQuery } from '@kd/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
/**
 * Maximum `pageSize` of a list not named in decision 0007 section 6. A list with another maximum
 * (reviews 100, selects 20) extends this class and redeclares `pageSize` with its own `@Max`.
 */
export const MAX_PAGE_SIZE = 50;
/**
 * Highest `page` of an offset list (decision 0007 section 6). Keeps `OFFSET` a small safe integer:
 * without it `?page=1e300` passes `@IsInt` and fails in PostgreSQL as a 500. A list deeper than
 * this is a cursor list.
 */
export const MAX_PAGE = 10_000;

/**
 * Query of every offset list (decision 0007 section 6). A list's query DTO extends it, so the
 * Swagger plugin documents `page` and `pageSize` on each list. Out of range → `400
 * VALIDATION_FAILED` with `OUT_OF_RANGE` (the global validation pipe).
 */
export class PageQueryDto implements PageQuery {
  /** Page number, from 1. */
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = DEFAULT_PAGE;

  /** Rows per page. */
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}

/** `OFFSET` and `LIMIT` of a validated page query. */
export function toOffset(query: Required<PageQuery>): { offset: number; limit: number } {
  return { offset: (query.page - 1) * query.pageSize, limit: query.pageSize };
}
