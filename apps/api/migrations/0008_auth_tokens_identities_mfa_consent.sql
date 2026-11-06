-- 0008_auth_tokens_identities_mfa_consent: sign-in identities, refresh tokens, email codes and
-- links, TOTP credentials, consent documents and consent events (A1-T4; data-model `auth_identities`,
-- `refresh_tokens`, `email_tokens`, `mfa_credentials`, `consent_documents`, `user_consents`;
-- ADR-0003; decision 0008 sections 2, 6 and 8).
-- Not here: token, code and TOTP logic (A1-T6, A2-T2, A3-T2) and the text of a consent document
-- (A4-T4). Every choice the data model does not state is a row of docs/decisions/api-divergences.md
-- (D-031 to D-036).
-- Users are tombstoned, never deleted, so no foreign key to `users` cascades: the account deletion
-- deletes the rows of the four token tables itself (data-model "Personal data lifecycle").

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
CREATE TYPE public.auth_provider AS ENUM ('GOOGLE', 'APPLE');
COMMENT ON TYPE public.auth_provider IS 'Social sign-in providers, customers on mobile only (ADR-0003).';

CREATE TYPE public.email_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'INVITE');
COMMENT ON TYPE public.email_token_type IS 'Purpose of an email_tokens row; INVITE is staff only.';

CREATE TYPE public.email_token_channel AS ENUM ('CODE', 'LINK');
COMMENT ON TYPE public.email_token_channel IS
  'CODE: 6 digits typed in the mobile app (customers); LINK: admin web link (staff).';

CREATE TYPE public.consent_document_type AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY');

CREATE TYPE public.consent_action AS ENUM ('GRANTED', 'WITHDRAWN');

CREATE TYPE public.consent_client AS ENUM ('MOBILE', 'ADMIN_WEB', 'API');

-- ---------------------------------------------------------------------------------------------
-- auth_identities: a Google or Apple account linked to a user. Inserted and deleted (link, unlink),
-- never updated, so no timestamps (api-divergences D-035).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.auth_identities (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid NOT NULL,
  provider         public.auth_provider NOT NULL,
  provider_subject text NOT NULL,

  -- Accounts link on (provider, subject), never on email alone (ADR-0003).
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, provider_subject),
  -- One identity per provider and user: `POST/DELETE /me/identities/{provider}` addresses it by
  -- provider (api-divergences D-033). Also the index of user_id.
  CONSTRAINT auth_identities_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT auth_identities_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.auth_identities IS
  'Social sign-in identities of customers; deleted on unlink and on account deletion.';
COMMENT ON COLUMN public.auth_identities.provider_subject IS 'The provider''s `sub` claim.';

-- ---------------------------------------------------------------------------------------------
-- refresh_tokens: one row per issued refresh token; a family is one signed-in device or browser
-- (decision 0008 sections 1 and 2). Hashes only, never the raw token, never an IP address.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.refresh_tokens (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id           uuid NOT NULL,
  family_id         uuid NOT NULL,
  token_hash        bytea NOT NULL,
  device_label      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  family_expires_at timestamptz NOT NULL,
  used_at           timestamptz,
  replaced_by_id    uuid,
  revoked_at        timestamptz,
  last_used_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash),
  -- SHA-256 of the raw token (decision 0008 section 2).
  CONSTRAINT refresh_tokens_token_hash_length CHECK (octet_length(token_hash) = 32),
  -- Display only; normalised and cut to 60 code points by the API (decision 0008 section 1).
  CONSTRAINT refresh_tokens_device_label_length CHECK (char_length(device_label) BETWEEN 1 AND 60),
  -- The idle end never passes the absolute end: min(now + idle, family_expires_at).
  CONSTRAINT refresh_tokens_expires_within_family CHECK (expires_at <= family_expires_at),
  -- A token is replaced only when it is used, and never by itself; one successor per token.
  CONSTRAINT refresh_tokens_replaced_when_used CHECK (replaced_by_id IS NULL OR used_at IS NOT NULL),
  CONSTRAINT refresh_tokens_not_replaced_by_itself CHECK (replaced_by_id <> id),
  CONSTRAINT refresh_tokens_replaced_by_unique UNIQUE (replaced_by_id),
  CONSTRAINT refresh_tokens_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT,
  -- The purge deletes rows in any order; a purged successor only clears the link.
  CONSTRAINT refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by_id)
    REFERENCES public.refresh_tokens (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.refresh_tokens IS
  'Single-use refresh tokens, hashed. Reuse revokes the family. Purged 30 days after expiry or revocation.';
COMMENT ON COLUMN public.refresh_tokens.family_id IS
  'Session id: the `sid` claim and the id of /me/sessions/{id} (decision 0008 section 1).';
COMMENT ON COLUMN public.refresh_tokens.token_hash IS 'SHA-256 of the raw 256-bit token, 32 bytes.';
COMMENT ON COLUMN public.refresh_tokens.expires_at IS 'Idle (sliding) end of this token.';
COMMENT ON COLUMN public.refresh_tokens.family_expires_at IS
  'Absolute end of the family, copied to every successor (decision 0008 section 2).';
COMMENT ON COLUMN public.refresh_tokens.replaced_by_id IS
  'The successor issued when this token was used; read by the 10-second grace window.';
COMMENT ON COLUMN public.refresh_tokens.last_used_at IS
  'Set at issue; the "last active" time of the session list.';

-- Rotation and revocation by family, revocation and deletion by user, purge (data-model Indexes).
CREATE INDEX refresh_tokens_family_idx ON public.refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON public.refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_at_idx ON public.refresh_tokens (expires_at);

-- ---------------------------------------------------------------------------------------------
-- email_tokens: customer codes (CODE) and staff links (LINK), single use, hashed (decision 0008
-- section 6). token_hash is not unique: a 6-digit code is HMAC'd with the user id and type, so a
-- later code of one user and type may repeat an earlier, used one.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.email_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid NOT NULL,
  type         public.email_token_type NOT NULL,
  channel      public.email_token_channel NOT NULL,
  token_hash   bytea NOT NULL,
  target_email public.citext NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,

  -- HMAC-SHA-256 of a code or SHA-256 of a link token (decision 0008 section 6).
  CONSTRAINT email_tokens_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT email_tokens_attempts_not_negative CHECK (attempts >= 0),
  CONSTRAINT email_tokens_max_attempts_positive CHECK (max_attempts >= 1),
  -- An invitation is always a staff link (ADR-0003, Email flows).
  CONSTRAINT email_tokens_invite_is_link CHECK (type <> 'INVITE' OR channel = 'LINK'),
  CONSTRAINT email_tokens_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.email_tokens IS
  'Email verification, password reset and invitation tokens. Purged 7 days after expiry or use (codes: 1 day).';
COMMENT ON COLUMN public.email_tokens.target_email IS
  'Where the message went; may differ from users.email (the "another email" path).';
COMMENT ON COLUMN public.email_tokens.attempts IS 'Wrong guesses; the code is dead at max_attempts.';
COMMENT ON COLUMN public.email_tokens.created_at IS
  'Issue time: the 60-second resend rule and the daily cap read it (decision 0008 section 6).';

-- At most one live token per user and type (ADR-0008 #1, #2). An expired, unused row still counts:
-- issuing a new token first sets used_at on the old one, in the same transaction.
CREATE UNIQUE INDEX email_tokens_live_user_type_unique
  ON public.email_tokens (user_id, type) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- mfa_credentials: TOTP of a MANAGER or ADMIN (ADR-0009 WA4, WA20; decision 0008 section 8).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.mfa_credentials (
  user_id              uuid NOT NULL,
  secret_encrypted     text NOT NULL,
  enabled_at           timestamptz,
  last_used_step       integer,
  recovery_code_hashes text[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mfa_credentials_pkey PRIMARY KEY (user_id),
  -- v1.<kid>.<iv>.<ciphertext>.<tag>: kid 16 hex digits, then base64url without padding of a
  -- 12-byte IV (16 characters), the ciphertext and a 16-byte GCM tag (22 characters).
  CONSTRAINT mfa_credentials_secret_layout CHECK (
    secret_encrypted ~ '^v1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT mfa_credentials_last_used_step_not_negative
    CHECK (last_used_step IS NULL OR last_used_step >= 0),
  -- Ten recovery codes at most (brief E20); no null element.
  CONSTRAINT mfa_credentials_recovery_codes_count CHECK (cardinality(recovery_code_hashes) <= 10),
  CONSTRAINT mfa_credentials_recovery_codes_not_null
    CHECK (array_position(recovery_code_hashes, NULL) IS NULL),
  CONSTRAINT mfa_credentials_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.mfa_credentials IS
  'TOTP secret and recovery codes; deleted by an MFA reset and by account deletion.';
COMMENT ON COLUMN public.mfa_credentials.secret_encrypted IS
  'AES-256-GCM under MFA_ENCRYPTION_KEY, the user id as associated data (decision 0008 section 8).';
COMMENT ON COLUMN public.mfa_credentials.enabled_at IS 'Null until the first code is confirmed.';
COMMENT ON COLUMN public.mfa_credentials.last_used_step IS
  'Last accepted TOTP time step (30 s); a code of this step or an earlier one is refused (replay).';
COMMENT ON COLUMN public.mfa_credentials.recovery_code_hashes IS
  'One argon2id PHC string per unused recovery code; a used code is removed from the array.';

-- ---------------------------------------------------------------------------------------------
-- consent_documents: one published version of the Terms or the Privacy Policy per locale. Published
-- text is immutable: no UPDATE and no DELETE for kd_app (api-divergences D-036).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.consent_documents (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  type           public.consent_document_type NOT NULL,
  version        text NOT NULL,
  locale         text NOT NULL,
  content_sha256 text NOT NULL,
  published_at   timestamptz NOT NULL,

  CONSTRAINT consent_documents_type_version_locale_unique UNIQUE (type, version, locale),
  -- Lower-case hex of the SHA-256 of the published text.
  CONSTRAINT consent_documents_content_sha256_format CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.consent_documents IS
  'Proves which text a user accepted. The text itself has no column yet (api-divergences D-034, A4-T4).';

-- ---------------------------------------------------------------------------------------------
-- user_consents: append-only event log; the current state per document is the latest row.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.user_consents (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL,
  document_id uuid NOT NULL,
  action      public.consent_action NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  client      public.consent_client NOT NULL,
  app_version text,

  -- History is never destroyed (data-model "Rules enforced in the database").
  CONSTRAINT user_consents_user_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT user_consents_document_fkey FOREIGN KEY (document_id)
    REFERENCES public.consent_documents (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.user_consents IS
  'Append-only consent events, kept as evidence after account deletion.';
COMMENT ON COLUMN public.user_consents.app_version IS 'Client version when known; null otherwise.';

-- Current consent state (data-model Indexes).
CREATE INDEX user_consents_user_document_occurred_idx
  ON public.user_consents (user_id, document_id, occurred_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Grants (decision 0005 section 7). The baseline default privileges give SELECT, INSERT, UPDATE;
-- written out here.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON TYPE public.auth_provider TO kd_app;
GRANT USAGE ON TYPE public.email_token_type TO kd_app;
GRANT USAGE ON TYPE public.email_token_channel TO kd_app;
GRANT USAGE ON TYPE public.consent_document_type TO kd_app;
GRANT USAGE ON TYPE public.consent_action TO kd_app;
GRANT USAGE ON TYPE public.consent_client TO kd_app;

-- Deleted by unlink, the purge (refresh 30 days, email 7 days after expiry or use), an MFA reset and
-- the account deletion (data-model "Personal data lifecycle").
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_identities TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refresh_tokens TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_tokens TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mfa_credentials TO kd_app;

-- Published text is immutable. SELECT is kept because TypeORM reads id back with RETURNING.
GRANT SELECT, INSERT ON TABLE public.consent_documents TO kd_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.consent_documents FROM kd_app;

-- Append-only (data-model Conventions); kept as evidence after account deletion.
GRANT SELECT, INSERT ON TABLE public.user_consents TO kd_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.user_consents FROM kd_app;
