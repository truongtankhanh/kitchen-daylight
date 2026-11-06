import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/**
 * One row of `public.refresh_tokens` (migration `0008_auth_tokens_identities_mfa_consent.sql`;
 * decision 0008 sections 1 and 2): one issued refresh token. A family (`familyId`) is one signed-in
 * device or browser. Only the SHA-256 of the raw token is stored. Columns state `type` and `name`
 * explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'refresh_tokens', schema: 'public' })
export class RefreshToken {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  /** The session id (`sid` claim). */
  @Column({ type: 'uuid', name: 'family_id' })
  familyId!: string;

  /** SHA-256 of the raw token, 32 bytes; unique. Never logged. */
  @Column({ type: 'bytea', name: 'token_hash' })
  tokenHash!: Buffer;

  /** Display only, 1 to 60 characters. */
  @Column({ type: 'text', name: 'device_label' })
  deviceLabel!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  /** Idle (sliding) end of this token; never after `familyExpiresAt`. */
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  /** Absolute end of the family, copied to every successor. */
  @Column({ type: 'timestamptz', name: 'family_expires_at' })
  familyExpiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;

  /** The successor issued when this token was used (grace window). */
  @Column({ type: 'uuid', name: 'replaced_by_id', nullable: true })
  replacedById!: string | null;

  @ManyToOne(() => RefreshToken, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'replaced_by_id', referencedColumnName: 'id' })
  replacedBy?: Relation<RefreshToken> | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  /** Set at issue; the "last active" time of the session list. */
  @Column({ type: 'timestamptz', name: 'last_used_at', default: () => 'now()' })
  lastUsedAt!: Date;
}
