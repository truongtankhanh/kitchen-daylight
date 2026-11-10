-- 0015_menu: the menu tables, the per-branch menu rows and the media links (A6-T4; data-model
-- "Menu" rows `menu_categories`, `menu_items`, `menu_item_translations`, `tags`, `menu_item_tags`,
-- `item_option_groups`, `item_options`, `menu_item_media`, `branch_menu_items`; "Branches" row
-- `branch_media`; "Rules enforced in the database"; "Indexes" row `branch_menu_items`,
-- `menu_items`). Also the `media` foreign key of `branches.cover_media_id`.
-- Not here: `stock_movements` (A6-T8), `favorite_items` (A7-T5), the `order_*` tables (A8-T2), the
-- trigram search index on `menu_item_translations.name` (A7-T3), the category icon key list
-- (validated by the API, A6-T6).
-- Every choice the data model does not state is a row of docs/decisions/api-divergences.md
-- (D-152 to D-157).

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
CREATE TYPE public.tag_kind AS ENUM ('DIETARY', 'ALLERGEN', 'LABEL');
COMMENT ON TYPE public.tag_kind IS
  'DIETARY (vegetarian, halal...), ALLERGEN (a consumer-safety claim staff must confirm), LABEL (best seller, new, spicy).';

-- ---------------------------------------------------------------------------------------------
-- menu_categories: shared by all branches. Hard-deleted only when no item, soft-deleted ones
-- included, references it (brief B25, B26). `icon` is a key of a list checked by the API (mobile
-- G6); the list is not written yet, so no CHECK.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.menu_categories (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  slug        text NOT NULL,
  names       jsonb NOT NULL,
  icon        text,
  sort_order  integer NOT NULL,
  is_active   boolean NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,

  CONSTRAINT menu_categories_slug_unique UNIQUE (slug),
  -- Short label with a required `vi` key (data-model Conventions, "Translations"); `?` also
  -- matches an array element, so the shape is checked too (D-026, D-129).
  CONSTRAINT menu_categories_names_vi CHECK (names ? 'vi'),
  CONSTRAINT menu_categories_names_object CHECK (jsonb_typeof(names) = 'object'),
  -- Users are anonymised, never deleted (D-029); decision 0007 row 8 (D-153).
  CONSTRAINT menu_categories_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.menu_categories IS
  'Menu categories shared by all branches; a hidden one hides its items from customers (brief B29).';
COMMENT ON COLUMN public.menu_categories.icon IS
  'One key of the category icon list, checked by the API (mobile G6); null when none.';
COMMENT ON COLUMN public.menu_categories.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';
COMMENT ON COLUMN public.menu_categories.updated_by IS
  'Last editor, for the STALE_VERSION message (decision 0007 row 8); null for a system change.';

-- Editable columns: every column except id, created_at and the trigger-owned row_version and
-- updated_at (decision 0007 section 8).
CREATE TRIGGER menu_categories_row_version
  BEFORE UPDATE OF slug, names, icon, sort_order, is_active, updated_by
  ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER menu_categories_updated_at
  BEFORE UPDATE OF slug, names, icon, sort_order, is_active, updated_by
  ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- menu_items: one definition of a dish for the whole brand. Soft-deleted (deleted_at), never
-- deleted by kd_app (brief B5). "Greater than zero to be active", a vi name, a cover and a branch
-- row are API rules (brief B6, B8); the database keeps the price not negative.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.menu_items (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  slug         text NOT NULL,
  category_id  uuid NOT NULL,
  base_price   public.vnd NOT NULL,
  prep_minutes integer,
  sort_order   integer NOT NULL,
  is_active    boolean NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz,

  CONSTRAINT menu_items_slug_unique UNIQUE (slug),
  -- Money is >= 0 (data-model Conventions); the `vnd` domain rejects it first.
  CONSTRAINT menu_items_base_price_not_negative CHECK (base_price >= 0),
  -- Null falls back to branches.default_prep_minutes.
  CONSTRAINT menu_items_prep_minutes_positive CHECK (prep_minutes > 0),
  -- A category in use cannot be deleted (brief B25; IN_USE).
  CONSTRAINT menu_items_category_fkey FOREIGN KEY (category_id)
    REFERENCES public.menu_categories (id) ON DELETE RESTRICT,
  CONSTRAINT menu_items_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.menu_items IS
  'Dishes, one definition for the whole brand; per-branch availability and price in branch_menu_items. Soft-deleted.';
COMMENT ON COLUMN public.menu_items.base_price IS
  'Integer VND; the effective price is branch_menu_items.price_override or this. Must be > 0 to be active (API, brief B8).';
COMMENT ON COLUMN public.menu_items.prep_minutes IS 'Null: the branch default_prep_minutes applies.';
COMMENT ON COLUMN public.menu_items.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';
COMMENT ON COLUMN public.menu_items.updated_by IS
  'Last editor of the item or its translations, tags, options and photos (brief B1); null for a system change.';

-- Items of a category on the customer menu (data-model "Indexes").
CREATE INDEX menu_items_category_active_idx ON public.menu_items (category_id) WHERE is_active;

-- Editable columns: every column except id, created_at and the trigger-owned row_version and
-- updated_at. updated_by is listed so that an edit of a child row (translations, tags, options,
-- photos), which touches the parent with updated_by, moves both (brief B1; migrations/README.md).
CREATE TRIGGER menu_items_row_version
  BEFORE UPDATE OF slug, category_id, base_price, prep_minutes, sort_order, is_active, updated_by,
    deleted_at
  ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER menu_items_updated_at
  BEFORE UPDATE OF slug, category_id, base_price, prep_minutes, sort_order, is_active, updated_by,
    deleted_at
  ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- menu_item_translations: the searchable long text of an item, one row per locale. A `vi` row is
-- required before an item is made active (API). No timestamps: the parent item's updated_at and
-- updated_by record the edit (brief B1; D-154). Length limits are not in the data model (D-152).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.menu_item_translations (
  menu_item_id uuid NOT NULL,
  locale       text NOT NULL,
  name         text NOT NULL,
  description  text,

  CONSTRAINT menu_item_translations_pkey PRIMARY KEY (menu_item_id, locale),
  -- Code points, as the API counts them (D-152).
  CONSTRAINT menu_item_translations_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT menu_item_translations_description_length
    CHECK (char_length(description) <= 2000),
  -- A child of the menu item (data-model "Rules enforced in the database").
  CONSTRAINT menu_item_translations_menu_item_fkey FOREIGN KEY (menu_item_id)
    REFERENCES public.menu_items (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.menu_item_translations IS
  'Name and description of an item per locale; the vi row is required to activate the item (API).';

-- No separate (menu_item_id) index: the primary key leads with it (D-155).

-- ---------------------------------------------------------------------------------------------
-- tags: an admin-managed vocabulary. The kind of a tag with items cannot change (API, brief B30);
-- a tag in use cannot be deleted (menu_item_tags.tag_id RESTRICT, brief B24).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.tags (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  kind        public.tag_kind NOT NULL,
  slug        text NOT NULL,
  names       jsonb NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,

  CONSTRAINT tags_slug_unique UNIQUE (slug),
  CONSTRAINT tags_names_vi CHECK (names ? 'vi'),
  CONSTRAINT tags_names_object CHECK (jsonb_typeof(names) = 'object'),
  CONSTRAINT tags_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.tags IS
  'Dietary, allergen and label tags; one in use cannot be deleted (IN_USE, brief B24).';
COMMENT ON COLUMN public.tags.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';
COMMENT ON COLUMN public.tags.updated_by IS
  'Last editor, for the STALE_VERSION message (decision 0007 row 8); null for a system change.';

CREATE TRIGGER tags_row_version
  BEFORE UPDATE OF kind, slug, names, updated_by
  ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER tags_updated_at
  BEFORE UPDATE OF kind, slug, names, updated_by
  ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- menu_item_tags: the tags of an item. verified_at and verified_by are set together by a MANAGER
-- or ADMIN (brief B13, B14). No timestamps beyond verified_at (D-154).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.menu_item_tags (
  menu_item_id uuid NOT NULL,
  tag_id       uuid NOT NULL,
  verified_at  timestamptz,
  verified_by  uuid,

  CONSTRAINT menu_item_tags_pkey PRIMARY KEY (menu_item_id, tag_id),
  -- Both null (unverified claim) or both set (brief B13).
  CONSTRAINT menu_item_tags_verified_together
    CHECK ((verified_at IS NULL) = (verified_by IS NULL)),
  CONSTRAINT menu_item_tags_menu_item_fkey FOREIGN KEY (menu_item_id)
    REFERENCES public.menu_items (id) ON DELETE CASCADE,
  -- A tag in use cannot be deleted (brief B24, B30; IN_USE).
  CONSTRAINT menu_item_tags_tag_fkey FOREIGN KEY (tag_id)
    REFERENCES public.tags (id) ON DELETE RESTRICT,
  CONSTRAINT menu_item_tags_verified_by_fkey FOREIGN KEY (verified_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.menu_item_tags IS
  'Tags of an item; unverified dietary and allergen claims are labelled by the apps (brief B13).';
COMMENT ON COLUMN public.menu_item_tags.verified_at IS
  'Set with verified_by when a MANAGER or ADMIN confirms the claim; both cleared when unconfirmed.';

-- The RESTRICT check and the IN_USE count of a tag (D-155).
CREATE INDEX menu_item_tags_tag_idx ON public.menu_item_tags (tag_id);

-- ---------------------------------------------------------------------------------------------
-- item_option_groups: "Size" (1 to 1), "Topping" (0 to 3). Belongs to one item. The default,
-- active-option and vi-name rules are the API's (brief B9).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.item_option_groups (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  menu_item_id uuid NOT NULL,
  names        jsonb NOT NULL,
  min_select   integer NOT NULL,
  max_select   integer NOT NULL,
  sort_order   integer NOT NULL,

  CONSTRAINT item_option_groups_names_vi CHECK (names ? 'vi'),
  CONSTRAINT item_option_groups_names_object CHECK (jsonb_typeof(names) = 'object'),
  CONSTRAINT item_option_groups_select_range
    CHECK (0 <= min_select AND min_select <= max_select),
  CONSTRAINT item_option_groups_menu_item_fkey FOREIGN KEY (menu_item_id)
    REFERENCES public.menu_items (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.item_option_groups IS
  'Option groups of one item, with the number of choices allowed (min_select to max_select).';

-- The groups of an item, and the cascade (D-155).
CREATE INDEX item_option_groups_menu_item_idx ON public.item_option_groups (menu_item_id);

-- ---------------------------------------------------------------------------------------------
-- item_options: a choice inside a group. Global active flag; per-branch option availability is not
-- modelled (mobile G35).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.item_options (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL,
  names       jsonb NOT NULL,
  price_delta public.vnd NOT NULL,
  is_default  boolean NOT NULL,
  is_active   boolean NOT NULL,
  sort_order  integer NOT NULL,

  CONSTRAINT item_options_names_vi CHECK (names ? 'vi'),
  CONSTRAINT item_options_names_object CHECK (jsonb_typeof(names) = 'object'),
  -- May be 0, never negative (data-model `item_options` row).
  CONSTRAINT item_options_price_delta_not_negative CHECK (price_delta >= 0),
  -- A child of the item through its group.
  CONSTRAINT item_options_group_fkey FOREIGN KEY (group_id)
    REFERENCES public.item_option_groups (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.item_options IS 'Choices of an option group; price_delta is added to the item price.';
COMMENT ON COLUMN public.item_options.price_delta IS 'Integer VND, 0 or more.';

CREATE INDEX item_options_group_idx ON public.item_options (group_id);

-- ---------------------------------------------------------------------------------------------
-- menu_item_media: the photos of an item; position 0 is the cover. The API rewrites the whole list
-- in one transaction, so (menu_item_id, position) is unique and deferred, as branch_media (brief
-- C30; D-156). At most 8 photos, checked by the API (brief B15).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.menu_item_media (
  menu_item_id uuid NOT NULL,
  media_id     uuid NOT NULL,
  position     integer NOT NULL,

  CONSTRAINT menu_item_media_pkey PRIMARY KEY (menu_item_id, media_id),
  CONSTRAINT menu_item_media_item_position_key UNIQUE (menu_item_id, position)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT menu_item_media_position_not_negative CHECK (position >= 0),
  CONSTRAINT menu_item_media_menu_item_fkey FOREIGN KEY (menu_item_id)
    REFERENCES public.menu_items (id) ON DELETE CASCADE,
  -- An image in use is never deleted by the cleanup job (decision 0009).
  CONSTRAINT menu_item_media_media_fkey FOREIGN KEY (media_id)
    REFERENCES public.media (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.menu_item_media IS 'Photos of an item in display order; position 0 is the cover.';

-- The RESTRICT check and the unreferenced-media lookup (D-155).
CREATE INDEX menu_item_media_media_idx ON public.menu_item_media (media_id);

-- ---------------------------------------------------------------------------------------------
-- branch_media: the gallery of a branch; position 0 is the cover, kept equal to
-- branches.cover_media_id by the API (brief C29). At most 12 photos, checked by the API (brief C32).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.branch_media (
  branch_id uuid NOT NULL,
  media_id  uuid NOT NULL,
  position  integer NOT NULL,

  CONSTRAINT branch_media_pkey PRIMARY KEY (branch_id, media_id),
  -- The API rewrites the whole list in one transaction (brief C30; data-model "Indexes").
  CONSTRAINT branch_media_branch_position_key UNIQUE (branch_id, position)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT branch_media_position_not_negative CHECK (position >= 0),
  CONSTRAINT branch_media_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE,
  CONSTRAINT branch_media_media_fkey FOREIGN KEY (media_id)
    REFERENCES public.media (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.branch_media IS 'Photos of a branch in display order; position 0 is the cover.';

CREATE INDEX branch_media_media_idx ON public.branch_media (media_id);

-- ---------------------------------------------------------------------------------------------
-- branch_menu_items: which items a branch sells, at what price and with what stock. No row means
-- the branch does not offer the item; stopping selling deletes the row (brief B19). Created here
-- for the admin item editor (A6-T7); stock_movements and the stock endpoints are A6-T8.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.branch_menu_items (
  branch_id           uuid NOT NULL,
  menu_item_id        uuid NOT NULL,
  is_available        boolean NOT NULL,
  price_override      public.vnd,
  stock_qty           integer,
  low_stock_threshold integer,
  row_version         integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,

  CONSTRAINT branch_menu_items_pkey PRIMARY KEY (branch_id, menu_item_id),
  -- Brief B22.
  CONSTRAINT branch_menu_items_price_override_positive CHECK (price_override > 0),
  -- An order cannot oversell (data-model `branch_menu_items` row).
  CONSTRAINT branch_menu_items_stock_qty_not_negative CHECK (stock_qty >= 0),
  CONSTRAINT branch_menu_items_low_stock_threshold_not_negative CHECK (low_stock_threshold >= 0),
  -- Children of the branch and of the item (D-157).
  CONSTRAINT branch_menu_items_branch_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branches (id) ON DELETE CASCADE,
  CONSTRAINT branch_menu_items_menu_item_fkey FOREIGN KEY (menu_item_id)
    REFERENCES public.menu_items (id) ON DELETE CASCADE,
  CONSTRAINT branch_menu_items_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.branch_menu_items IS
  'Items a branch sells; no row means not offered. Effective price = price_override or menu_items.base_price.';
COMMENT ON COLUMN public.branch_menu_items.price_override IS 'Integer VND above 0; null uses menu_items.base_price.';
COMMENT ON COLUMN public.branch_menu_items.stock_qty IS
  'Null: stock not tracked. Changed with a stock_movements row (A6-T8); does not bump row_version or updated_at.';
COMMENT ON COLUMN public.branch_menu_items.low_stock_threshold IS
  'Null never means low; only stock_qty = 0 is sold out (brief F7).';
COMMENT ON COLUMN public.branch_menu_items.row_version IS 'Optimistic concurrency, set by trigger (decision 0007 section 8).';
COMMENT ON COLUMN public.branch_menu_items.updated_by IS
  'Last editor, for the STALE_VERSION message (decision 0007 row 8); null for a system change.';

-- Item lookups across branches (data-model "Indexes"); the primary key serves the branch menu.
CREATE INDEX branch_menu_items_menu_item_idx ON public.branch_menu_items (menu_item_id);

-- Editable columns: every column except the keys, created_at, the trigger-owned row_version and
-- updated_at, and stock_qty, which every order changes in the background: an order must not make a
-- staff edit of price or availability stale (decision 0007 section 8; D-157).
CREATE TRIGGER branch_menu_items_row_version
  BEFORE UPDATE OF is_available, price_override, low_stock_threshold, updated_by
  ON public.branch_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version();

CREATE TRIGGER branch_menu_items_updated_at
  BEFORE UPDATE OF is_available, price_override, low_stock_threshold, updated_by
  ON public.branch_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- branches.cover_media_id: the column exists since 0007 with no constraint (0013 added none).
-- RESTRICT: a cover image is never deleted by the cleanup job.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.branches
  ADD CONSTRAINT branches_cover_media_fkey FOREIGN KEY (cover_media_id)
    REFERENCES public.media (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.branches.cover_media_id IS
  'Kept equal to the branch_media row at position 0 by the API (brief C29).';

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). The baseline default privileges give SELECT, INSERT, UPDATE;
-- written out per table. DELETE where the API removes rows: an empty category (brief B25), an
-- unused tag, lists rewritten as a whole, and a branch row when the branch stops selling the item
-- (brief B19). menu_items is soft-deleted: no DELETE. No sequence: every key is a uuid.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON TYPE public.tag_kind TO kd_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_categories TO kd_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.menu_items TO kd_app;
REVOKE DELETE, TRUNCATE ON TABLE public.menu_items FROM kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_item_translations TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tags TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_item_tags TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.item_option_groups TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.item_options TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_item_media TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_media TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_menu_items TO kd_app;
