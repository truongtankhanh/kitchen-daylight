-- 0014_media: one row per uploaded image (A6-T3; data-model `media` row of "Business, menu and
-- branches"; decision 0009 section 8). The objects live in the media bucket under `storage_key`
-- (`<storage_key>/<variant>.webp`, decision 0009 section 6); the original file is not kept.
-- Added to the data-model columns: `created_at` (the clock of the 7-day cleanup rule), `UNIQUE
-- (sha256)` and the CHECKs below (api-divergences D-148).
-- Not here: the link tables `menu_item_media`, `branch_media` and the foreign key of
-- `branches.cover_media_id` (A6-T4 and later); the cleanup job (A12-T2).

CREATE TABLE public.media (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  storage_key  text NOT NULL,
  content_type text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  bytes        integer NOT NULL,
  sha256       text NOT NULL,
  blurhash     text NOT NULL,
  alt_text     text,
  uploaded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT media_storage_key_key UNIQUE (storage_key),
  -- Same content, same row: the upload answers 200 with the existing row (brief B16).
  CONSTRAINT media_sha256_key UNIQUE (sha256),
  -- `media/<yyyy>/<mm>/<id>`: built from ids only, never from a file name (decision 0009 section 6).
  CONSTRAINT media_storage_key_format CHECK (
    storage_key ~ '^media/[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  -- The type detected from the uploaded bytes; the stored variants are always WebP.
  CONSTRAINT media_content_type_known CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  CONSTRAINT media_width_positive CHECK (width > 0),
  CONSTRAINT media_height_positive CHECK (height > 0),
  CONSTRAINT media_bytes_positive CHECK (bytes > 0),
  -- Lower-case hex SHA-256 of the uploaded bytes.
  CONSTRAINT media_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_blurhash_not_blank CHECK (blurhash <> ''),
  -- Code points, as the API counts them (brief C32).
  CONSTRAINT media_alt_text_length CHECK (char_length(alt_text) <= 200),
  -- RESTRICT: users are anonymised, never deleted. Null only for a row written by the seed.
  CONSTRAINT media_uploaded_by_fkey FOREIGN KEY (uploaded_by)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.media IS
  'Uploaded images. Variants are WebP objects under storage_key; the original file is not kept.';
COMMENT ON COLUMN public.media.storage_key IS
  'Object key prefix media/<yyyy>/<mm>/<id>; each variant is <storage_key>/<variant>.webp.';
COMMENT ON COLUMN public.media.content_type IS 'Type detected from the uploaded bytes.';
COMMENT ON COLUMN public.media.width IS 'Width of the oriented master variant, in pixels.';
COMMENT ON COLUMN public.media.height IS 'Height of the oriented master variant, in pixels.';
COMMENT ON COLUMN public.media.bytes IS 'Size of the uploaded file, in bytes.';
COMMENT ON COLUMN public.media.sha256 IS 'Lower-case hex SHA-256 of the uploaded bytes (duplicates).';
COMMENT ON COLUMN public.media.alt_text IS
  'Belongs to the row, so an edit changes every place that uses the image (brief B18).';
COMMENT ON COLUMN public.media.created_at IS
  'Clock of the cleanup rule: unreferenced and older than 7 days is deleted (decision 0009).';

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). UPDATE for `alt_text` edits, DELETE for the cleanup job of
-- A12-T2; written explicitly although the baseline already gives SELECT, INSERT, UPDATE.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media TO kd_app;
REVOKE TRUNCATE ON TABLE public.media FROM kd_app;
