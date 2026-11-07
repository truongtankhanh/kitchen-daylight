-- 0010_customer_addresses: the customer's delivery address book (A2-T5; data-model
-- `customer_addresses` row, "Indexes" row for addresses, "Rules enforced in the database"; mobile
-- G46). Soft-deleted (deleted_at), never deleted by kd_app. Anonymising addresses on account
-- deletion is A11-T4. Every choice the data model does not state is a row of
-- docs/decisions/api-divergences.md (D-063 to D-067).

-- ---------------------------------------------------------------------------------------------
-- customer_addresses. No row_version: the data model lists none for this table.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.customer_addresses (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid NOT NULL,
  label          text NOT NULL,
  recipient_name text NOT NULL,
  phone          public.e164_phone NOT NULL,
  address_line   text NOT NULL,
  province_code  text NOT NULL,
  ward_code      text,
  location       geography(Point, 4326) NOT NULL,
  note           text,
  is_default     boolean NOT NULL DEFAULT false,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Provisional lengths the documents do not state (api-divergences D-063).
  CONSTRAINT customer_addresses_label_length CHECK (char_length(label) BETWEEN 1 AND 40),
  CONSTRAINT customer_addresses_recipient_name_length
    CHECK (char_length(recipient_name) BETWEEN 1 AND 60),
  CONSTRAINT customer_addresses_address_line_length
    CHECK (char_length(address_line) BETWEEN 1 AND 200),
  -- The delivery note (mobile G46).
  CONSTRAINT customer_addresses_note_length CHECK (char_length(note) <= 200),
  -- Users are tombstoned, never deleted (api-divergences D-029).
  CONSTRAINT customer_addresses_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT customer_addresses_province_fkey FOREIGN KEY (province_code)
    REFERENCES public.provinces (code) ON DELETE RESTRICT,
  -- Composite, so a ward must belong to the address's province; MATCH SIMPLE skips it while
  -- ward_code is null.
  CONSTRAINT customer_addresses_ward_fkey FOREIGN KEY (ward_code, province_code)
    REFERENCES public.wards (code, province_code) ON DELETE RESTRICT
);

COMMENT ON TABLE public.customer_addresses IS
  'Saved delivery addresses of a customer. Personal data. Soft-deleted (deleted_at), never deleted by kd_app.';
COMMENT ON COLUMN public.customer_addresses.phone IS 'Receiver phone, E.164 (Vietnamese mobile, checked by the API).';
COMMENT ON COLUMN public.customer_addresses.province_code IS 'Official province code (→ provinces).';
COMMENT ON COLUMN public.customer_addresses.ward_code IS
  'Official ward code (→ wards, together with province_code); null when not chosen.';
COMMENT ON COLUMN public.customer_addresses.location IS
  'Required pin dropped by the customer; the delivery zone is computed from it. Never logged.';
COMMENT ON COLUMN public.customer_addresses.note IS 'Delivery note, at most 200 characters (mobile G46); deliveryNote in the API.';
COMMENT ON COLUMN public.customer_addresses.is_default IS
  'At most one per user among rows not deleted (customer_addresses_one_default_idx).';

-- Every column a customer edits, deleted_at included; created_at and updated_at are left out.
CREATE TRIGGER customer_addresses_updated_at
  BEFORE UPDATE OF label, recipient_name, phone, address_line, province_code, ward_code, location,
    note, is_default, deleted_at
  ON public.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Indexes (data-model "Indexes": address book, partial on not deleted; unique default per user).
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX customer_addresses_one_default_idx
  ON public.customer_addresses (user_id)
  WHERE is_default AND deleted_at IS NULL;

CREATE INDEX customer_addresses_user_idx
  ON public.customer_addresses (user_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). A soft delete is an UPDATE; kd_app never deletes a row.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_addresses TO kd_app;
REVOKE DELETE, TRUNCATE ON TABLE public.customer_addresses FROM kd_app;
