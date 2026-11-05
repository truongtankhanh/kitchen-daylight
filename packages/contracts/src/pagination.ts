// List paging shapes (api-outline, Conventions, "Pagination"; decision 0007 section 6).

/** Query of an offset list: `page` from 1 (default 1), `pageSize` 1 to the list's maximum (default 20). */
export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/** Body of an offset list. A page past the end has `items: []` and the real `total`. */
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Query of a cursor list: `limit` 1 to the list's maximum (default 20), `cursor` from a previous
 * page's `nextCursor` or `prevCursor`. The cursor is opaque to clients.
 */
export interface CursorQuery {
  cursor?: string;
  limit?: number;
}

/** A bounded count: `value` is at most the cap (1000), `capped` is true when more rows exist. */
export interface EstimatedTotal {
  value: number;
  capped: boolean;
}

/** Body of a cursor list. `nextCursor` and `prevCursor` are `null` at the ends. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  estimatedTotal: EstimatedTotal;
}
