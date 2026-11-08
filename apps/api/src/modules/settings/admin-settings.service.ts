import { Inject, Injectable, Logger } from '@nestjs/common';
import { outboxEvent } from '@kd/contracts';
import type { StaleVersionActor } from '@kd/contracts';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service.js';
import { GateSnapshot } from '../../common/gates/gate-snapshot.js';
import { staleVersionPayload } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import { AuditService } from '../audit/audit.service.js';
import { ACCOUNT_NUMBER_KEPT_DIGITS, sanitizeDiff } from '../audit/sanitize-diff.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth/access-token.service.js';
import { MFA_ROLES } from '../auth/admin-auth.service.js';
import { SESSION_PROFILES } from '../auth/refresh-token.service.js';
import { STAFF_INVITE_TTL_HOURS, STAFF_RESET_TTL_MINUTES } from '../auth/staff-link.service.js';
import { StepUpService } from '../auth/step-up/step-up.service.js';
import type { BranchStatus } from '../branches/entities/branch.entity.js';
import { MailService } from '../mail/mail.service.js';
import { MailDeliveryError } from '../mail/ports/mail.port.js';
import { renderPaymentSettingsNotice } from '../mail/templates/payment-settings-notice.template.js';
import { OutboxService } from '../realtime/outbox.service.js';
import { PASSWORD_MIN_LENGTH } from '../users/password-policy.js';
import { permissionsFor } from './permissions.js';
import type { PermissionKey, StaffRole } from './permissions.js';
import type { BoardThresholds } from './schema/ordering.schema.js';
import type { ReceiptPaperWidth } from './schema/brand.schema.js';
import type { PaymentSetting } from './schema/payment.schema.js';
import { SETTING_SCHEMAS } from './schema/registry.js';
import type { SettingValues } from './schema/registry.js';
import { SETTING_KEYS } from './schema/setting-rules.js';
import type { SettingKey } from './schema/setting-rules.js';
import { SettingsService } from './settings.service.js';
import type { SettingRecord } from './settings.service.js';

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export type SettingActorView = StaleVersionActor;

/** One key as `GET /admin/app-settings` returns it (brief L1). */
export interface SettingRecordView<Value> {
  readonly value: Value;
  readonly rowVersion: number;
  readonly updatedBy: SettingActorView | null;
  readonly updatedAt: string | null;
}

/** Decision 0008 values shown read-only on the Settings page (brief L15); never a stored key. */
export interface SecuritySettingsView {
  readonly totpRequiredRoles: StaffRole[];
  readonly staffPasswordMinLength: number;
  readonly accessTokenMinutes: number;
  readonly sessionIdleDays: number;
  readonly sessionAbsoluteDays: number;
  readonly inviteHours: number;
  readonly resetMinutes: number;
}

export type AdminAppSettingsView = {
  readonly [Key in SettingKey]: SettingRecordView<SettingValues[Key]>;
} & { readonly security: SecuritySettingsView };

export interface SavedSettingView extends SettingRecordView<SettingValues[SettingKey]> {
  readonly key: SettingKey;
}

export interface MetaUserView {
  readonly id: string;
  readonly displayName: string;
  readonly role: StaffRole;
  readonly mfaEnabled: boolean;
}

export interface MetaBranchView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: BranchStatus;
}

export interface MetaOrderingView {
  readonly boardThresholds: BoardThresholds;
  readonly boardRefetchSeconds: number;
}

export interface MetaPaymentView {
  readonly bankName: string | null;
  readonly accountNumber: string | null;
  readonly holder: string | null;
  readonly bankCode: string | null;
  readonly qrUrl: string | null;
}

export interface MetaBrandView {
  readonly hotline: string | null;
  readonly receipt: { readonly paperWidth: ReceiptPaperWidth };
}

export interface AdminMetaConfigView {
  readonly user: MetaUserView;
  readonly branches: MetaBranchView[];
  readonly permissions: PermissionKey[];
  readonly features: SettingValues['featureFlags'];
  readonly ordering: MetaOrderingView;
  readonly payment: MetaPaymentView;
  readonly brand: MetaBrandView;
  readonly reports: SettingValues['reports'];
  readonly maintenance: SettingValues['maintenance'];
  readonly navCountsRefetchSeconds: number;
}

// ---------------------------------------------------------------------------------------------
// Constants and pure assembly (unit-tested in admin-settings.service.spec.ts)
// ---------------------------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How often the sidebar counts are refetched (brief Z4). A code constant, not a settings key. */
export const NAV_COUNTS_REFETCH_SECONDS = 30;

/** The read-only `security` block, from the constants of the auth and users modules. */
export const SECURITY_SETTINGS: SecuritySettingsView = Object.freeze({
  totpRequiredRoles: [...MFA_ROLES],
  staffPasswordMinLength: PASSWORD_MIN_LENGTH.staff,
  accessTokenMinutes: ACCESS_TOKEN_TTL_SECONDS / 60,
  sessionIdleDays: SESSION_PROFILES.staff.idleMs / DAY_MS,
  sessionAbsoluteDays: SESSION_PROFILES.staff.absoluteMs / DAY_MS,
  inviteHours: STAFF_INVITE_TTL_HOURS,
  resetMinutes: STAFF_RESET_TTL_MINUTES,
});

export const ADMIN_SETTINGS_EVENTS = {
  paymentNoticeFailed: 'admin.payment_settings_notice_failed',
} as const;

const STALE_DETAIL = 'The setting was changed by someone else.';

/** `outbox_events.entity_type` of `config.changed`, in the lower case of the other outbox rows. */
export const CONFIG_CHANGED_ENTITY_TYPE = 'app_settings';

export function toRecordView<Value>(record: SettingRecord<Value>): SettingRecordView<Value> {
  return {
    value: record.value,
    rowVersion: record.rowVersion,
    updatedBy: record.updatedBy === null ? null : { ...record.updatedBy },
    updatedAt: record.updatedAt === null ? null : record.updatedAt.toISOString(),
  };
}

/**
 * The value as an error body or an audit diff may hold it: a `payment` value goes through the audit
 * sanitizer, which keeps only the last 5 digits of the account number (`accountNumberLast5`;
 * brief G8, L14). Every other key is returned as it is.
 */
export function shareableValue(key: SettingKey, value: unknown): unknown {
  return key === 'payment' ? sanitizeDiff(value as Readonly<Record<string, unknown>>) : value;
}

/**
 * The `STALE_VERSION` payload of a settings key (api-outline catalogue): `current { rowVersion,
 * updatedBy, updatedAt }` from the row-version helper of A0-T4, plus the current `value`. A key
 * with no row (a version invented by the client) has `updatedAt: null` (api-divergences D-107).
 */
export function staleSettingError(key: SettingKey, current: SettingRecord<unknown>): ApiError {
  const value = shareableValue(key, current.value);
  const state =
    current.updatedAt === null
      ? { rowVersion: current.rowVersion, updatedBy: null, updatedAt: null }
      : staleVersionPayload({
          rowVersion: current.rowVersion,
          updatedBy: current.updatedBy,
          updatedAt: current.updatedAt,
        }).current;
  return new ApiError('STALE_VERSION', {
    detail: STALE_DETAIL,
    extras: { current: { ...state, value } },
  });
}

/**
 * The `diff` of a `settings.change` row: the version step and the whole value before and after.
 * `AuditService.write` sanitizes it as well; this masks the payment value first, so the rule
 * does not depend on the sanitizer alone.
 */
export function settingsAuditDiff(
  key: SettingKey,
  before: SettingRecord<unknown>,
  after: SettingRecord<unknown>,
): Record<string, unknown> {
  return {
    rowVersion: { from: before.rowVersion, to: after.rowVersion },
    before: shareableValue(key, before.value),
    after: shareableValue(key, after.value),
  };
}

/** The last 5 digits of an account number, or `null`. */
export function accountNumberLast5(accountNumber: string | null): string | null {
  return accountNumber === null || accountNumber === ''
    ? null
    : accountNumber.slice(-ACCOUNT_NUMBER_KEPT_DIGITS);
}

export interface MetaConfigInput {
  readonly user: MetaUserView;
  readonly branches: MetaBranchView[];
  readonly featureFlags: SettingValues['featureFlags'];
  readonly ordering: SettingValues['ordering'];
  readonly payment: SettingValues['payment'];
  readonly brand: SettingValues['brand'];
  readonly reports: SettingValues['reports'];
  readonly maintenance: SettingValues['maintenance'];
}

/**
 * `GET /admin/meta/config` from its parts (api-outline AdminMetaConfig): only the fields the
 * shape names, so a new admin-only setting can never leak through it.
 */
export function buildMetaConfig(input: MetaConfigInput): AdminMetaConfigView {
  const { user, featureFlags, ordering, payment, brand, reports, maintenance } = input;
  return {
    user: { ...user },
    branches: input.branches.map((branch) => ({ ...branch })),
    permissions: permissionsFor(user.role, featureFlags),
    features: { ...featureFlags },
    ordering: {
      boardThresholds: {
        accept: { ...ordering.boardThresholds.accept },
        ready: { ...ordering.boardThresholds.ready },
      },
      boardRefetchSeconds: ordering.boardRefetchSeconds,
    },
    payment: {
      bankName: payment.bankName,
      accountNumber: payment.accountNumber,
      holder: payment.accountHolder,
      bankCode: payment.bankCode,
      // The QR image URL needs media uploads (A6-T3).
      qrUrl: null,
    },
    brand: { hotline: brand.hotline, receipt: { paperWidth: brand.receipt.paperWidth } },
    reports: { businessDayStartsAt: reports.businessDayStartsAt },
    maintenance: { ...maintenance },
    navCountsRefetchSeconds: NAV_COUNTS_REFETCH_SECONDS,
  };
}

/** One `config.changed` outbox row for a saved key (api-outline Realtime; brief L9). */
export function configChangedEvent(key: SettingKey, storageKey: string, version: number) {
  return outboxEvent({
    type: 'config.changed',
    audience: 'PUBLIC',
    entityType: CONFIG_CHANGED_ENTITY_TYPE,
    entityId: storageKey,
    version,
    payload: { keys: [key], version },
  });
}

function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'STALE_VERSION';
}

function isStaffRole(role: string): role is StaffRole {
  return role === 'STAFF' || role === 'MANAGER' || role === 'ADMIN';
}

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

/** Locks a saved key for the read of its "before" value; a key with no row locks nothing. */
const LOCK_SETTING_SQL = 'SELECT 1 FROM public.app_settings WHERE key = $1 FOR UPDATE';

const META_USER_SQL = `SELECT u.id::text AS id, u.display_name,
       EXISTS (SELECT 1 FROM public.mfa_credentials m
                WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL) AS mfa_enabled
  FROM public.users u
 WHERE u.id = $1`;

const ALL_BRANCHES_SQL = `SELECT id::text AS id, code, name, status::text AS status
  FROM public.branches
 WHERE deleted_at IS NULL
 ORDER BY sort_order, name, id`;

const BRANCHES_BY_ID_SQL = `SELECT id::text AS id, code, name, status::text AS status
  FROM public.branches
 WHERE deleted_at IS NULL AND id = ANY($1::uuid[])
 ORDER BY sort_order, name, id`;

/** The other admins told about a payment change; the addresses go to the transport only. */
const OTHER_ACTIVE_ADMINS_SQL = `SELECT id::text AS id, email::text AS email
  FROM public.users
 WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1
 ORDER BY id`;

interface MetaUserRow {
  readonly id: string;
  readonly display_name: string;
  readonly mfa_enabled: boolean;
}

interface AdminRecipientRow {
  readonly id: string;
  readonly email: string;
}

export interface SettingSaveInput {
  readonly key: SettingKey;
  readonly value: unknown;
  readonly rowVersion: number;
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/**
 * `/admin/app-settings` and `/admin/meta/config` (A4-T2). The store and the per-key rules are
 * `SettingsService` (A4-T1). A save, its audit row and (A4-T3) its outbox event share one
 * transaction; the snapshot of the request gates is invalidated after the commit, and the payment
 * notice is sent after it and never delays the answer.
 */
@Injectable()
export class AdminSettingsService {
  private readonly logger = new Logger(AdminSettingsService.name);

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(StepUpService) private readonly stepUps: StepUpService,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(GateSnapshot) private readonly gates: GateSnapshot,
  ) {}

  /** Every key with its concurrency state, plus the read-only `security` block. */
  async readAll(): Promise<AdminAppSettingsView> {
    const records: Record<string, SettingRecordView<unknown>> = {};
    for (const key of SETTING_KEYS) {
      records[key] = toRecordView(await this.settings.get(key));
    }
    return { ...records, security: SECURITY_SETTINGS } as unknown as AdminAppSettingsView;
  }

  /**
   * Saves one key. `payment` first needs a step-up token of the caller for `settings.payment`
   * (`403 FORBIDDEN` otherwise, before anything is read or written). A stale version is
   * `409 STALE_VERSION` with the current value; an invalid value `400 VALIDATION_FAILED`.
   */
  async save(
    actor: RequestUser,
    input: SettingSaveInput,
    stepUpToken: string | undefined,
  ): Promise<SavedSettingView> {
    const { key } = input;
    if (key === 'payment') {
      await this.assertPaymentStepUp(actor, stepUpToken);
    }
    const storageKey = SETTING_SCHEMAS[key].storageKey;

    const saved = await this.dataSource.transaction(async (em) => {
      await em.query(LOCK_SETTING_SQL, [storageKey]);
      const before = await this.settings.get(key, em);
      const after = await this.writeOrStale(em, input, actor.id);
      await this.audit.write(
        {
          actorUserId: actor.id,
          action: 'settings.change',
          entityType: 'APP_SETTINGS',
          entityId: storageKey,
          entityLabel: key,
          branchId: null,
          diff: settingsAuditDiff(key, before, after),
        },
        em,
      );
      // `config.changed` (A4-T3): a signal with the key and its version, never the value or the
      // editor; rolled back with the save.
      await this.outbox.add(em, configChangedEvent(key, storageKey, after.rowVersion));
      return after;
    });
    // After the commit, so no request can cache the old value again (common/gates/gate-snapshot.ts).
    this.gates.invalidate();

    if (key === 'payment') {
      // Not awaited: the response never waits for the mail transport (decision 0008 section 5).
      void this.notifyPaymentChange(actor.id, saved as SettingRecord<PaymentSetting>);
    }
    return { key, ...toRecordView(saved) };
  }

  /** What the console needs (api-outline AdminMetaConfig). The role is the access token's. */
  async metaConfig(actor: RequestUser): Promise<AdminMetaConfigView> {
    if (!isStaffRole(actor.role)) {
      throw new ApiError('FORBIDDEN');
    }
    const rows = await this.dataSource.query<MetaUserRow[]>(META_USER_SQL, [actor.id]);
    const row = rows[0];
    if (row === undefined) {
      throw new ApiError('UNAUTHENTICATED');
    }
    const scope = await this.scopes.resolve(actor);
    const branches =
      scope.kind === 'ALL'
        ? await this.dataSource.query<MetaBranchView[]>(ALL_BRANCHES_SQL)
        : scope.branchIds.length === 0
          ? []
          : await this.dataSource.query<MetaBranchView[]>(BRANCHES_BY_ID_SQL, [scope.branchIds]);

    return buildMetaConfig({
      user: {
        id: row.id,
        displayName: row.display_name,
        role: actor.role,
        mfaEnabled: row.mfa_enabled,
      },
      branches,
      featureFlags: (await this.settings.get('featureFlags')).value,
      ordering: (await this.settings.get('ordering')).value,
      payment: (await this.settings.get('payment')).value,
      brand: (await this.settings.get('brand')).value,
      reports: (await this.settings.get('reports')).value,
      maintenance: (await this.settings.get('maintenance')).value,
    });
  }

  private async assertPaymentStepUp(actor: RequestUser, token: string | undefined): Promise<void> {
    if (token === undefined || !(await this.stepUps.verify(token, actor.id, 'settings.payment'))) {
      throw new ApiError('FORBIDDEN', { detail: 'The payment key needs a step-up token.' });
    }
  }

  /** `SettingsService.write`, its stale answer completed with the current value. */
  private async writeOrStale(
    em: EntityManager,
    input: SettingSaveInput,
    actorId: string,
  ): Promise<SettingRecord<SettingValues[SettingKey]>> {
    try {
      return await this.settings.write(em, input.key, input.value, input.rowVersion, actorId);
    } catch (error) {
      if (isStale(error)) {
        throw staleSettingError(input.key, await this.settings.get(input.key, em));
      }
      throw error;
    }
  }

  private async notifyPaymentChange(
    actorId: string,
    saved: SettingRecord<PaymentSetting>,
  ): Promise<void> {
    const templateKey = 'PAYMENT_SETTINGS_NOTICE';
    let recipients: AdminRecipientRow[];
    try {
      recipients = await this.dataSource.query<AdminRecipientRow[]>(OTHER_ACTIVE_ADMINS_SQL, [
        actorId,
      ]);
    } catch {
      this.logger.warn(
        { event: ADMIN_SETTINGS_EVENTS.paymentNoticeFailed, templateKey },
        'Payment settings notice: admins not read',
      );
      return;
    }
    if (recipients.length === 0 || saved.updatedAt === null) {
      return;
    }
    const rendered = renderPaymentSettingsNotice({
      actorName: saved.updatedBy?.name ?? 'Một quản trị viên',
      changedAt: saved.updatedAt,
      accountNumberLast5: accountNumberLast5(saved.value.accountNumber),
    });
    for (const recipient of recipients) {
      try {
        await this.mail.send({ ...rendered, to: recipient.email });
      } catch (error) {
        this.logger.warn(
          {
            event: ADMIN_SETTINGS_EVENTS.paymentNoticeFailed,
            userId: recipient.id,
            templateKey,
            errorCode: error instanceof MailDeliveryError ? error.code : undefined,
          },
          'Payment settings notice not delivered',
        );
      }
    }
  }
}
