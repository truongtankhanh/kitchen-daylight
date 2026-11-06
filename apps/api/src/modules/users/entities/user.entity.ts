import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Branch } from '../../branches/entities/branch.entity.js';

/** `public.user_role` (migration `0007_users_branches_staff.sql`; ADR-0009). */
export const USER_ROLES = ['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** `public.user_status`. `INVITED` is a staff status (`CHECK users_invited_is_staff`). */
export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * One row of `public.users` (migration `0007_users_branches_staff.sql`): customers and staff in one
 * table, anonymised in place, never deleted. No `row_version` (brief E4). Columns state `type` and
 * `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'users', schema: 'public' })
export class User {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  /** `citext`: unique without regard to case. */
  @Column({ type: 'citext', name: 'email' })
  email!: string;

  /** argon2id PHC string; never logged or returned. */
  @Column({ type: 'text', name: 'password_hash', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'text', name: 'display_name' })
  displayName!: string;

  /** `e164_phone` domain. */
  @Column({ type: 'text', name: 'phone', nullable: true })
  phone!: string | null;

  @Column({ type: 'text', name: 'avatar_url', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'text', name: 'locale' })
  locale!: string;

  @Column({ type: 'enum', name: 'role', enum: USER_ROLES, enumName: 'user_role' })
  role!: UserRole;

  @Column({ type: 'enum', name: 'status', enum: USER_STATUSES, enumName: 'user_status' })
  status!: UserStatus;

  @Column({ type: 'uuid', name: 'preferred_branch_id', nullable: true })
  preferredBranchId!: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'preferred_branch_id', referencedColumnName: 'id' })
  preferredBranch?: Relation<Branch> | null;

  @Column({ type: 'timestamptz', name: 'email_verified_at', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: 'integer', name: 'failed_login_count', default: 0 })
  failedLoginCount!: number;

  @Column({ type: 'timestamptz', name: 'locked_until', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_login_at', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  /** Set by trigger on a profile or account change, not on sign-in bookkeeping. */
  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
