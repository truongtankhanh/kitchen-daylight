-- 0003_audit_logs: the append-only audit trail (A0-T7; data-model `audit_logs`, brief G1 to G8).
-- Rows are written by AuditService in the caller's transaction, never updated or deleted by the
-- application role. actor_user_id and branch_id get their foreign keys from A1-T3, by ALTER, once
-- `users` and `branches` exist. The 24-month purge is not here: decision 0007 section 11 answer 5
-- (a SECURITY DEFINER function, A12-T1; api-divergences D-016).

-- The eight values of data-model plus the four proposed by brief G2 (RESERVATION, PROMOTION,
-- REVIEW_REPORT, DELIVERY_ZONE). Same list as AUDIT_ENTITY_TYPES in @kd/contracts; a new value is
-- an ALTER TYPE ... ADD VALUE migration.
CREATE TYPE public.audit_entity_type AS ENUM (
  'ORDER',
  'MENU_ITEM',
  'VOUCHER',
  'USER',
  'REVIEW',
  'BRANCH',
  'APP_SETTINGS',
  'EXPORT_JOB',
  'RESERVATION',
  'PROMOTION',
  'REVIEW_REPORT',
  'DELIVERY_ZONE'
);

COMMENT ON TYPE public.audit_entity_type IS
  'Kind of record an audit row is about (data-model audit_logs, brief G2).';

CREATE TABLE public.audit_logs (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id uuid,
  action        text NOT NULL,
  entity_type   public.audit_entity_type NOT NULL,
  entity_id     text NOT NULL,
  entity_label  text,
  branch_id     uuid,
  diff          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- One lower-case `group.verb` code (brief G1), for example `user.role_change`. Same rule as
  -- AUDIT_ACTION_FORMAT in apps/api/src/modules/audit/audit-actions.ts.
  CONSTRAINT audit_logs_action_format
    CHECK (length(action) <= 64 AND action ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  -- text, not uuid: a settings row uses its key as the id (`settings.change`, brief L10).
  CONSTRAINT audit_logs_entity_id_length CHECK (length(entity_id) BETWEEN 1 AND 128),
  -- The readable name, never an email (brief G4). The row cannot be corrected later (no UPDATE),
  -- so the rule of AuditService is repeated here as a backstop.
  CONSTRAINT audit_logs_entity_label_length
    CHECK (entity_label IS NULL OR length(entity_label) BETWEEN 1 AND 200),
  CONSTRAINT audit_logs_entity_label_not_email
    CHECK (entity_label IS NULL OR entity_label !~ '[A-Za-z0-9._%+-]@[A-Za-z0-9-]+\.[A-Za-z0-9-]'),
  CONSTRAINT audit_logs_diff_object CHECK (jsonb_typeof(diff) = 'object')
);

COMMENT ON TABLE public.audit_logs IS
  'Append-only audit trail: kd_app may SELECT and INSERT only. Kept 24 months (data-model retention).';
COMMENT ON COLUMN public.audit_logs.actor_user_id IS
  'The acting user, from the token; null for a system action. Foreign key added by A1-T3.';
COMMENT ON COLUMN public.audit_logs.action IS 'Catalogue code, group.verb (AuditAction in @kd/contracts).';
COMMENT ON COLUMN public.audit_logs.entity_type IS 'Kind of record acted on.';
COMMENT ON COLUMN public.audit_logs.entity_id IS 'Id of the record, or its key (a settings key).';
COMMENT ON COLUMN public.audit_logs.entity_label IS
  'Readable name stored at write time (order number, item name, display name); never an email (brief G4).';
COMMENT ON COLUMN public.audit_logs.branch_id IS
  'Branch of a branch-specific action, so a manager sees it (brief G5); null rows are admin only. Foreign key added by A1-T3.';
COMMENT ON COLUMN public.audit_logs.diff IS
  'Before and after values, sanitized: no password, code, token, secret, full contact or full account number (brief G8).';
COMMENT ON COLUMN public.audit_logs.created_at IS 'Written in the business transaction.';

-- The four indexes of data-model (brief G6).
-- Trail of one record.
CREATE INDEX audit_logs_entity_idx
  ON public.audit_logs (entity_type, entity_id, created_at);

-- A manager's branch trail.
CREATE INDEX audit_logs_branch_idx
  ON public.audit_logs (branch_id, created_at DESC);

-- What one person did.
CREATE INDEX audit_logs_actor_idx
  ON public.audit_logs (actor_user_id, created_at);

-- Date range only, cursor order (created_at DESC, id DESC); also serves the 24-month purge.
CREATE INDEX audit_logs_created_at_idx
  ON public.audit_logs (created_at DESC, id DESC);

-- Append-only (data-model Conventions; decision 0005 section 7). The Docker baseline default
-- privileges grant SELECT, INSERT, UPDATE on new tables, so UPDATE is revoked explicitly; DELETE and
-- TRUNCATE are revoked too, in case a baseline ever grants them. SELECT serves the viewer (A12-T7)
-- and the RETURNING of the generated id on insert (api-divergences D-015). No DELETE: the purge is
-- D-016.
GRANT USAGE ON TYPE public.audit_entity_type TO kd_app;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO kd_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM kd_app;
