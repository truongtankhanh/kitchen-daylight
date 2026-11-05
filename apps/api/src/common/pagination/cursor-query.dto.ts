import type { CursorQuery } from '@kd/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const DEFAULT_LIMIT = 20;
/**
 * Maximum `limit` of a cursor list not named in decision 0007 section 6. The review lists (100)
 * extend this class and redeclare `limit` with their own rule.
 */
export const MAX_LIMIT = 50;

/**
 * Query of every cursor list (decision 0007 section 6). The cursor is checked by `decodeCursor`,
 * not here, so every bad cursor (too long included) answers `INVALID_CURSOR`.
 */
export class CursorQueryDto implements CursorQuery {
  /** Opaque cursor from a previous page's `nextCursor` or `prevCursor`. */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** Rows per page. */
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}
