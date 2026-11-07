import { Inject, Injectable, Logger } from '@nestjs/common';
import { outboxEvent } from '@kd/contracts';
import type { Paged, SessionRevokedReason } from '@kd/contracts';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { maskEmail, maskPhone } from '../../common/masking/masking.js';
import { toOffset } from '../../common/pagination/page-query.dto.js';
import { normalizeVietnamMobile } from '../../common/phone/vietnam-phone.js';
import type { AuditAction } from '../audit/audit-actions.js';
import { assertEntityLabel, AuditService } from '../audit/audit.service.js';
import { MfaCredential } from '../auth/entities/mfa-credential.entity.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { StaffLinkService } from '../auth/staff-link.service.js';
import type { StaffLinkIssue } from '../auth/staff-link.service.js';
import { MailService } from '../mail/mail.service.js';
import { MailDeliveryError } from '../mail/ports/mail.port.js';
import { renderMfaResetNotice } from '../mail/templates/mfa-reset-notice.template.js';
import { OutboxService } from '../realtime/outbox.service.js';
import { CUSTOMER_STATS_PORT, EMPTY_CUSTOMER_STATS } from './customer-stats.port.js';
import type { CustomerStats, CustomerStatsPort } from './customer-stats.port.js';
import type { AdminSettableStatus } from './dto/admin-user-input.dto.js';
import { normalizeEmail } from './email.js';
import { User } from './entities/user.entity.js';
import type { UserRole, UserStatus } from './entities/user.entity.js';
import { EmailTakenError, UsersService } from './users.service.js';

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles whose sign-in needs the second factor (ADR-0009 WA4). */
const MFA_REQUIRED_ROLES: readonly UserRole[] = ['MANAGER', 'ADMIN'];
/** Roles that must work at one branch at least (data-model `staff_branches`). */
const BRANCH_ROLES: readonly UserRole[] = ['STAFF', 'MANAGER'];
/** Locale of a new staff account; the admin web is Vietnamese. */
const STAFF_LOCALE = 'vi';

/** Audit codes of this service (catalogue in `@kd/contracts`; brief E8, E9, E13). */
export const ADMIN_USERS_AUDIT = {
  create: 'user.create',
  roleChange: 'user.role_change',
  branchChange: 'user.branch_change',
  displayNameChange: 'user.display_name_change',
  disable: 'user.disable',
  enable: 'user.enable',
  passwordResetSend: 'user.password_reset_send',
  inviteResend: 'user.invite_resend',
  mfaReset: 'user.mfa_reset',
  contactReveal: 'order.contact_reveal',
} as const satisfies Readonly<Record<string, AuditAction>>;

/** The `event` field of this service's log lines: user ids only, never an address. */
export const ADMIN_USERS_EVENTS = {
  mfaNoticeFailed: 'admin.mfa_reset_notice_failed',
} as const;

export interface AdminUserBranchView {
  readonly id: string;
  readonly code: string;
}

export interface AdminUserMfaView {
  readonly required: boolean;
  readonly enabled: boolean;
  readonly enabledAt: string | null;
}

export interface AdminStaffUserView {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly status: UserStatus;
  readonly branches: readonly AdminUserBranchView[];
  readonly mfa: AdminUserMfaView;
  readonly lastLoginAt: string | null;
}

export interface AdminCustomerUserView {
  readonly id: string;
  readonly role: 'CUSTOMER';
  readonly displayName: string;
  readonly emailMasked: string | null;
  readonly phoneMasked: string | null;
  readonly status: UserStatus;
  readonly ordersCount: number;
  readonly lastOrderAt: string | null;
  readonly pointsBalance: number;
  readonly completedOrders: number;
}

export type AdminUserView = AdminStaffUserView | AdminCustomerUserView;

export interface AdminUserPage extends Paged<AdminUserView> {
  readonly activeAdminsWithMfa: number;
}

export interface AdminUserContactView {
  readonly email: string;
  readonly phone: string | null;
}

export interface AdminUsersQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string | undefined;
  readonly role?: UserRole | undefined;
  readonly roles?: readonly UserRole[] | undefined;
  readonly scope?: 'staff' | undefined;
  readonly status?: UserStatus | undefined;
  readonly branchId?: string | undefined;
}

export interface NewStaffInput {
  readonly displayName: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly branchIds?: readonly string[] | undefined;
}

export interface UserChange {
  readonly displayName?: string | undefined;
  readonly role?: StaffRole | undefined;
  readonly status?: AdminSettableStatus | undefined;
  readonly branchIds?: readonly string[] | undefined;
}

/** The acting admin, from the access token. */
export interface AdminActor {
  readonly id: string;
}

/**
 * `resend-invite` and `reset-password`: sent, or refused by the 60 s rule (brief E10) or the daily
 * cap of 5 links in 24 h (decision 0008 section 6); both refusals are `RATE_LIMITED` (D-088).
 */
export type LinkSendResult =
  | { readonly sent: true }
  | {
      readonly sent: false;
      readonly reason: 'RESEND_TOO_SOON' | 'DAILY_CAP';
      readonly retryAfterSeconds: number;
    };

/** Role and status, the two fields the access guards read. */
export interface AccessState {
  readonly role: UserRole;
  readonly status: UserStatus;
}

export type SessionEventType = 'user.suspended' | 'session.revoked';

export interface SessionEffects {
  readonly revokeSessions: boolean;
  readonly events: readonly SessionEventType[];
}

// ---------------------------------------------------------------------------------------------
// Guard and effect rules, pure (unit-tested in admin-users.service.spec.ts).
// ---------------------------------------------------------------------------------------------

/** The same ids, in any order. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((id) => left.has(id));
}

/** Whether `role` keeps `staff_branches` rows (`ADMIN` ignores the table, customers have none). */
export function usesBranches(role: UserRole): boolean {
  return BRANCH_ROLES.includes(role);
}

/**
 * The access fields `change` really alters: `role`, `status`, and `branchIds` while the account
 * (after the change) works at branches. A field equal to the current value is not a change.
 */
export function changedAccessFields(
  current: AccessState,
  currentBranchIds: readonly string[],
  change: UserChange,
): ('role' | 'status' | 'branchIds')[] {
  const fields: ('role' | 'status' | 'branchIds')[] = [];
  if (change.role !== undefined && change.role !== current.role) {
    fields.push('role');
  }
  if (change.status !== undefined && change.status !== current.status) {
    fields.push('status');
  }
  const nextRole = change.role ?? current.role;
  if (
    change.branchIds !== undefined &&
    usesBranches(nextRole) &&
    !sameIdSet(change.branchIds, currentBranchIds)
  ) {
    fields.push('branchIds');
  }
  return fields;
}

/** `SELF_CHANGE`: an admin never changes their own role, status or branches (brief E1). */
export function assertNotSelfChange(
  actorId: string,
  targetId: string,
  changed: readonly string[],
): void {
  if (actorId === targetId && changed.length > 0) {
    throw new ApiError('SELF_CHANGE', {
      detail: 'An administrator cannot change their own role, status or branches.',
    });
  }
}

export function isActiveAdmin(state: AccessState): boolean {
  return state.role === 'ADMIN' && state.status === 'ACTIVE';
}

/**
 * `LAST_ADMIN`: the target is an `ACTIVE` `ADMIN`, will not be one after the change, and is the
 * only one. Counts every `ACTIVE` admin, with or without a second factor: whether only admins with
 * MFA count is open (api-outline open item 16, brief E5; api-divergences D-092).
 */
export function leavesNoActiveAdmin(
  before: AccessState,
  after: AccessState,
  activeAdminCount: number,
): boolean {
  return isActiveAdmin(before) && !isActiveAdmin(after) && activeAdminCount <= 1;
}

/**
 * What a change does to the person's sessions (brief E6): a role change revokes every refresh
 * token and emits `session.revoked`; a suspension revokes and emits `user.suspended`; a branch or
 * display name change, a re-activation and a withdrawn invitation's role edit end nothing more.
 */
export function sessionEffectsOf(before: AccessState, after: AccessState): SessionEffects {
  const events: SessionEventType[] = [];
  if (before.role !== after.role) {
    events.push('session.revoked');
  }
  if (before.status !== 'SUSPENDED' && after.status === 'SUSPENDED') {
    events.push('user.suspended');
  }
  return { revokeSessions: events.length > 0, events };
}

/**
 * The status a `PATCH` really sets. Re-enabling (`SUSPENDED` → `ACTIVE`) a staff account that never
 * set a password, a withdrawn invitation, reinstates the invitation (`INVITED`) instead of an
 * `ACTIVE` account nobody can sign in to (api-divergences D-096).
 */
export function resolvedStatus(
  target: AccessState & { readonly hasPassword: boolean },
  requested: AdminSettableStatus | undefined,
): UserStatus {
  if (requested === undefined) {
    return target.status;
  }
  const neverActivated = target.role !== 'CUSTOMER' && !target.hasPassword;
  return target.status === 'SUSPENDED' && requested === 'ACTIVE' && neverActivated
    ? 'INVITED'
    : requested;
}

/** A customer account accepts `status` only (api-divergences D-091). */
export function customerFieldErrors(change: UserChange): ApiFieldError[] {
  return (['displayName', 'role', 'branchIds'] as const)
    .filter((field) => change[field] !== undefined)
    .map((field) => ({
      field,
      code: 'INVALID' as const,
      message: 'not accepted for a customer account',
    }));
}

/** The audit code of a status move, or `null` when the status does not change. */
export function statusAuditAction(from: UserStatus, to: UserStatus): AuditAction | null {
  if (from === to) {
    return null;
  }
  return to === 'SUSPENDED' ? ADMIN_USERS_AUDIT.disable : ADMIN_USERS_AUDIT.enable;
}

/** `%`, `_` and `\` taken literally in a `LIKE … ESCAPE '\'` pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/**
 * The roles a list query asks for: the intersection of `role`, `roles` and `scope`; every role
 * when none is given.
 */
export function rolesOf(query: Pick<AdminUsersQuery, 'role' | 'roles' | 'scope'>): UserRole[] {
  let roles: readonly UserRole[] = ['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'];
  if (query.scope === 'staff') {
    roles = roles.filter((role) => role !== 'CUSTOMER');
  }
  if (query.role !== undefined) {
    const only = query.role;
    roles = roles.filter((role) => role === only);
  }
  if (query.roles !== undefined) {
    const allowed = new Set(query.roles);
    roles = roles.filter((role) => allowed.has(role));
  }
  return [...roles];
}

/** The display name as an audit label, or `null` when it looks like an email (brief G4). */
function auditLabel(displayName: string): string | null {
  try {
    assertEntityLabel(displayName);
    return displayName;
  } catch {
    return null;
  }
}

function notFound(): ApiError {
  return new ApiError('NOT_FOUND');
}

// ---------------------------------------------------------------------------------------------
// Read model.
// ---------------------------------------------------------------------------------------------

interface UserRow {
  readonly id: string;
  readonly display_name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly last_login_at: Date | null;
}

interface BranchRow {
  readonly user_id: string;
  readonly id: string;
  readonly code: string;
}

interface MfaRow {
  readonly user_id: string;
  readonly enabled_at: Date | null;
}

const USER_COLUMNS = 'u.id, u.display_name, u.email, u.phone, u.role, u.status, u.last_login_at';

const BRANCHES_OF_SQL = `SELECT sb.user_id, b.id, b.code
  FROM public.staff_branches sb JOIN public.branches b ON b.id = sb.branch_id
 WHERE sb.user_id = ANY($1::uuid[])
 ORDER BY b.sort_order, b.code`;

const MFA_OF_SQL = `SELECT user_id, enabled_at FROM public.mfa_credentials
 WHERE user_id = ANY($1::uuid[])`;

const ACTIVE_ADMINS_WITH_MFA_SQL = `SELECT count(*)::int AS total
  FROM public.users u JOIN public.mfa_credentials m ON m.user_id = u.id
 WHERE u.role = 'ADMIN' AND u.status = 'ACTIVE' AND m.enabled_at IS NOT NULL`;

/** Locks every `ACTIVE` admin in id order, so concurrent demotions are counted one at a time. */
const LOCK_ACTIVE_ADMINS_SQL = `SELECT id FROM public.users
 WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toStaffView(
  row: UserRow,
  branches: readonly AdminUserBranchView[],
  enabledAt: Date | null | undefined,
): AdminStaffUserView {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role as StaffRole,
    status: row.status,
    branches: usesBranches(row.role) ? branches : [],
    mfa: {
      required: MFA_REQUIRED_ROLES.includes(row.role),
      enabled: enabledAt !== null && enabledAt !== undefined,
      enabledAt: iso(enabledAt ?? null),
    },
    lastLoginAt: iso(row.last_login_at),
  };
}

function toCustomerView(row: UserRow, stats: CustomerStats): AdminCustomerUserView {
  return {
    id: row.id,
    role: 'CUSTOMER',
    displayName: row.display_name,
    emailMasked: maskEmail(row.email),
    phoneMasked: maskPhone(row.phone),
    status: row.status,
    ordersCount: stats.ordersCount,
    lastOrderAt: iso(stats.lastOrderAt),
    pointsBalance: stats.pointsBalance,
    completedOrders: stats.completedOrders,
  };
}

/**
 * Staff and customer accounts for the `ADMIN` (A3-T4; api-outline "Users and operations", brief
 * E1 to E14; ADR-0009 WA20). Every method takes the acting admin from the access token. Lists
 * never return a full customer contact: it leaves only through `revealContact`, which is audited.
 * No audit diff, log line or error holds an email, a phone, a token or a hash.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshTokenService) private readonly tokens: RefreshTokenService,
    @Inject(StaffLinkService) private readonly links: StaffLinkService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(CUSTOMER_STATS_PORT) private readonly stats: CustomerStatsPort,
  ) {}

  /**
   * `GET /admin/users`. Staff match `q` as a fragment of the display name (accent and case
   * insensitive, `kd_unaccent`) or of the email; customers only by the full email or the full
   * phone after normalisation (brief E2). Newest accounts first.
   */
  async list(query: AdminUsersQuery): Promise<AdminUserPage> {
    const parameters: unknown[] = [];
    const bind = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const conditions: string[] = [`u.role = ANY(${bind(rolesOf(query))}::public.user_role[])`];
    conditions.push(
      query.status === undefined
        ? `u.status <> 'DELETED'`
        : `u.status = ${bind(query.status)}::public.user_status`,
    );
    if (query.branchId !== undefined) {
      conditions.push(`EXISTS (SELECT 1 FROM public.staff_branches sb
        WHERE sb.user_id = u.id AND sb.branch_id = ${bind(query.branchId)}::uuid)`);
    }
    const q = query.q?.trim() ?? '';
    if (q !== '') {
      const fragment = bind(escapeLike(q.toLowerCase()));
      const staffMatch = `(u.role <> 'CUSTOMER' AND (
          public.kd_unaccent(lower(u.display_name)) LIKE '%' || public.kd_unaccent(${fragment}) || '%' ESCAPE '\\'
          OR lower(u.email::text) LIKE '%' || ${fragment} || '%' ESCAPE '\\'))`;
      const customerMatch = `(u.role = 'CUSTOMER' AND (u.email = ${bind(normalizeEmail(q))}
          OR u.phone = ${bind(normalizeVietnamMobile(q))}))`;
      conditions.push(`(${staffMatch} OR ${customerMatch})`);
    }
    const where = conditions.join(' AND ');
    const { offset, limit } = toOffset(query);
    const countParameters = [...parameters];
    const rows: UserRow[] = await this.dataSource.query(
      `SELECT ${USER_COLUMNS} FROM public.users u WHERE ${where}
        ORDER BY u.created_at DESC, u.id DESC OFFSET ${bind(offset)} LIMIT ${bind(limit)}`,
      parameters,
    );
    const counted: { total: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM public.users u WHERE ${where}`,
      countParameters,
    );
    const admins: { total: number }[] = await this.dataSource.query(ACTIVE_ADMINS_WITH_MFA_SQL);
    return {
      items: await this.viewsOf(rows),
      page: query.page,
      pageSize: query.pageSize,
      total: counted[0]?.total ?? 0,
      activeAdminsWithMfa: admins[0]?.total ?? 0,
    };
  }

  /**
   * `POST /admin/users`: an `INVITED` account with its branches, then the invitation link (after
   * the commit, since the link service locks the new row in its own transaction).
   */
  async create(actor: AdminActor, input: NewStaffInput): Promise<AdminStaffUserView> {
    const branchIds = usesBranches(input.role) ? [...(input.branchIds ?? [])] : [];
    const created = await this.dataSource.transaction(async (em) => {
      if (usesBranches(input.role)) {
        await this.assertBranches(em, branchIds);
      }
      let user: User;
      try {
        user = await this.users.createInvitedStaff(
          {
            email: input.email,
            displayName: input.displayName,
            locale: STAFF_LOCALE,
            role: input.role,
          },
          em,
        );
      } catch (error) {
        if (error instanceof EmailTakenError) {
          throw new ApiError('ALREADY_EXISTS', { detail: 'The email is already in use.' });
        }
        throw error;
      }
      await this.replaceBranches(em, user.id, [], branchIds);
      await this.audit.write(
        {
          actorUserId: actor.id,
          action: ADMIN_USERS_AUDIT.create,
          entityType: 'USER',
          entityId: user.id,
          entityLabel: auditLabel(user.displayName),
          diff: {
            role: { from: null, to: input.role },
            status: { from: null, to: 'INVITED' },
            branchIds: { from: [], to: branchIds },
          },
        },
        em,
      );
      return user;
    });

    // A new account has no link yet, so neither the 60 s rule nor the daily cap can refuse it.
    await this.links.issueInvite(created.id);
    return (await this.viewOf(created.id)) as AdminStaffUserView;
  }

  /**
   * `PATCH /admin/users/{id}` (brief E1, E4, E6, I1). Admins are locked first (id order), then the
   * target, so that `LAST_ADMIN` holds for concurrent changes. Every effect is in one transaction:
   * the change, the revoked sessions, the outbox events and the audit rows.
   */
  async update(actor: AdminActor, userId: string, change: UserChange): Promise<AdminUserView> {
    const reinvited = await this.dataSource.transaction(async (em) => {
      const touchesAccess = change.role !== undefined || change.status !== undefined;
      const activeAdmins = touchesAccess ? await this.lockActiveAdmins(em) : 0;
      const target = await this.lockTarget(em, userId);
      if (target.role === 'CUSTOMER') {
        const errors = customerFieldErrors(change);
        if (errors.length > 0) {
          throw new ApiError('VALIDATION_FAILED', { errors });
        }
      }

      const currentBranchIds = await this.branchIdsOf(em, userId);
      assertNotSelfChange(actor.id, userId, changedAccessFields(target, currentBranchIds, change));
      if (target.status === 'INVITED' && change.status === 'ACTIVE') {
        throw new ApiError('INVALID_STATE', {
          detail: 'An invited account becomes active through its invitation link.',
        });
      }

      const before: AccessState = { role: target.role, status: target.status };
      const after: AccessState = {
        role: change.role ?? target.role,
        status: resolvedStatus(
          { role: target.role, status: target.status, hasPassword: target.passwordHash !== null },
          change.status,
        ),
      };
      if (leavesNoActiveAdmin(before, after, activeAdmins)) {
        throw new ApiError('LAST_ADMIN', {
          detail: 'At least one active administrator must remain.',
        });
      }

      const nextBranchIds = usesBranches(after.role)
        ? [...(change.branchIds ?? currentBranchIds)]
        : currentBranchIds;
      const branchesChange =
        usesBranches(after.role) && !sameIdSet(nextBranchIds, currentBranchIds);
      if (usesBranches(after.role) && (before.role !== after.role || branchesChange)) {
        await this.assertBranches(em, nextBranchIds);
      }

      const label = auditLabel(change.displayName ?? target.displayName);
      const write = (action: AuditAction, diff: Record<string, unknown>): Promise<void> =>
        this.audit.write(
          {
            actorUserId: actor.id,
            action,
            entityType: 'USER',
            entityId: userId,
            entityLabel: label,
            diff,
          },
          em,
        );

      if (change.displayName !== undefined && change.displayName !== target.displayName) {
        await this.setColumn(em, userId, { displayName: change.displayName });
        await write(ADMIN_USERS_AUDIT.displayNameChange, {
          displayName: { from: target.displayName, to: change.displayName },
        });
      }
      if (before.role !== after.role) {
        await this.setColumn(em, userId, { role: after.role });
        await write(ADMIN_USERS_AUDIT.roleChange, { role: { from: before.role, to: after.role } });
      }
      const statusAction = statusAuditAction(before.status, after.status);
      if (statusAction !== null) {
        // Checks the move and, for a suspension, revokes every refresh token (A1-T5).
        await this.users.transition(userId, after.status, em);
        await write(statusAction, { status: { from: before.status, to: after.status } });
      }
      if (branchesChange) {
        await this.replaceBranches(em, userId, currentBranchIds, nextBranchIds);
        // No session ends; the realtime room rebuild is A10 (brief E6, I1).
        await write(ADMIN_USERS_AUDIT.branchChange, {
          branchIds: { from: currentBranchIds, to: nextBranchIds },
        });
      }

      const effects = sessionEffectsOf(before, after);
      if (effects.revokeSessions) {
        await this.tokens.revokeAllForUser(userId, em);
      }
      for (const type of effects.events) {
        await this.emitSessionEvent(em, userId, type, 'ROLE_CHANGE');
      }
      return before.status === 'SUSPENDED' && after.status === 'INVITED';
    });

    if (reinvited) {
      // After the commit, as for a new account (the link service locks the row itself). A refusal
      // (60 s, daily cap) leaves the account INVITED: the admin resends the invitation later.
      await this.links.issueInvite(userId);
    }
    return this.viewOf(userId);
  }

  /**
   * `POST /admin/users/{id}/reset-password`: a reset link to an `ACTIVE` staff account. An
   * `INVITED` account is `INVALID_STATE` (brief E7: resend the invitation instead); a customer
   * resets with a code, a suspended account cannot sign in: both `INVALID_STATE`.
   */
  async sendPasswordReset(actor: AdminActor, userId: string): Promise<LinkSendResult> {
    const target = await this.requireTarget(userId);
    if (target.role === 'CUSTOMER' || target.status !== 'ACTIVE') {
      throw new ApiError('INVALID_STATE', {
        detail:
          target.status === 'INVITED'
            ? 'The account is invited: resend the invitation instead.'
            : 'Only an active staff account receives a reset link.',
      });
    }
    return this.afterLink(
      actor,
      target,
      await this.links.issueReset(userId),
      ADMIN_USERS_AUDIT.passwordResetSend,
    );
  }

  /**
   * `POST /admin/users/{id}/resend-invite` (brief E10): a new invitation link that expires the old
   * one; `INVALID_STATE` unless the account is `INVITED`; at most once per 60 s per person.
   */
  async resendInvite(actor: AdminActor, userId: string): Promise<LinkSendResult> {
    const target = await this.requireTarget(userId);
    if (target.status !== 'INVITED') {
      throw new ApiError('INVALID_STATE', { detail: 'The account is no longer invited.' });
    }
    return this.afterLink(
      actor,
      target,
      await this.links.issueInvite(userId),
      ADMIN_USERS_AUDIT.inviteResend,
    );
  }

  /**
   * `POST /admin/users/{id}/mfa-reset` (brief E9; WA20): never on oneself (`SELF_CHANGE`);
   * `MFA_NOT_ENABLED` without a confirmed credential. Deletes it, revokes every session, emits
   * `session.revoked` and writes the audit row in one transaction; then mails the notice.
   */
  async resetMfa(actor: AdminActor, userId: string): Promise<void> {
    if (actor.id === userId) {
      throw new ApiError('SELF_CHANGE', {
        detail: 'An administrator cannot reset their own second factor.',
      });
    }
    const target = await this.dataSource.transaction(async (em) => {
      const user = await this.lockTarget(em, userId);
      const deleted = await em
        .createQueryBuilder()
        .delete()
        .from(MfaCredential)
        .where('user_id = :userId AND enabled_at IS NOT NULL', { userId })
        .execute();
      if ((deleted.affected ?? 0) === 0) {
        throw new ApiError('MFA_NOT_ENABLED');
      }
      await this.tokens.revokeAllForUser(userId, em);
      await this.emitSessionEvent(em, userId, 'session.revoked', 'MFA_RESET');
      await this.audit.write(
        {
          actorUserId: actor.id,
          action: ADMIN_USERS_AUDIT.mfaReset,
          entityType: 'USER',
          entityId: userId,
          entityLabel: auditLabel(user.displayName),
          diff: { mfaEnabled: { from: true, to: false } },
        },
        em,
      );
      return user;
    });
    // Not awaited: the response never waits for the mail transport (decision 0008 section 5).
    void this.sendMfaNotice(target);
  }

  /**
   * `POST /admin/users/{id}/reveal-contact` (brief E13): the full email and phone, after the
   * `order.contact_reveal` row (entity `USER`) is written. No reason (owner, 2026-11-03).
   */
  async revealContact(actor: AdminActor, userId: string): Promise<AdminUserContactView> {
    const target = await this.requireTarget(userId);
    await this.audit.write({
      actorUserId: actor.id,
      action: ADMIN_USERS_AUDIT.contactReveal,
      entityType: 'USER',
      entityId: userId,
      entityLabel: auditLabel(target.displayName),
    });
    return { email: target.email, phone: target.phone };
  }

  private async afterLink(
    actor: AdminActor,
    target: User,
    result: StaffLinkIssue,
    action: AuditAction,
  ): Promise<LinkSendResult> {
    if (result.issued) {
      await this.audit.write({
        actorUserId: actor.id,
        action,
        entityType: 'USER',
        entityId: target.id,
        entityLabel: auditLabel(target.displayName),
      });
      return { sent: true };
    }
    switch (result.reason) {
      case 'RESEND_TOO_SOON':
      case 'DAILY_CAP':
        // An admin action, not a public route: nothing to hide, so the admin is told (D-088).
        return {
          sent: false,
          reason: result.reason,
          retryAfterSeconds: result.retryAfterSeconds,
        };
      case 'NOT_ELIGIBLE':
        // The account changed between the check and the link (a parallel request).
        throw new ApiError('INVALID_STATE', { detail: 'The account changed; reload it.' });
    }
  }

  private async emitSessionEvent(
    em: EntityManager,
    userId: string,
    type: SessionEventType,
    reason: SessionRevokedReason,
  ): Promise<void> {
    const scope = {
      entityType: 'user',
      entityId: userId,
      audience: 'USER',
      audienceUserId: userId,
    } as const;
    await this.outbox.add(
      em,
      type === 'user.suspended'
        ? outboxEvent({ ...scope, type, payload: { userId } })
        : outboxEvent({ ...scope, type, payload: { userId, reason } }),
    );
  }

  private async sendMfaNotice(user: User): Promise<void> {
    const rendered = renderMfaResetNotice();
    try {
      await this.mail.send({ ...rendered, to: user.email });
    } catch (error) {
      this.logger.warn(
        {
          event: ADMIN_USERS_EVENTS.mfaNoticeFailed,
          userId: user.id,
          templateKey: rendered.templateKey,
          errorCode: error instanceof MailDeliveryError ? error.code : undefined,
        },
        'MFA reset notice not delivered',
      );
    }
  }

  /** The account, unless unknown or `DELETED` (a tombstone is not managed here). */
  private async requireTarget(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (user === null || user.status === 'DELETED') {
      throw notFound();
    }
    return user;
  }

  private async lockTarget(em: EntityManager, userId: string): Promise<User> {
    const user = await em.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (user === null || user.status === 'DELETED') {
      throw notFound();
    }
    return user;
  }

  /** Locks and counts the `ACTIVE` admins (the one count of `LAST_ADMIN`, D-092). */
  private async lockActiveAdmins(em: EntityManager): Promise<number> {
    const rows: unknown[] = await em.query(LOCK_ACTIVE_ADMINS_SQL);
    return rows.length;
  }

  private async branchIdsOf(em: EntityManager, userId: string): Promise<string[]> {
    const rows: { branch_id: string }[] = await em.query(
      'SELECT branch_id FROM public.staff_branches WHERE user_id = $1 ORDER BY branch_id',
      [userId],
    );
    return rows.map((row) => row.branch_id);
  }

  /** At least one branch, every one existing (data-model `staff_branches`). */
  private async assertBranches(em: EntityManager, branchIds: readonly string[]): Promise<void> {
    if (branchIds.length === 0) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [
          { field: 'branchIds', code: 'REQUIRED', message: 'STAFF and MANAGER need a branch' },
        ],
      });
    }
    const found: { id: string }[] = await em.query(
      'SELECT id FROM public.branches WHERE id = ANY($1::uuid[])',
      [branchIds],
    );
    if (found.length !== new Set(branchIds).size) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [{ field: 'branchIds', code: 'NOT_FOUND', message: 'a branch does not exist' }],
      });
    }
  }

  private async replaceBranches(
    em: EntityManager,
    userId: string,
    current: readonly string[],
    next: readonly string[],
  ): Promise<void> {
    const removed = current.filter((id) => !next.includes(id));
    const added = next.filter((id) => !current.includes(id));
    if (removed.length > 0) {
      await em.query(
        'DELETE FROM public.staff_branches WHERE user_id = $1 AND branch_id = ANY($2::uuid[])',
        [userId, removed],
      );
    }
    if (added.length > 0) {
      await em.query(
        `INSERT INTO public.staff_branches (user_id, branch_id)
         SELECT $1, unnest($2::uuid[])`,
        [userId, added],
      );
    }
  }

  private async setColumn(
    em: EntityManager,
    userId: string,
    values: Partial<Pick<User, 'displayName' | 'role'>>,
  ): Promise<void> {
    await em
      .createQueryBuilder()
      .update(User)
      .set(values)
      .where('id = :id', { id: userId })
      .updateEntity(false)
      .execute();
  }

  private async viewOf(userId: string): Promise<AdminUserView> {
    const rows: UserRow[] = await this.dataSource.query(
      `SELECT ${USER_COLUMNS} FROM public.users u WHERE u.id = $1`,
      [userId],
    );
    const [view] = await this.viewsOf(rows);
    if (view === undefined) {
      throw notFound();
    }
    return view;
  }

  /** Staff items with branches and MFA state, customer items masked with their figures. */
  private async viewsOf(rows: readonly UserRow[]): Promise<AdminUserView[]> {
    const staffIds = rows.filter((row) => row.role !== 'CUSTOMER').map((row) => row.id);
    const customerIds = rows.filter((row) => row.role === 'CUSTOMER').map((row) => row.id);
    const [branchRows, mfaRows, stats] = await Promise.all([
      staffIds.length > 0
        ? (this.dataSource.query(BRANCHES_OF_SQL, [staffIds]) as Promise<BranchRow[]>)
        : Promise.resolve([] as BranchRow[]),
      staffIds.length > 0
        ? (this.dataSource.query(MFA_OF_SQL, [staffIds]) as Promise<MfaRow[]>)
        : Promise.resolve([] as MfaRow[]),
      customerIds.length > 0
        ? this.stats.statsFor(customerIds)
        : Promise.resolve(new Map<string, CustomerStats>()),
    ]);
    const branches = new Map<string, AdminUserBranchView[]>();
    for (const row of branchRows) {
      const list = branches.get(row.user_id) ?? [];
      list.push({ id: row.id, code: row.code });
      branches.set(row.user_id, list);
    }
    const mfa = new Map(mfaRows.map((row) => [row.user_id, row.enabled_at]));
    return rows.map((row) =>
      row.role === 'CUSTOMER'
        ? toCustomerView(row, stats.get(row.id) ?? EMPTY_CUSTOMER_STATS)
        : toStaffView(row, branches.get(row.id) ?? [], mfa.get(row.id)),
    );
  }
}
