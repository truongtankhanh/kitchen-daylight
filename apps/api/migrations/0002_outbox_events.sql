-- 0002_outbox_events: the transactional outbox of realtime signals (A0-T6; ADR-0007, data-model
-- `outbox_events`). A row is written in the business transaction and published by the relay
-- (A10); it is a signal, never the record: no personal data or record content.
-- branch_id and audience_user_id get their foreign keys from A1-T3, by ALTER, once `branches`
-- and `users` exist.

CREATE TYPE public.outbox_audience AS ENUM ('PUBLIC', 'BRANCH_STAFF', 'ADMIN', 'USER');

COMMENT ON TYPE public.outbox_audience IS
  'Who receives an outbox event: everyone, the staff of one branch, admins, or one user.';

CREATE TABLE public.outbox_events (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  type             text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  version          integer,
  audience         public.outbox_audience NOT NULL,
  branch_id        uuid,
  audience_user_id uuid,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,

  -- `group.verb` event names of the Realtime table, for example `order.status_changed`.
  CONSTRAINT outbox_events_type_format
    CHECK (length(type) <= 64 AND type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  CONSTRAINT outbox_events_entity_type_length CHECK (length(entity_type) BETWEEN 1 AND 64),
  CONSTRAINT outbox_events_entity_id_length CHECK (length(entity_id) BETWEEN 1 AND 128),
  CONSTRAINT outbox_events_version_positive CHECK (version IS NULL OR version >= 1),
  CONSTRAINT outbox_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  -- branch_id is set exactly for BRANCH_STAFF, audience_user_id exactly for USER.
  CONSTRAINT outbox_events_audience_scope CHECK (
    (audience = 'BRANCH_STAFF' AND branch_id IS NOT NULL AND audience_user_id IS NULL)
    OR (audience = 'USER' AND audience_user_id IS NOT NULL AND branch_id IS NULL)
    OR (audience IN ('PUBLIC', 'ADMIN') AND branch_id IS NULL AND audience_user_id IS NULL)
  )
);

COMMENT ON TABLE public.outbox_events IS
  'Transactional outbox of realtime signals (ADR-0007). No personal data or record content. Purged 7 days after created_at.';
COMMENT ON COLUMN public.outbox_events.type IS 'Event name, group.verb (api-outline, Realtime).';
COMMENT ON COLUMN public.outbox_events.entity_type IS 'Kind of record the event is about.';
COMMENT ON COLUMN public.outbox_events.entity_id IS 'Id of the record, or its key (a settings key).';
COMMENT ON COLUMN public.outbox_events.version IS 'row_version of the record after the change, when it has one.';
COMMENT ON COLUMN public.outbox_events.audience IS 'Who receives the event.';
COMMENT ON COLUMN public.outbox_events.branch_id IS 'The branch, exactly for BRANCH_STAFF. Foreign key added by A1-T3.';
COMMENT ON COLUMN public.outbox_events.audience_user_id IS 'The user, exactly for USER. Foreign key added by A1-T3.';
COMMENT ON COLUMN public.outbox_events.payload IS
  'Event members: ids, statuses, versions and counts only; never personal data or record content (api-divergences D-010).';
COMMENT ON COLUMN public.outbox_events.created_at IS 'Written in the business transaction.';
COMMENT ON COLUMN public.outbox_events.published_at IS 'Set by the relay; null while pending.';

-- Relay poll: WHERE published_at IS NULL ORDER BY created_at, id (api-divergences D-011).
CREATE INDEX outbox_events_pending_idx
  ON public.outbox_events (created_at, id)
  WHERE published_at IS NULL;

-- 7-day purge: WHERE created_at < now() - interval '7 days'.
CREATE INDEX outbox_events_created_at_idx
  ON public.outbox_events (created_at);

-- The baseline default privileges already give SELECT, INSERT, UPDATE; written out per decision
-- 0005 section 7. UPDATE: the relay sets published_at. DELETE: the 7-day purge, this table only.
GRANT USAGE ON TYPE public.outbox_audience TO kd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.outbox_events TO kd_app;
