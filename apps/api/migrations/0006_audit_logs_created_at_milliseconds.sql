-- 0006_audit_logs_created_at_milliseconds: audit_logs.created_at keeps milliseconds (A0-T13; decision
-- 0007 section 8). It is the sort key of the audit cursor list, (created_at, id), and a cursor
-- carries a JavaScript Date, which holds milliseconds. With microseconds in the column, the next page
-- skipped every row of the boundary millisecond (descending) or repeated the boundary row
-- (ascending). Existing values are rounded to the millisecond; the indexes on the column are rebuilt
-- by the type change. The default now() is rounded on insert by the column's precision.

ALTER TABLE public.audit_logs
  ALTER COLUMN created_at TYPE timestamptz(3);
