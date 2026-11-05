-- 0001_database_helpers: shared functions and domains that later table migrations use (A0-T5).
-- No table, no index, no extension: `unaccent` and the other extensions come from the database
-- provisioning and are checked by the preflight (decision 0005 section 7; Docker decision 0004
-- section 4). Runs as kd_migrator, which owns every object below.

-- ---------------------------------------------------------------------------------------------
-- kd_unaccent(text): an immutable wrapper of unaccent, for index expressions.
--
-- Why IMMUTABLE is declared:
-- - The extension declares both forms of `unaccent` STABLE (`LANGUAGE C STABLE STRICT PARALLEL
--   SAFE`, contrib/unaccent/unaccent--1.1.sql, REL_18_STABLE), and CREATE INDEX accepts only
--   functions that are "immutable" (PostgreSQL 18, CREATE INDEX: "To use a user-defined function
--   in an index expression or WHERE clause, remember to mark the function immutable").
-- - The one-argument form looks the dictionary up "in the same schema as the unaccent() function
--   itself" (PostgreSQL 18, F.48 unaccent). The wrapper calls the two-argument form with the
--   dictionary written schema-qualified, and the SQL-standard body (RETURN) binds both names when
--   the function is created, so neither result depends on search_path.
-- - What remains outside the arguments is the rules file, read from `$SHAREDIR/tsearch_data/`
--   (F.48): `RULES='unaccent'`, the file shipped with the server. Labelling the wrapper IMMUTABLE
--   is a promise that this file does not change under an index (PostgreSQL 18, 36.7 Function
--   Volatility Categories). After a major upgrade or any change to `unaccent.rules`, REINDEX every
--   index built on kd_unaccent.
-- Used by A7-T3 (trigram index on menu item names) and the deferred customer search (brief H2).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kd_unaccent(input text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
RETURN public.unaccent('public.unaccent'::regdictionary, input);

COMMENT ON FUNCTION public.kd_unaccent(text) IS
  'Immutable wrapper of public.unaccent with the public.unaccent dictionary, for index expressions. '
  'REINDEX indexes that use it after a change to unaccent.rules or a major upgrade.';

-- ---------------------------------------------------------------------------------------------
-- Row triggers attached by each table's migration, BEFORE UPDATE OF <editable columns>
-- (decision 0007 section 8). They refuse any other attachment, so a wrong CREATE TRIGGER fails
-- at its first use instead of silently doing nothing.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kd_set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'kd_set_updated_at must be a BEFORE UPDATE row trigger (table %)', TG_TABLE_NAME;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.kd_set_updated_at() IS
  'BEFORE UPDATE row trigger: sets updated_at to now() (the transaction time).';

CREATE OR REPLACE FUNCTION public.kd_bump_row_version()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'kd_bump_row_version must be a BEFORE UPDATE row trigger (table %)', TG_TABLE_NAME;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.kd_bump_row_version() IS
  'BEFORE UPDATE OF <editable columns> row trigger: row_version = OLD.row_version + 1, whatever '
  'the statement set. Columns changed in the background are left out of the column list.';

-- ---------------------------------------------------------------------------------------------
-- Domains. CREATE DOMAIN has no IF NOT EXISTS or OR REPLACE form.
-- ---------------------------------------------------------------------------------------------

-- E.164 (data-model Conventions, "Text"). The stricter Vietnamese mobile rule for customer
-- phones stays in the API; a branch phone may be a landline.
CREATE DOMAIN public.e164_phone AS text
  CONSTRAINT e164_phone_format CHECK (VALUE ~ '^\+[1-9][0-9]{1,14}$');

COMMENT ON DOMAIN public.e164_phone IS
  'Phone number in E.164 form: +, a non-zero digit, then 1 to 14 digits.';

-- Money (data-model Conventions, "Money"; decision 0007 section 8): integer VND, never negative.
-- A column with a stricter rule (price_override > 0) adds its own CHECK.
CREATE DOMAIN public.vnd AS integer
  CONSTRAINT vnd_not_negative CHECK (VALUE >= 0);

COMMENT ON DOMAIN public.vnd IS
  'Amount in whole VND, 0 to 2147483647. Aggregates (SUM is bigint) go through the API safe-integer helper.';

-- ---------------------------------------------------------------------------------------------
-- Grants. The Docker baseline gives kd_app SELECT, INSERT, UPDATE on tables and USAGE on
-- sequences only (Docker decision 0004 section 2, file 4), so functions and domains are granted
-- here explicitly.
-- ---------------------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.kd_unaccent(text) TO kd_app;
GRANT EXECUTE ON FUNCTION public.kd_set_updated_at() TO kd_app;
GRANT EXECUTE ON FUNCTION public.kd_bump_row_version() TO kd_app;
GRANT USAGE ON DOMAIN public.e164_phone TO kd_app;
GRANT USAGE ON DOMAIN public.vnd TO kd_app;
