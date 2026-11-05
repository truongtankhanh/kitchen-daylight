import { AUDIT_ENTITY_TYPES } from '@kd/contracts';
import type { AuditAction, AuditEntityType } from '@kd/contracts';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row of `public.audit_logs` (migration `0003_audit_logs.sql`): append-only, written by
 * `AuditService` and never updated or deleted by the application. Columns state `type` and `name`
 * explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'audit_logs', schema: 'public' })
export class AuditLog {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'text', name: 'action' })
  action!: AuditAction;

  @Column({
    type: 'enum',
    name: 'entity_type',
    enum: AUDIT_ENTITY_TYPES,
    enumName: 'audit_entity_type',
  })
  entityType!: AuditEntityType;

  @Column({ type: 'text', name: 'entity_id' })
  entityId!: string;

  @Column({ type: 'text', name: 'entity_label', nullable: true })
  entityLabel!: string | null;

  @Column({ type: 'uuid', name: 'branch_id', nullable: true })
  branchId!: string | null;

  /** A JSON object (`CHECK jsonb_typeof(diff) = 'object'`), sanitized before writing. */
  @Column({ type: 'jsonb', name: 'diff', default: () => "'{}'::jsonb" })
  diff!: object;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
