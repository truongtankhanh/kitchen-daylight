import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { ConsentDocument } from './consent-document.entity.js';
import { User } from './user.entity.js';

/** `public.consent_action` (migration `0008_auth_tokens_identities_mfa_consent.sql`). */
export const CONSENT_ACTIONS = ['GRANTED', 'WITHDRAWN'] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

/** `public.consent_client`. */
export const CONSENT_CLIENTS = ['MOBILE', 'ADMIN_WEB', 'API'] as const;
export type ConsentClient = (typeof CONSENT_CLIENTS)[number];

/**
 * One row of `public.user_consents` (migration `0008_auth_tokens_identities_mfa_consent.sql`): an
 * append-only consent event; the current state per document is the latest row. `kd_app` has
 * `SELECT, INSERT` only. Columns state `type` and `name` explicitly (decision 0007 sections 2
 * and 8).
 */
@Entity({ name: 'user_consents', schema: 'public' })
export class UserConsent {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  @ManyToOne(() => ConsentDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'document_id', referencedColumnName: 'id' })
  document?: Relation<ConsentDocument>;

  @Column({ type: 'enum', name: 'action', enum: CONSENT_ACTIONS, enumName: 'consent_action' })
  action!: ConsentAction;

  @Column({ type: 'timestamptz', name: 'occurred_at', default: () => 'now()' })
  occurredAt!: Date;

  @Column({ type: 'enum', name: 'client', enum: CONSENT_CLIENTS, enumName: 'consent_client' })
  client!: ConsentClient;

  /** Client version when known. */
  @Column({ type: 'text', name: 'app_version', nullable: true })
  appVersion!: string | null;
}
