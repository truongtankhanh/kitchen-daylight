import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/** `public.auth_provider` (migration `0008_auth_tokens_identities_mfa_consent.sql`; ADR-0003). */
export const AUTH_PROVIDERS = ['GOOGLE', 'APPLE'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * One row of `public.auth_identities` (migration `0008_auth_tokens_identities_mfa_consent.sql`): a
 * Google or Apple account linked to a customer. Unique on (`provider`, `providerSubject`) and on
 * (`userId`, `provider`). Inserted and deleted, never updated. Columns state `type` and `name`
 * explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'auth_identities', schema: 'public' })
export class AuthIdentity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  @Column({ type: 'enum', name: 'provider', enum: AUTH_PROVIDERS, enumName: 'auth_provider' })
  provider!: AuthProvider;

  /** The provider's `sub` claim. */
  @Column({ type: 'text', name: 'provider_subject' })
  providerSubject!: string;
}
