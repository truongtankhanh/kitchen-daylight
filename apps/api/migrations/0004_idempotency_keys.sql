-- 0004_idempotency_keys: the store of the Idempotency-Key header (A0-T8; decision 0007 section 10;
-- api-outline Conventions, "Idempotency"). One row per (operation, acting user, key), written by
-- IdempotencyService inside the business transaction: begin inserts it, complete stores a reference
-- to the result before commit, and a rollback leaves nothing. It is a 24-hour cache, not history.
-- The data model has no such table (api-divergences D-021); the `orders` unique constraints on
-- (customer_id, idempotency_key) and (created_by, idempotency_key) stay with A8.
-- actor_id gets its foreign key from A1-T3, by ALTER, once `users` exists.

CREATE TABLE public.idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  scope           text NOT NULL,
  actor_id        uuid NOT NULL,
  key             text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_ref    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL,

  -- The operation, a constant per endpoint: `orders.create`, `admin.points.adjust`.
  CONSTRAINT idempotency_keys_scope_format
    CHECK (length(scope) <= 64 AND scope ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  -- The header format of decision 0007 section 10.
  CONSTRAINT idempotency_keys_key_format CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  -- SHA-256 in lower-case hex of the method, the route template and the canonical body.
  CONSTRAINT idempotency_keys_request_hash_format CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  -- Only a success is stored: a failed request rolls back with its row.
  CONSTRAINT idempotency_keys_response_status_success
    CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 299),
  CONSTRAINT idempotency_keys_response_ref_object
    CHECK (response_ref IS NULL OR jsonb_typeof(response_ref) = 'object'),
  -- The outcome is written all at once by complete, or not at all.
  CONSTRAINT idempotency_keys_completed_together CHECK (
    (completed_at IS NULL AND response_status IS NULL AND response_ref IS NULL)
    OR (completed_at IS NOT NULL AND response_status IS NOT NULL AND response_ref IS NOT NULL)
  ),
  CONSTRAINT idempotency_keys_expires_after_created CHECK (expires_at > created_at),
  -- One key per operation and user: the same key on two operations, or from two users, never
  -- collides. The target of `INSERT ... ON CONFLICT (scope, actor_id, key) DO NOTHING`.
  CONSTRAINT idempotency_keys_scope_actor_key_unique UNIQUE (scope, actor_id, key)
);

COMMENT ON TABLE public.idempotency_keys IS
  'Idempotency-Key store (decision 0007 section 10): a reference to the first result, never a copy of the response. Purged after expires_at (24 hours).';
COMMENT ON COLUMN public.idempotency_keys.scope IS 'The operation, a constant per endpoint (orders.create).';
COMMENT ON COLUMN public.idempotency_keys.actor_id IS
  'The acting user, from the token. Foreign key added by A1-T3.';
COMMENT ON COLUMN public.idempotency_keys.key IS 'The Idempotency-Key header value.';
COMMENT ON COLUMN public.idempotency_keys.request_hash IS
  'SHA-256 hex of the method, route template and canonical body; a different hash is IDEMPOTENCY_CONFLICT.';
COMMENT ON COLUMN public.idempotency_keys.response_status IS 'HTTP status of the first result; null until complete.';
COMMENT ON COLUMN public.idempotency_keys.response_ref IS
  'Non-personal reference to the result, for example {"orderId": "..."}; never a copy of the record.';
COMMENT ON COLUMN public.idempotency_keys.completed_at IS 'Set by complete, in the same transaction as begin.';
COMMENT ON COLUMN public.idempotency_keys.expires_at IS 'created_at + 24 hours; an expired row is replaced, then purged.';

-- Expiry purge (A12-T2): WHERE expires_at <= now().
CREATE INDEX idempotency_keys_expires_at_idx
  ON public.idempotency_keys (expires_at);

-- The baseline default privileges already give SELECT, INSERT, UPDATE; written out per decision
-- 0005 section 7. UPDATE: complete stores the outcome. DELETE: an expired row is replaced and the
-- expiry purge removes old rows (a cache, not history; decision 0007 section 10).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.idempotency_keys TO kd_app;
