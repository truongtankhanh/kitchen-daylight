import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row of `public.idempotency_keys` (migration `0004_idempotency_keys.sql`). Named
 * `IdempotencyKeyRecord` so it does not clash with the `@IdempotencyKey()` parameter decorator.
 * Columns state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'idempotency_keys', schema: 'public' })
export class IdempotencyKeyRecord {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text', name: 'scope' })
  scope!: string;

  @Column({ type: 'uuid', name: 'actor_id' })
  actorId!: string;

  @Column({ type: 'text', name: 'key' })
  key!: string;

  @Column({ type: 'text', name: 'request_hash' })
  requestHash!: string;

  @Column({ type: 'integer', name: 'response_status', nullable: true })
  responseStatus!: number | null;

  /** A JSON object of ids only (`CHECK jsonb_typeof(response_ref) = 'object'`); null until complete. */
  @Column({ type: 'jsonb', name: 'response_ref', nullable: true })
  responseRef!: object | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}
