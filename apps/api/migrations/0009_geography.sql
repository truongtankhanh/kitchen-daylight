-- 0009_geography: provinces and wards (A2-T3; data-model "Geography" and "Indexes" row
-- `wards (province_code)`; ADR-0008 rows 17 and 18), and the foreign keys that 0007 left on
-- `branches.province_code` and `branches.ward_code`.
-- No effective dates: rows are updated in place when the official list changes (ADR-0008 #17).
-- The rows come from `seed reference` (tools/seed), which writes as kd_migrator; kd_app only reads.
-- Every choice the data model does not state is a row of docs/decisions/api-divergences.md
-- (D-055 to D-057).

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
CREATE TYPE public.province_type AS ENUM ('CITY', 'PROVINCE');
COMMENT ON TYPE public.province_type IS 'CITY: centrally governed city (Thành phố Trung ương); PROVINCE: Tỉnh.';

CREATE TYPE public.ward_type AS ENUM ('WARD', 'COMMUNE', 'SPECIAL_ZONE');
COMMENT ON TYPE public.ward_type IS 'WARD: Phường; COMMUNE: Xã; SPECIAL_ZONE: Đặc khu.';

-- ---------------------------------------------------------------------------------------------
-- provinces
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.provinces (
  code  text PRIMARY KEY,
  names jsonb NOT NULL,
  type  public.province_type NOT NULL,

  -- `vi` is required; `vi_full` (the official full name) is a documented key (ADR-0008 #17).
  CONSTRAINT provinces_names_vi CHECK (names ? 'vi')
);

COMMENT ON TABLE public.provinces IS
  'Official provincial units (34 since 1 July 2025), loaded by seed reference and updated in place.';
COMMENT ON COLUMN public.provinces.code IS 'Official code, 2 digits, as text.';
COMMENT ON COLUMN public.provinces.names IS
  'vi: short name without the type prefix; vi_full: official full name.';

-- ---------------------------------------------------------------------------------------------
-- wards. No district level (abolished 1 July 2025).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.wards (
  code          text PRIMARY KEY,
  province_code text NOT NULL,
  names         jsonb NOT NULL,
  type          public.ward_type NOT NULL,

  CONSTRAINT wards_names_vi CHECK (names ? 'vi'),
  -- The target of the composite foreign keys that tie a ward to its province.
  CONSTRAINT wards_code_province_unique UNIQUE (code, province_code),
  CONSTRAINT wards_province_fkey FOREIGN KEY (province_code)
    REFERENCES public.provinces (code) ON DELETE RESTRICT
);

COMMENT ON TABLE public.wards IS
  'Official commune-level units (wards, communes, special zones), loaded by seed reference and updated in place.';
COMMENT ON COLUMN public.wards.code IS 'Official code, 5 digits, as text; unique across the country.';
COMMENT ON COLUMN public.wards.names IS
  'vi: short name without the type prefix; vi_full: official full name.';

-- Ward lists and searches inside one province (data-model "Indexes", brief C7).
CREATE INDEX wards_province_code_idx ON public.wards (province_code);

-- ---------------------------------------------------------------------------------------------
-- branches: the foreign keys 0007 left as plain columns. The ward key is composite, so a ward must
-- belong to the branch's province; MATCH SIMPLE skips it while ward_code is null.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.branches
  ADD CONSTRAINT branches_province_fkey FOREIGN KEY (province_code)
    REFERENCES public.provinces (code) ON DELETE RESTRICT,
  ADD CONSTRAINT branches_ward_fkey FOREIGN KEY (ward_code, province_code)
    REFERENCES public.wards (code, province_code) ON DELETE RESTRICT;

COMMENT ON COLUMN public.branches.province_code IS 'Official province code (→ provinces).';
COMMENT ON COLUMN public.branches.ward_code IS
  'Official ward code (→ wards, together with province_code); null when unknown.';

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). The baseline default privileges give SELECT, INSERT, UPDATE;
-- reference data is read only for kd_app, so everything else is revoked first.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON TYPE public.province_type TO kd_app;
GRANT USAGE ON TYPE public.ward_type TO kd_app;

REVOKE ALL ON TABLE public.provinces FROM kd_app;
GRANT SELECT ON TABLE public.provinces TO kd_app;
REVOKE ALL ON TABLE public.wards FROM kd_app;
GRANT SELECT ON TABLE public.wards TO kd_app;
