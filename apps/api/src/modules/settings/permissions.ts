import type { STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import type { FeatureFlagsSetting } from './schema/feature-flags.schema.js';

/**
 * The capability keys of `GET /admin/meta/config` `permissions[]` (api-outline AdminMetaConfig,
 * brief Z2; admin-shell-design sections 2 and 5). Working names; a later slice adds its keys here
 * and to the table below. The admin web names the key each menu item and route needs and never
 * repeats this table.
 */
export const PERMISSION_KEYS = [
  'orders.read',
  'orders.write',
  'menu.write',
  'branches.write',
  'reviews.read',
  'reviews.moderate',
  'reports.read',
  'exports.read',
  'promotions.write',
  'invoices.manage',
  'admin.users',
  'admin.settings',
  'admin.email',
  'admin.audit',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type StaffRole = (typeof STAFF_ROLES)[number];

const STAFF_PERMISSIONS: readonly PermissionKey[] = ['orders.read', 'orders.write', 'reviews.read'];

const MANAGER_PERMISSIONS: readonly PermissionKey[] = [
  ...STAFF_PERMISSIONS,
  'menu.write',
  'branches.write',
  'reviews.moderate',
  'reports.read',
  'exports.read',
  'promotions.write',
];

/**
 * The one server-side table from role to capability keys (A4-T2). The role matrix of the design
 * folder is not available to the api track, so the table follows the "Who" column of api-outline:
 * `STAFF` orders and read-only reviews; `MANAGER` adds menu, branches, review moderation, reports,
 * exports and promotions; `ADMIN` everything plus the `admin.*` keys. A proposal for the owner
 * (api-divergences D-112).
 */
export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly PermissionKey[]>> = {
  STAFF: STAFF_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  ADMIN: [
    ...MANAGER_PERMISSIONS,
    'invoices.manage',
    'admin.users',
    'admin.settings',
    'admin.email',
    'admin.audit',
  ],
};

/** Keys granted only while a feature flag is on: e-invoices are deferred (WA17). */
const FEATURE_GATES: Readonly<
  Partial<Record<PermissionKey, (features: FeatureFlagsSetting) => boolean>>
> = {
  'invoices.manage': (features) => features.einvoice,
};

/** The capability keys of `role` under `features`, in the order of `PERMISSION_KEYS`. */
export function permissionsFor(role: StaffRole, features: FeatureFlagsSetting): PermissionKey[] {
  const granted = new Set(ROLE_PERMISSIONS[role]);
  return PERMISSION_KEYS.filter(
    (key) => granted.has(key) && (FEATURE_GATES[key]?.(features) ?? true),
  );
}
