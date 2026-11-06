import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/**
 * One row of `public.mfa_credentials` (migration `0008_auth_tokens_identities_mfa_consent.sql`;
 * decision 0008 section 8): the TOTP secret and recovery codes of a `MANAGER` or `ADMIN`, keyed by
 * the user. Columns state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'mfa_credentials', schema: 'public' })
export class MfaCredential {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  /** `v1.<kid>.<iv>.<ciphertext>.<tag>`, AES-256-GCM. Never logged or returned. */
  @Column({ type: 'text', name: 'secret_encrypted' })
  secretEncrypted!: string;

  /** Null until the first code is confirmed. */
  @Column({ type: 'timestamptz', name: 'enabled_at', nullable: true })
  enabledAt!: Date | null;

  /** Last accepted TOTP time step; a code of this step or an earlier one is a replay. */
  @Column({ type: 'integer', name: 'last_used_step', nullable: true })
  lastUsedStep!: number | null;

  /** One argon2id PHC string per unused recovery code, at most ten. Never logged or returned. */
  @Column({ type: 'text', name: 'recovery_code_hashes', array: true, default: () => "'{}'" })
  recoveryCodeHashes!: string[];

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
