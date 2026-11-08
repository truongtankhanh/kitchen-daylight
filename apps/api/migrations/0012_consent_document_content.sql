-- 0012_consent_document_content: the text of a published Terms of Service or Privacy Policy, read by
-- GET /legal/documents/current (A4-T4; closes the gap of api-divergences D-034). The column and its
-- CHECK are a proposal logged as api-divergences D-119; the data model names `content_sha256` only.
-- No row is written here: documents are published by the seed (A4-T5) as kd_migrator.

-- Nullable, so rows inserted before this migration (smoke sheets, fixtures) stay valid; such a row
-- is never served by the endpoint. Set at insert time and never changed: kd_app has no UPDATE on
-- this table (0008, api-divergences D-036).
ALTER TABLE public.consent_documents ADD COLUMN content text;

-- The database proves that the stored text is the text whose hash the user accepted: lower-case hex
-- SHA-256 of the UTF-8 bytes, the same digest as `content_sha256_format` (0008) describes.
ALTER TABLE public.consent_documents
  ADD CONSTRAINT consent_documents_content_matches_sha256 CHECK (
    content IS NULL OR content_sha256 = encode(sha256(convert_to(content, 'UTF8')), 'hex')
  );

COMMENT ON TABLE public.consent_documents IS
  'Proves which text a user accepted. Published rows are immutable; a new version is a new row.';
COMMENT ON COLUMN public.consent_documents.content IS
  'The published text, UTF-8; its SHA-256 is content_sha256. Null on rows published before 0012.';

-- Grants: unchanged. 0008 already grants kd_app SELECT, INSERT only and revokes UPDATE, DELETE and
-- TRUNCATE; the table-level SELECT covers the new column. No REVOKE is needed and none is widened.
