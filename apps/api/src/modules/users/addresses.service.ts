import { Inject, Injectable } from '@nestjs/common';
import type { Paged } from '@kd/contracts';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import type { ApiFieldError } from '../../common/errors/api-error.js';
import { toOffset } from '../../common/pagination/page-query.dto.js';
import { normalizeVietnamMobile } from '../../common/phone/vietnam-phone.js';

/**
 * Saved addresses per customer: 10, accepted by the owner on 2026-11-07 (api-divergences D-065;
 * api-outline open item 27, mobile G46). Soft-deleted rows do not count.
 */
export const MAX_SAVED_ADDRESSES = 10;

/** A map pin in WGS 84 degrees. */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** One address as `/me/addresses` returns it (api-divergences D-064). */
export interface AddressView {
  readonly id: string;
  readonly label: string;
  readonly recipientName: string;
  readonly phone: string;
  readonly addressLine: string;
  readonly provinceCode: string;
  readonly wardCode: string | null;
  readonly location: GeoPoint;
  readonly deliveryNote: string | null;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AddressPage = Paged<AddressView>;

/** The validated body of `POST` or `PATCH /me/addresses`: `undefined` keeps a field. */
export interface AddressInput {
  readonly label?: string | undefined;
  readonly recipientName?: string | undefined;
  readonly phone?: string | undefined;
  readonly addressLine?: string | undefined;
  readonly provinceCode?: string | undefined;
  readonly wardCode?: string | null | undefined;
  readonly location?: GeoPoint | undefined;
  readonly deliveryNote?: string | null | undefined;
  readonly isDefault?: boolean | undefined;
}

/** The column values a write sets; a key is present only when the body named the field. */
export interface AddressChanges {
  label?: string;
  recipientName?: string;
  phone?: string;
  addressLine?: string;
  provinceCode?: string;
  wardCode?: string | null;
  location?: GeoPoint;
  /** `deliveryNote` of the API. */
  note?: string | null;
  isDefault?: boolean;
}

/** The values of a new address: every required column is set. */
export type NewAddress = AddressChanges &
  Required<
    Pick<
      AddressChanges,
      'label' | 'recipientName' | 'phone' | 'addressLine' | 'provinceCode' | 'location'
    >
  >;

/** One row of `ADDRESS_COLUMNS`. */
export interface AddressRow {
  readonly id: string;
  readonly label: string;
  readonly recipient_name: string;
  readonly phone: string;
  readonly address_line: string;
  readonly province_code: string;
  readonly ward_code: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly note: string | null;
  readonly is_default: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The province and ward checks of one write. */
export interface UnitLookup {
  readonly provinceFound: boolean;
  /** `true` when no ward is set. */
  readonly wardFound: boolean;
}

const REQUIRED_TEXT_FIELDS = ['label', 'recipientName', 'addressLine'] as const;
const REQUIRED_FIELDS = [
  ...REQUIRED_TEXT_FIELDS,
  'phone',
  'provinceCode',
  'location',
] as const satisfies readonly (keyof AddressInput)[];

const REQUIRED_MESSAGE = 'is required';

/**
 * The location is read back with `ST_Y` and `ST_X`; nothing else returns it, and it is never
 * logged or put in an error.
 */
export const ADDRESS_COLUMNS = `id, label, recipient_name, phone, address_line, province_code,
       ward_code, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, note,
       is_default, created_at, updated_at`;

/** The pin as a parameterised expression: `lng` first (`x`), then `lat` (`y`). */
function pointSql(lngParameter: number, latParameter: number): string {
  return `ST_SetSRID(ST_MakePoint($${lngParameter}::double precision, $${latParameter}::double precision), 4326)::geography`;
}

export const INSERT_ADDRESS_SQL = `INSERT INTO public.customer_addresses
  (user_id, label, recipient_name, phone, address_line, province_code, ward_code, location, note,
   is_default)
  VALUES ($1, $2, $3, $4, $5, $6, $7, ${pointSql(8, 9)}, $10, $11)
  RETURNING ${ADDRESS_COLUMNS}`;

/** Runs before any write that sets a default, because of `customer_addresses_one_default_idx`. */
export const CLEAR_DEFAULT_SQL = `UPDATE public.customer_addresses SET is_default = false
  WHERE user_id = $1 AND is_default AND deleted_at IS NULL`;

export const COUNT_ACTIVE_SQL = `SELECT count(*)::int AS total FROM public.customer_addresses
  WHERE user_id = $1 AND deleted_at IS NULL`;

/**
 * Serialises the address writes of one customer, so that the limit count and the default switch
 * of two parallel requests cannot interleave. `FOR NO KEY UPDATE` does not block the
 * `FOR KEY SHARE` locks of foreign-key checks on `users`.
 */
export const LOCK_OWNER_SQL = 'SELECT id FROM public.users WHERE id = $1 FOR NO KEY UPDATE';

export const LOOKUP_UNITS_SQL = `SELECT
  EXISTS (SELECT 1 FROM public.provinces WHERE code = $1) AS province_found,
  ($2::text IS NULL
    OR EXISTS (SELECT 1 FROM public.wards WHERE code = $2 AND province_code = $1)) AS ward_found`;

/**
 * The input rules, without the database: a missing field is not changed (with `requireAll`, a
 * missing required field is `REQUIRED`); `label`, `recipientName` and `addressLine` are trimmed and
 * may not be blank (`REQUIRED`); `phone` is normalised to E.164 (`INVALID_PHONE` otherwise);
 * `deliveryNote` is trimmed into `note`, and a blank one or `null` means no note; `wardCode`
 * `null` clears the ward. Every field error is collected; no rejected value is put in an error.
 */
export function planAddressInput(
  input: AddressInput,
  options: { readonly requireAll: boolean },
): { readonly changes: AddressChanges; readonly errors: readonly ApiFieldError[] } {
  const changes: AddressChanges = {};
  const errors: ApiFieldError[] = [];

  if (options.requireAll) {
    for (const field of REQUIRED_FIELDS) {
      if (input[field] === undefined) {
        errors.push({ field, code: 'REQUIRED', message: REQUIRED_MESSAGE });
      }
    }
  }

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = input[field]?.trim();
    if (value === undefined) {
      continue;
    }
    if (value === '') {
      errors.push({ field, code: 'REQUIRED', message: REQUIRED_MESSAGE });
    } else {
      changes[field] = value;
    }
  }

  if (input.phone !== undefined) {
    const phone = normalizeVietnamMobile(input.phone);
    if (phone === null) {
      errors.push({
        field: 'phone',
        code: 'INVALID_PHONE',
        message: 'must be a Vietnamese mobile number',
      });
    } else {
      changes.phone = phone;
    }
  }

  if (input.provinceCode !== undefined) {
    changes.provinceCode = input.provinceCode;
  }
  if (input.wardCode !== undefined) {
    changes.wardCode = input.wardCode;
  }
  if (input.location !== undefined) {
    changes.location = { lat: input.location.lat, lng: input.location.lng };
  }
  if (input.deliveryNote !== undefined) {
    const note = input.deliveryNote?.trim() ?? '';
    changes.note = note === '' ? null : note;
  }
  if (input.isDefault !== undefined) {
    changes.isDefault = input.isDefault;
  }

  return { changes, errors };
}

export function isNewAddress(changes: AddressChanges): changes is NewAddress {
  return REQUIRED_FIELDS.every((field) => changes[field] !== undefined);
}

/**
 * Whether a write must clear the customer's current default before it sets its own: only when it
 * asks for `isDefault: true` on an address that is not the default yet. Clear first, then set,
 * or the partial unique index refuses the second default.
 */
export function mustClearPreviousDefault(
  requested: boolean | undefined,
  isDefaultNow: boolean,
): boolean {
  return requested === true && !isDefaultNow;
}

/**
 * `LIMIT_REACHED` on the field `address` when the customer already has `MAX_SAVED_ADDRESSES`
 * addresses not deleted, else `null`.
 */
export function addressLimitError(
  activeCount: number,
  max: number = MAX_SAVED_ADDRESSES,
): ApiFieldError | null {
  return activeCount >= max
    ? { field: 'address', code: 'LIMIT_REACHED', message: `at most ${max} saved addresses` }
    : null;
}

/**
 * `NOT_FOUND` on `provinceCode` for an unknown province named by the body; otherwise `NOT_FOUND`
 * on `wardCode` for an unknown ward or one outside the province (the same field code as
 * `PATCH /me`, api-divergences D-061 and D-066).
 */
export function unitFieldErrors(lookup: UnitLookup): ApiFieldError[] {
  if (!lookup.provinceFound) {
    return [{ field: 'provinceCode', code: 'NOT_FOUND', message: 'does not exist' }];
  }
  if (!lookup.wardFound) {
    return [{ field: 'wardCode', code: 'NOT_FOUND', message: 'does not exist in this province' }];
  }
  return [];
}

export function toAddressView(row: AddressRow): AddressView {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    phone: row.phone,
    addressLine: row.address_line,
    provinceCode: row.province_code,
    wardCode: row.ward_code,
    location: { lat: row.lat, lng: row.lng },
    deliveryNote: row.note,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The `SET` list and parameters of a `PATCH`; parameters `$1` and `$2` are the id and the user. */
export function buildAddressUpdate(
  changes: AddressChanges,
  current: Pick<AddressRow, 'is_default'>,
): { readonly sets: readonly string[]; readonly parameters: readonly unknown[] } {
  const sets: string[] = [];
  const parameters: unknown[] = [];
  const add = (column: string, value: unknown): void => {
    parameters.push(value);
    sets.push(`${column} = $${parameters.length + 2}`);
  };

  if (changes.label !== undefined) add('label', changes.label);
  if (changes.recipientName !== undefined) add('recipient_name', changes.recipientName);
  if (changes.phone !== undefined) add('phone', changes.phone);
  if (changes.addressLine !== undefined) add('address_line', changes.addressLine);
  if (changes.provinceCode !== undefined) add('province_code', changes.provinceCode);
  if (changes.wardCode !== undefined) add('ward_code', changes.wardCode);
  if (changes.location !== undefined) {
    parameters.push(changes.location.lng, changes.location.lat);
    sets.push(`location = ${pointSql(parameters.length + 1, parameters.length + 2)}`);
  }
  if (changes.note !== undefined) add('note', changes.note);
  if (changes.isDefault !== undefined && changes.isDefault !== current.is_default) {
    add('is_default', changes.isDefault);
  }
  return { sets, parameters };
}

/** `manager.query` answers an `UPDATE … RETURNING` with `[rows, rowCount]` (TypeORM, postgres). */
function returnedRows<Row>(result: unknown): Row[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as Row[]) : [];
}

/**
 * The signed-in customer's delivery address book (api-outline `/me/addresses`, A2-T5). Every query
 * is filtered by the user id of the access token; an address of another user, a deleted one or no
 * address answers `NOT_FOUND`. Writes run in one transaction under a lock of the owner's `users`
 * row (`LOCK_OWNER_SQL`). Nothing is logged and no audit row is written, so the phone and the
 * coordinates never reach a log.
 */
@Injectable()
export class AddressesService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** One page, the default first, then the newest. A page past the end has no items. */
  async list(
    userId: string,
    query: { readonly page: number; readonly pageSize: number },
  ): Promise<AddressPage> {
    const { offset, limit } = toOffset(query);
    const rows: AddressRow[] = await this.dataSource.query(
      `SELECT ${ADDRESS_COLUMNS} FROM public.customer_addresses
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at DESC, id DESC
        OFFSET $2 LIMIT $3`,
      [userId, offset, limit],
    );
    const counted: { total: number }[] = await this.dataSource.query(COUNT_ACTIVE_SQL, [userId]);
    return {
      items: rows.map(toAddressView),
      page: query.page,
      pageSize: query.pageSize,
      total: counted[0]?.total ?? 0,
    };
  }

  async get(userId: string, id: string): Promise<AddressView> {
    return toAddressView(await this.requireOwned(this.dataSource.manager, userId, id, false));
  }

  /**
   * In order: the field errors of the body and of the province and ward lookup, together; then the
   * limit (`LIMIT_REACHED`); then, for `isDefault: true`, the previous default is cleared before
   * the insert. The first address is not made the default on its own.
   */
  async create(userId: string, input: AddressInput): Promise<AddressView> {
    const { changes, errors } = planAddressInput(input, { requireAll: true });
    return this.dataSource.transaction(async (manager) => {
      await this.lockOwner(manager, userId);
      const fieldErrors = [...errors];
      if (changes.provinceCode !== undefined) {
        fieldErrors.push(
          ...(await this.unitErrors(manager, changes.provinceCode, changes.wardCode ?? null)),
        );
      }
      if (fieldErrors.length > 0 || !isNewAddress(changes)) {
        throw new ApiError('VALIDATION_FAILED', { errors: fieldErrors });
      }

      const counted: { total: number }[] = await manager.query(COUNT_ACTIVE_SQL, [userId]);
      const limitError = addressLimitError(counted[0]?.total ?? 0);
      if (limitError !== null) {
        throw new ApiError('VALIDATION_FAILED', { errors: [limitError] });
      }

      if (mustClearPreviousDefault(changes.isDefault, false)) {
        await manager.query(CLEAR_DEFAULT_SQL, [userId]);
      }
      const rows: AddressRow[] = await manager.query(INSERT_ADDRESS_SQL, [
        userId,
        changes.label,
        changes.recipientName,
        changes.phone,
        changes.addressLine,
        changes.provinceCode,
        changes.wardCode ?? null,
        changes.location.lng,
        changes.location.lat,
        changes.note ?? null,
        changes.isDefault ?? false,
      ]);
      return toAddressView(rows[0] as AddressRow);
    });
  }

  /**
   * Applies `planAddressInput` to an owned address. A province or ward change is checked against
   * the other one, sent or kept: a kept ward outside a new province is `NOT_FOUND` on `wardCode`.
   * `isDefault: true` clears the previous default first; `false` unsets it and chooses no other.
   * An empty body changes nothing and returns the address.
   */
  async update(userId: string, id: string, input: AddressInput): Promise<AddressView> {
    const { changes, errors } = planAddressInput(input, { requireAll: false });
    return this.dataSource.transaction(async (manager) => {
      await this.lockOwner(manager, userId);
      const current = await this.requireOwned(manager, userId, id, true);
      const fieldErrors = [...errors];
      if (changes.provinceCode !== undefined || changes.wardCode !== undefined) {
        fieldErrors.push(
          ...(await this.unitErrors(
            manager,
            changes.provinceCode ?? current.province_code,
            changes.wardCode === undefined ? current.ward_code : changes.wardCode,
          )),
        );
      }
      if (fieldErrors.length > 0) {
        throw new ApiError('VALIDATION_FAILED', { errors: fieldErrors });
      }

      const { sets, parameters } = buildAddressUpdate(changes, current);
      if (sets.length === 0) {
        return toAddressView(current);
      }
      if (mustClearPreviousDefault(changes.isDefault, current.is_default)) {
        await manager.query(CLEAR_DEFAULT_SQL, [userId]);
      }
      const result: unknown = await manager.query(
        `UPDATE public.customer_addresses SET ${sets.join(', ')}
          WHERE id = $1 AND user_id = $2
          RETURNING ${ADDRESS_COLUMNS}`,
        [id, userId, ...parameters],
      );
      return toAddressView(returnedRows<AddressRow>(result)[0] as AddressRow);
    });
  }

  /**
   * Soft delete (`deleted_at`). Deleting the default chooses no other one (mobile G101); there is
   * no restore (mobile G100).
   */
  async remove(userId: string, id: string): Promise<void> {
    const result: unknown = await this.dataSource.query(
      `UPDATE public.customer_addresses SET deleted_at = now()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [id, userId],
    );
    if (returnedRows(result).length === 0) {
      throw new ApiError('NOT_FOUND');
    }
  }

  /** The token's user; a missing row (an id from a token that outlived it) is `UNAUTHENTICATED`. */
  private async lockOwner(manager: EntityManager, userId: string): Promise<void> {
    const rows: unknown[] = await manager.query(LOCK_OWNER_SQL, [userId]);
    if (rows.length === 0) {
      throw new ApiError('UNAUTHENTICATED');
    }
  }

  private async requireOwned(
    manager: EntityManager,
    userId: string,
    id: string,
    forUpdate: boolean,
  ): Promise<AddressRow> {
    const rows: AddressRow[] = await manager.query(
      `SELECT ${ADDRESS_COLUMNS} FROM public.customer_addresses
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, userId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ApiError('NOT_FOUND');
    }
    return row;
  }

  private async unitErrors(
    manager: EntityManager,
    provinceCode: string,
    wardCode: string | null,
  ): Promise<ApiFieldError[]> {
    const rows: { province_found: boolean; ward_found: boolean }[] = await manager.query(
      LOOKUP_UNITS_SQL,
      [provinceCode, wardCode],
    );
    const row = rows[0];
    return unitFieldErrors({
      provinceFound: row?.province_found ?? false,
      wardFound: row?.ward_found ?? false,
    });
  }
}
