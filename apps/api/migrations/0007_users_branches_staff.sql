-- 0007_users_branches_staff: branches, users and staff roles (A1-T3; data-model `branches`, `users`,
-- `staff_branches`; ADR-0009 role model). Also adds the foreign keys that 0002 (outbox_events),
-- 0003 (audit_logs) and 0004 (idempotency_keys) left for this migration.
-- Not here: province_code, ward_code and cover_media_id stay plain columns until `provinces`,
-- `wards` (A2-T3) and `media` (A6) exist; the dependent branch tables come with A5-T1.
-- Every choice the data model does not state is a row of docs/decisions/api-divergences.md (D-025
-- to D-030).

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
CREATE TYPE public.branch_status AS ENUM ('ACTIVE', 'TEMPORARILY_CLOSED', 'CLOSED');
COMMENT ON TYPE public.branch_status IS
  'ACTIVE; TEMPORARILY_CLOSED is also the staff "pause orders" switch; CLOSED is set by MANAGER or ADMIN.';

CREATE TYPE public.user_role AS ENUM ('CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN');
COMMENT ON TYPE public.user_role IS 'ADR-0009 role model; ADMIN is the owner.';

CREATE TYPE public.user_status AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DELETED');
COMMENT ON TYPE public.user_status IS
  'INVITED: staff account whose invitation link is unused (no password yet); DELETED: anonymised tombstone.';

-- ---------------------------------------------------------------------------------------------
-- branches. updated_by gets its foreign key below, once `users` exists.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.branches (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  code                          text NOT NULL,
  slug                          text NOT NULL,
  name                          text NOT NULL,
  description                   jsonb,
  address_line                  text NOT NULL,
  province_code                 text NOT NULL,
  ward_code                     text,
  location                      geography(Point, 4326) NOT NULL,
  phone                         public.e164_phone NOT NULL,
  status                        public.branch_status NOT NULL,
  accepts_pickup                boolean NOT NULL,
  accepts_delivery              boolean NOT NULL,
  accepts_reservations          boolean NOT NULL,
  default_prep_minutes          integer NOT NULL,
  order_cutoff_minutes          integer NOT NULL,
  reservation_duration_minutes  integer NOT NULL DEFAULT 90,
  reservation_slot_step_minutes integer NOT NULL,
  reservation_max_party         integer NOT NULL,
  reservation_lead_minutes      integer NOT NULL,
  reservation_max_days_ahead    integer NOT NULL,
  cover_media_id                uuid,
  website_url                   text,
  pause_message                 text,
  sort_order                    integer NOT NULL,
  review_count                  integer NOT NULL DEFAULT 0,
  rating_sum                    integer NOT NULL DEFAULT 0,
  row_version                   integer NOT NULL DEFAULT 1,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid,
  deleted_at                    timestamptz,

  -- The prefix of every order_number: 2 to 4 upper-case letters (for example BT).
  CONSTRAINT branches_code_format CHECK (code ~ '^[A-Z]{2,4}$'),
  CONSTRAINT branches_code_unique UNIQUE (code),
  CONSTRAINT branches_slug_unique UNIQUE (slug),
  -- Translated long text, a `vi` key when set (data-model Conventions, "Translations").
  CONSTRAINT branches_description_vi
    CHECK (description IS NULL OR (jsonb_typeof(description) = 'object' AND description ? 'vi')),
  -- Minutes and counters are never negative (api-divergences D-026).
  CONSTRAINT branches_default_prep_minutes_not_negative CHECK (default_prep_minutes >= 0),
  CONSTRAINT branches_order_cutoff_minutes_not_negative CHECK (order_cutoff_minutes >= 0),
  -- Reservation rules (brief P19, P21).
  CONSTRAINT branches_reservation_duration_range CHECK (
    reservation_duration_minutes BETWEEN 30 AND 240 AND reservation_duration_minutes % 15 = 0
  ),
  CONSTRAINT branches_reservation_slot_step CHECK (reservation_slot_step_minutes IN (15, 30)),
  CONSTRAINT branches_reservation_max_party_positive CHECK (reservation_max_party >= 1),
  CONSTRAINT branches_reservation_lead_range CHECK (reservation_lead_minutes BETWEEN 0 AND 1440),
  CONSTRAINT branches_reservation_days_ahead_range
    CHECK (reservation_max_days_ahead BETWEEN 1 AND 90),
  -- One optional https link of at most 255 characters (brief C28).
  CONSTRAINT branches_website_url_https
    CHECK (website_url IS NULL OR (char_length(website_url) <= 255 AND website_url ~ '^https://')),
  -- The line shown on a paused branch (mobile G11).
  CONSTRAINT branches_pause_message_length
    CHECK (pause_message IS NULL OR char_length(pause_message) <= 200),
  CONSTRAINT branches_review_count_not_negative CHECK (review_count >= 0),
  CONSTRAINT branches_rating_sum_not_negative CHECK (rating_sum >= 0)
);

COMMENT ON TABLE public.branches IS
  'The restaurant''s own locations, placed by hand on a map. Soft-deleted (deleted_at), never deleted by kd_app.';
COMMENT ON COLUMN public.branches.code IS
  'Prefix of every order_number; the API locks it once an order exists (brief C6).';
COMMENT ON COLUMN public.branches.description IS 'Translations, {"vi": ..., "en"?: ...}; null when none.';
COMMENT ON COLUMN public.branches.province_code IS 'Official province code. Foreign key added with `provinces` (A2-T3).';
COMMENT ON COLUMN public.branches.ward_code IS 'Official ward code. Foreign key added with `wards` (A2-T3).';
COMMENT ON COLUMN public.branches.location IS 'Required pin (brief C5); no GiST index at this size (data-model Indexes).';
COMMENT ON COLUMN public.branches.reservation_duration_minutes IS
  'Length of one booking (brief P19); default of reservations.duration_minutes.';
COMMENT ON COLUMN public.branches.reservation_slot_step_minutes IS 'Start-time step, 15 or 30 (brief P19).';
COMMENT ON COLUMN public.branches.cover_media_id IS
  'Kept equal to the branch_media row at position 0 by the API (brief C29). Foreign key added with `media` (A6).';
COMMENT ON COLUMN public.branches.review_count IS
  'Counter changed in the background; does not bump row_version or updated_at.';
COMMENT ON COLUMN public.branches.rating_sum IS
  'Counter changed in the background; does not bump row_version or updated_at.';
COMMENT ON COLUMN public.branches.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';
COMMENT ON COLUMN public.branches.updated_by IS
  'Last editor, for the STALE_VERSION message (brief C10); null for a system change.';

-- Editable columns: every column except id, created_at, the trigger-owned row_version and
-- updated_at, and the background counters review_count and rating_sum (decision 0007 section 8).
-- updated_by is listed so that an edit of a child row (hours, zones, gallery), which touches the
-- parent with updated_by, moves both (brief C10; migrations/README.md).
CREATE TRIGGER branches_row_version
  BEFORE UPDATE OF code, slug, name, description, address_line, province_code, ward_code, location,
    phone, status, accepts_pickup, accepts_delivery, accepts_reservations, default_prep_minutes,
    order_cutoff_minutes, reservation_duration_minutes, reservation_slot_step_minutes,
    reservation_max_party, reservation_lead_minutes, reservation_max_days_ahead, cover_media_id,
    website_url, pause_message, sort_order, updated_by, deleted_at
  ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER branches_updated_at
  BEFORE UPDATE OF code, slug, name, description, address_line, province_code, ward_code, location,
    phone, status, accepts_pickup, accepts_delivery, accepts_reservations, default_prep_minutes,
    order_cutoff_minutes, reservation_duration_minutes, reservation_slot_step_minutes,
    reservation_max_party, reservation_lead_minutes, reservation_max_days_ahead, cover_media_id,
    website_url, pause_message, sort_order, updated_by, deleted_at
  ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- users: one table for customers and staff. No row_version (brief E4).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.users (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  email               public.citext NOT NULL,
  password_hash       text,
  display_name        text NOT NULL,
  phone               public.e164_phone,
  avatar_url          text,
  locale              text NOT NULL,
  role                public.user_role NOT NULL,
  status              public.user_status NOT NULL,
  preferred_branch_id uuid,
  email_verified_at   timestamptz,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- citext: A@x.example and a@x.example are the same account.
  CONSTRAINT users_email_unique UNIQUE (email),
  -- Mobile G95.
  CONSTRAINT users_display_name_length CHECK (char_length(display_name) <= 60),
  CONSTRAINT users_failed_login_count_not_negative CHECK (failed_login_count >= 0),
  -- INVITED is a staff status (data-model users row; api-divergences D-028).
  CONSTRAINT users_invited_is_staff CHECK (status <> 'INVITED' OR role <> 'CUSTOMER'),
  -- A preference, not history: a branch removed by maintenance clears it (api-divergences D-029).
  CONSTRAINT users_preferred_branch_fkey FOREIGN KEY (preferred_branch_id)
    REFERENCES public.branches (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.users IS
  'Customers and staff. Never deleted: anonymised in place (status DELETED); staff who leave are SUSPENDED.';
COMMENT ON COLUMN public.users.email IS 'citext, unique; deleted-{id}@invalid on a tombstone.';
COMMENT ON COLUMN public.users.password_hash IS
  'argon2id PHC string (decision 0008 section 4); null for social-only and INVITED accounts.';
COMMENT ON COLUMN public.users.phone IS
  'E.164; required to order, not verified in the first release (WA10).';
COMMENT ON COLUMN public.users.failed_login_count IS
  'Wrong passwords and wrong second factors (brief E15); lockout schedule in decision 0008 section 4.';
COMMENT ON COLUMN public.users.last_login_at IS
  'Set when a sign-in completes, after the second step for MANAGER and ADMIN (brief E3).';

-- Profile and account columns move updated_at; the sign-in bookkeeping (failed_login_count,
-- locked_until, last_login_at) does not, so a login is not reported as an edit of the person.
CREATE TRIGGER users_updated_at
  BEFORE UPDATE OF email, password_hash, display_name, phone, avatar_url, locale, role, status,
    preferred_branch_id, email_verified_at, deleted_at
  ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- branches.updated_by: users are never deleted, so RESTRICT never fires in normal use.
ALTER TABLE public.branches
  ADD CONSTRAINT branches_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.users (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- staff_branches: which branches a STAFF or MANAGER works at (ADMIN ignores it). Insert and delete
-- only, so no timestamps (api-divergences D-027). "At least one row per STAFF or MANAGER" is an API
-- rule (data-model "Rules enforced in the database").
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.staff_branches (
  user_id   uuid NOT NULL,
  branch_id uuid NOT NULL,

  CONSTRAINT staff_branches_pkey PRIMARY KEY (user_id, branch_id),
  -- A child of the branch (data-model "Rules enforced in the database").
  CONSTRAINT staff_branches_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE,
  -- Users are tombstoned, never deleted (api-divergences D-029).
  CONSTRAINT staff_branches_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.staff_branches IS
  'Branch scope of STAFF and MANAGER; every staff query is filtered by these rows.';

-- Who works where (data-model Indexes).
CREATE INDEX staff_branches_branch_idx ON public.staff_branches (branch_id);

-- ---------------------------------------------------------------------------------------------
-- Foreign keys owed by 0002, 0003 and 0004. RESTRICT: history is never destroyed.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE RESTRICT,
  ADD CONSTRAINT outbox_events_audience_user_fkey FOREIGN KEY (audience_user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_user_fkey FOREIGN KEY (actor_user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT audit_logs_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE RESTRICT;

ALTER TABLE public.idempotency_keys
  ADD CONSTRAINT idempotency_keys_actor_fkey FOREIGN KEY (actor_id)
    REFERENCES public.users (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). The baseline default privileges give SELECT, INSERT, UPDATE;
-- written out here, with DELETE refused where the data model keeps the row.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON TYPE public.branch_status TO kd_app;
GRANT USAGE ON TYPE public.user_role TO kd_app;
GRANT USAGE ON TYPE public.user_status TO kd_app;

-- Branches are soft-deleted (deleted_at); users are anonymised in place.
GRANT SELECT, INSERT, UPDATE ON TABLE public.branches TO kd_app;
REVOKE DELETE, TRUNCATE ON TABLE public.branches FROM kd_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO kd_app;
REVOKE DELETE, TRUNCATE ON TABLE public.users FROM kd_app;

-- A branch assignment is removed when a staff member's branches are edited.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_branches TO kd_app;
