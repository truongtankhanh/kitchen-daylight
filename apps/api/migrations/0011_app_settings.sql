-- 0011_app_settings: the brand-wide settings store, one row per key (A4-T1; data-model `app_settings`
-- row of "Privacy, governance and system"; brief L1). No row is written here: a missing key reads as
-- its code default (apps/api/src/modules/settings/settings-defaults.ts) and the seed (A4-T5) writes
-- the default rows as kd_migrator. Choices the data model does not state are rows of
-- docs/decisions/api-divergences.md (D-103 to D-106).

CREATE TABLE public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- The eight keys of the first release (data-model `app_settings`). `reservations` is phase 2 and
  -- arrives with A14 by a new migration that replaces this constraint.
  CONSTRAINT app_settings_key_known CHECK (
    key IN ('brand', 'reports', 'min_app_version', 'maintenance', 'feature_flags', 'payment',
            'ordering', 'loyalty')
  ),
  -- Every key holds one JSON object; its fields are validated by the API (api-divergences D-103).
  CONSTRAINT app_settings_value_object CHECK (jsonb_typeof(value) = 'object'),
  -- RESTRICT: the last editor of a key is never destroyed (users are anonymised, never deleted).
  CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.app_settings IS
  'Brand-wide settings, one row per key, edited by ADMIN. A missing row reads as the code default.';
COMMENT ON COLUMN public.app_settings.key IS 'Storage key, snake_case (data-model `app_settings`).';
COMMENT ON COLUMN public.app_settings.value IS
  'One JSON object with the snake_case field names of data-model; the API maps it to camelCase.';
COMMENT ON COLUMN public.app_settings.row_version IS
  'Optimistic concurrency per key, set by trigger (brief L1; decision 0007 section 8).';
COMMENT ON COLUMN public.app_settings.updated_by IS
  'Last editor, for the STALE_VERSION answer (brief L1); null for a row written by the seed.';

-- Both editable columns move the version and the time: a save always sets value and updated_by.
CREATE TRIGGER app_settings_row_version
  BEFORE UPDATE OF value, updated_by ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE OF value, updated_by ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). The baseline default privileges give SELECT, INSERT, UPDATE;
-- they are written here explicitly, and a key is never deleted by the application.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_settings TO kd_app;
REVOKE DELETE, TRUNCATE ON TABLE public.app_settings FROM kd_app;
