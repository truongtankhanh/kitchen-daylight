-- 0013_branch_details: the dependent tables of a branch (A5-T1; data-model "Branches" rows
-- `branch_opening_periods`, `branch_special_hours`, `delivery_zones`, `amenities`,
-- `branch_amenities`; "Rules enforced in the database"; "Indexes" row `delivery_zones`).
-- Not here: `branch_media` and the `media` foreign key of `branches.cover_media_id` (A6),
-- `restaurant_tables` (A14), `orders.delivery_zone_id` (A8-T2, RESTRICT), the amenity seed (A6-T5).
-- The `wards (province_code)` index exists since 0009.
-- Every choice the data model does not state is a row of docs/decisions/api-divergences.md
-- (D-128, D-129).

-- ---------------------------------------------------------------------------------------------
-- branches: compared column by column with the data-model `branches` row. 0007 already created
-- every column (pause_message, website_url, updated_by, the reservation_* columns and their
-- CHECKs, cover_media_id, sort_order, review_count, rating_sum, deleted_at), so no ALTER TABLE is
-- needed here. cover_media_id stays a plain uuid until `media` exists (A6-T4).
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
CREATE TYPE public.branch_service AS ENUM ('STORE', 'DELIVERY');
COMMENT ON TYPE public.branch_service IS
  'Which hours a row sets: STORE (also pickup and reservations) or DELIVERY (optional, follows STORE when absent).';

-- ---------------------------------------------------------------------------------------------
-- branch_opening_periods: one row per weekly period (a day with a lunch and a dinner shift has
-- two). Replaced as a whole list by the API, so no timestamps: the parent branch's updated_at and
-- updated_by record the edit (brief C10; D-129). Overlaps are checked by the API (brief C15).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.branch_opening_periods (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  branch_id       uuid NOT NULL,
  service         public.branch_service NOT NULL,
  day_of_week     integer NOT NULL,
  open_time       time NOT NULL,
  close_time      time NOT NULL,
  closes_next_day boolean NOT NULL,

  -- ISO day, Monday = 1.
  CONSTRAINT branch_opening_periods_day_of_week_range CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT branch_opening_periods_open_close_differ CHECK (open_time <> close_time),
  -- A period that ends at or before its start ends on the next day.
  CONSTRAINT branch_opening_periods_closes_next_day
    CHECK (closes_next_day = (close_time <= open_time)),
  -- A child of the branch (data-model "Rules enforced in the database").
  CONSTRAINT branch_opening_periods_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.branch_opening_periods IS
  'Weekly opening periods per branch and service; replaced as a whole list by the API.';
COMMENT ON COLUMN public.branch_opening_periods.day_of_week IS '1 to 7, Monday = 1.';
COMMENT ON COLUMN public.branch_opening_periods.close_time IS
  'At or before open_time when the period ends on the next day (closes_next_day).';

CREATE INDEX branch_opening_periods_branch_service_day_idx
  ON public.branch_opening_periods (branch_id, service, day_of_week);

-- ---------------------------------------------------------------------------------------------
-- branch_special_hours: holidays and one-off changes that override the weekly periods for the
-- dates covered. Replaced as a whole list, so no timestamps (D-129). Date ranges of one branch and
-- service must not overlap: checked by the API (brief C14). The date and open-day CHECKs are not
-- in the data model (D-128).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.branch_special_hours (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  branch_id       uuid NOT NULL,
  service         public.branch_service NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  is_closed       boolean NOT NULL,
  open_time       time,
  close_time      time,
  closes_next_day boolean,
  note            text,
  display_note    text,

  CONSTRAINT branch_special_hours_date_range CHECK (ends_on >= starts_on),
  -- A closed day has no times; an open day has all three (D-128).
  CONSTRAINT branch_special_hours_times_when_open CHECK (
    (is_closed AND open_time IS NULL AND close_time IS NULL AND closes_next_day IS NULL)
    OR (NOT is_closed AND open_time IS NOT NULL AND close_time IS NOT NULL
        AND closes_next_day IS NOT NULL)
  ),
  -- The weekly period shape, for an open day (D-128).
  CONSTRAINT branch_special_hours_open_close_differ CHECK (open_time <> close_time),
  CONSTRAINT branch_special_hours_closes_next_day
    CHECK (closes_next_day = (close_time <= open_time)),
  CONSTRAINT branch_special_hours_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.branch_special_hours IS
  'Date ranges that override the weekly periods (Tết, one-off changes); a closed store day closes delivery too (brief C12).';
COMMENT ON COLUMN public.branch_special_hours.note IS 'Internal; never shown to customers (brief C13).';
COMMENT ON COLUMN public.branch_special_hours.display_note IS
  'Customer-facing plain Vietnamese text, for example "Nghỉ Tết"; null shows only "special schedule" (mobile G12).';

CREATE INDEX branch_special_hours_branch_service_starts_idx
  ON public.branch_special_hours (branch_id, service, starts_on);

-- ---------------------------------------------------------------------------------------------
-- delivery_zones: concentric rings by straight-line distance from the branch; the smallest active
-- ring containing the address wins (WA2). Money columns use the `vnd` domain of 0001 (it rejects a
-- negative amount first); the data-model CHECKs are written as well.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.delivery_zones (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  branch_id   uuid NOT NULL,
  name        text NOT NULL,
  radius_m    integer NOT NULL,
  fee         public.vnd NOT NULL,
  min_order   public.vnd NOT NULL,
  free_over   public.vnd,
  eta_minutes integer NOT NULL,
  is_active   boolean NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_zones_fee_not_negative CHECK (fee >= 0),
  CONSTRAINT delivery_zones_radius_positive CHECK (radius_m > 0),
  -- Brief C20.
  CONSTRAINT delivery_zones_min_order_not_negative CHECK (min_order >= 0),
  CONSTRAINT delivery_zones_free_over_above_min_order
    CHECK (free_over IS NULL OR free_over > min_order),
  CONSTRAINT delivery_zones_eta_positive CHECK (eta_minutes > 0),
  CONSTRAINT delivery_zones_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.delivery_zones IS
  'Delivery rings per branch. "Stop using" is is_active = false; a zone with orders cannot be deleted (orders.delivery_zone_id RESTRICT, A8-T2).';
COMMENT ON COLUMN public.delivery_zones.radius_m IS 'Straight-line radius in metres from branches.location.';
COMMENT ON COLUMN public.delivery_zones.free_over IS
  'Free delivery when the order subtotal before discount reaches it; null when never free.';
COMMENT ON COLUMN public.delivery_zones.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';

-- One answer for the smallest ring among active zones (brief C19; data-model "Indexes").
CREATE UNIQUE INDEX delivery_zones_branch_radius_active_key
  ON public.delivery_zones (branch_id, radius_m) WHERE is_active;

-- Editable columns: every column except id, created_at and the trigger-owned row_version and
-- updated_at (decision 0007 section 8).
CREATE TRIGGER delivery_zones_row_version
  BEFORE UPDATE OF branch_id, name, radius_m, fee, min_order, free_over, eta_minutes, is_active
  ON public.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER delivery_zones_updated_at
  BEFORE UPDATE OF branch_id, name, radius_m, fee, min_order, free_over, eta_minutes, is_active
  ON public.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- amenities: an admin-managed vocabulary (wifi, parking, ...). `icon` is one key of a fixed list
-- checked by the API, not by a CHECK, so the list can grow (brief B32).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.amenities (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  code        text NOT NULL,
  names       jsonb NOT NULL,
  icon        text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amenities_code_unique UNIQUE (code),
  -- Short label with a required `vi` key (data-model Conventions, "Translations").
  CONSTRAINT amenities_names_vi CHECK (names ? 'vi'),
  -- `?` also matches an array element (`'["vi"]'`), so the shape is checked as for
  -- branches.description (D-026, D-129).
  CONSTRAINT amenities_names_object CHECK (jsonb_typeof(names) = 'object')
);

COMMENT ON TABLE public.amenities IS
  'Amenities shown on the branch page; one that a branch uses cannot be deleted (IN_USE, brief B24).';
COMMENT ON COLUMN public.amenities.icon IS 'One key of the fixed icon list, checked by the API (brief B32).';
COMMENT ON COLUMN public.amenities.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';

CREATE TRIGGER amenities_row_version
  BEFORE UPDATE OF code, names, icon
  ON public.amenities
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER amenities_updated_at
  BEFORE UPDATE OF code, names, icon
  ON public.amenities
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- branch_amenities: which amenities a branch shows. Replaced as a whole list, so no timestamps
-- (D-129, as staff_branches D-027).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.branch_amenities (
  branch_id  uuid NOT NULL,
  amenity_id uuid NOT NULL,

  CONSTRAINT branch_amenities_pkey PRIMARY KEY (branch_id, amenity_id),
  CONSTRAINT branch_amenities_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE,
  -- An amenity in use cannot be deleted (brief B24; data-model "Rules enforced in the database").
  CONSTRAINT branch_amenities_amenity_fkey FOREIGN KEY (amenity_id)
    REFERENCES public.amenities (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.branch_amenities IS 'Amenities a branch shows; replaced as a whole list by the API.';

-- The RESTRICT check and "which branches use this amenity".
CREATE INDEX branch_amenities_amenity_idx ON public.branch_amenities (amenity_id);

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). The baseline default privileges give SELECT, INSERT, UPDATE;
-- DELETE is granted here because the API replaces periods, special days and amenity links as
-- whole lists and deletes zones and amenities. No sequence: every key is a uuid.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON TYPE public.branch_service TO kd_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_opening_periods TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_special_hours TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.delivery_zones TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.amenities TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_amenities TO kd_app;
