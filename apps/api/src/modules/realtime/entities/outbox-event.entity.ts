import { OUTBOX_AUDIENCES } from '@kd/contracts';
import type { OutboxAudience } from '@kd/contracts';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row of `public.outbox_events` (migration `0002_outbox_events.sql`): a realtime signal
 * written in the business transaction and published by the relay (ADR-0007). Columns state
 * `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'outbox_events', schema: 'public' })
export class OutboxEvent {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text', name: 'type' })
  type!: string;

  @Column({ type: 'text', name: 'entity_type' })
  entityType!: string;

  @Column({ type: 'text', name: 'entity_id' })
  entityId!: string;

  @Column({ type: 'integer', name: 'version', nullable: true })
  version!: number | null;

  @Column({ type: 'enum', name: 'audience', enum: OUTBOX_AUDIENCES, enumName: 'outbox_audience' })
  audience!: OutboxAudience;

  @Column({ type: 'uuid', name: 'branch_id', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid', name: 'audience_user_id', nullable: true })
  audienceUserId!: string | null;

  @Column({ type: 'jsonb', name: 'payload', default: () => "'{}'::jsonb" })
  /** A JSON object (`CHECK jsonb_typeof(payload) = 'object'`): ids, statuses, versions, counts. */
  payload!: object;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;
}
