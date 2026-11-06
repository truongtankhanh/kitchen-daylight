import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/** `public.email_token_type` (migration `0008_auth_tokens_identities_mfa_consent.sql`). */
export const EMAIL_TOKEN_TYPES = ['VERIFY_EMAIL', 'RESET_PASSWORD', 'INVITE'] as const;
export type EmailTokenType = (typeof EMAIL_TOKEN_TYPES)[number];

/** `public.email_token_channel`. `INVITE` is always `LINK` (`CHECK email_tokens_invite_is_link`). */
export const EMAIL_TOKEN_CHANNELS = ['CODE', 'LINK'] as const;
export type EmailTokenChannel = (typeof EMAIL_TOKEN_CHANNELS)[number];

/**
 * One row of `public.email_tokens` (migration `0008_auth_tokens_identities_mfa_consent.sql`;
 * decision 0008 section 6): a customer code or a staff link, single use, hashed. At most one row
 * per (`userId`, `type`) has a null `usedAt`, so issuing a new token sets `usedAt` on the old one
 * first, in the same transaction. Columns state `type` and `name` explicitly (decision 0007
 * sections 2 and 8).
 */
@Entity({ name: 'email_tokens', schema: 'public' })
export class EmailToken {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  @Column({ type: 'enum', name: 'type', enum: EMAIL_TOKEN_TYPES, enumName: 'email_token_type' })
  type!: EmailTokenType;

  @Column({
    type: 'enum',
    name: 'channel',
    enum: EMAIL_TOKEN_CHANNELS,
    enumName: 'email_token_channel',
  })
  channel!: EmailTokenChannel;

  /** HMAC-SHA-256 of a code or SHA-256 of a link token, 32 bytes. Never logged. */
  @Column({ type: 'bytea', name: 'token_hash' })
  tokenHash!: Buffer;

  /** `citext`: where the message went. */
  @Column({ type: 'citext', name: 'target_email' })
  targetEmail!: string;

  @Column({ type: 'integer', name: 'attempts', default: 0 })
  attempts!: number;

  @Column({ type: 'integer', name: 'max_attempts' })
  maxAttempts!: number;

  /** Issue time, read by the resend interval and the daily cap. */
  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;
}
