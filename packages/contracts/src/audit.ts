// Audit catalogue shared by the API and the admin web (data-model `audit_logs`, brief G1, G2, G7;
// decision 0007 contradiction row 4).
// - `AuditAction` is the catalogue: lower-case `group.verb` codes. The Vietnamese labels live in
//   the UI. Each slice that writes an audit row appends its codes here in the same change; the
//   "21 codes" of data-model is not a constraint (decision 0007 section 11, answer 6).
// - `AuditEntityType` mirrors the PostgreSQL enum `audit_entity_type` (migration
//   `0003_audit_logs.sql`); a new value needs an `ALTER TYPE` migration in the same change.

/**
 * Kind of record an audit row is about: the eight values of data-model, then the four proposed by
 * brief G2 (proposals until the owner confirms them; api-divergences D-019).
 */
export const AUDIT_ENTITY_TYPES = [
  'ORDER',
  'MENU_ITEM',
  'VOUCHER',
  'USER',
  'REVIEW',
  'BRANCH',
  'APP_SETTINGS',
  'EXPORT_JOB',
  // Proposed (brief G2).
  'RESERVATION',
  'PROMOTION',
  'REVIEW_REPORT',
  'DELIVERY_ZONE',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * The action codes named so far by data-model (`audit_logs` row) and api-outline ("Audit actions
 * named by the gaps"). Every name is a proposal of the design gaps (brief G7) unless marked
 * otherwise; the count found is recorded in api-divergences D-017.
 */
export const AUDIT_ACTIONS = [
  // Contact reveal of an order, a customer (entity USER) or a reservation phone. Proposal
  // (brief A16, E13, P4).
  'order.contact_reveal',
  // Staff account management, each with a before and after diff. Proposals (brief E8).
  'user.create',
  'user.role_change',
  'user.branch_change',
  'user.disable',
  'user.enable',
  'user.password_reset_send',
  // Review report decision, diff { decision, note, reviewStatus { from, to }, appliedTo[] }.
  // Proposal (brief V18).
  'report.decision',
  // Explicit overwrite of a stale menu item, with the replaced values. Proposal, name to confirm
  // (brief B20).
  'menu.overwrite',
  // Branch pin confirmed, old and new coordinates. Proposal (brief C9).
  'branch.location_confirm',
  // Delivery zones, old and new diff. Proposals (brief C25).
  'delivery_zone.create',
  'delivery_zone.update',
  'delivery_zone.delete',
  // Promotions. Proposals (brief M23).
  'promotion.create',
  'promotion.update',
  'promotion.delete',
  'promotion.reorder',
  'promotion.toggle',
  // One settings key saved, entity APP_SETTINGS with the key as entity id. Proposal (brief L10).
  'settings.change',
  // Reservation edited by a manager, before and after and the reason. Proposal (brief P27).
  'reservation.edit',
  // Manual points adjustment. Marked "existing" by api-outline, not a gap proposal.
  'points.adjust',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
