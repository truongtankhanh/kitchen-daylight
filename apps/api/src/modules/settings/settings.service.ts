import { Inject, Injectable } from '@nestjs/common';
import type { StaleVersionActor } from '@kd/contracts';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { assertRowVersion, staleVersionPayload } from '../../common/concurrency/row-version.js';
import type { RowVersionState } from '../../common/concurrency/row-version.js';
import { ApiError } from '../../common/errors/api-error.js';
import { User } from '../users/entities/user.entity.js';
import { AppSetting } from './entities/app-setting.entity.js';
import { SETTING_SCHEMAS } from './schema/registry.js';
import type { AnySettingSchema, SettingStoredValues, SettingValues } from './schema/registry.js';
import type { BrandSetting } from './schema/brand.schema.js';
import type { OrderingSetting } from './schema/ordering.schema.js';
import type { SettingKey } from './schema/setting-rules.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';

/** One key as the admin reads it (api-outline `/admin/app-settings`, brief L1). */
export interface SettingRecord<Value> {
  readonly value: Value;
  /** `0` for a key that has no row yet: its first save inserts it. */
  readonly rowVersion: number;
  /** Display name of the last editor, never an email; `null` for a seeded or unsaved key. */
  readonly updatedBy: StaleVersionActor | null;
  /** `null` for a key that has no row yet. */
  readonly updatedAt: Date | null;
}

const STALE_DETAIL = 'The record was changed by someone else.';

interface WrittenRow {
  readonly row_version: number;
  readonly updated_at: Date;
}

/**
 * The `app_settings` store (A4-T1): one row per key, a missing row reads as the code default, and
 * a save is checked against the key's `row_version` (brief L1). No endpoint, audit row or outbox
 * event here: A4-T2 and A4-T3 add them around `write`, in the caller's transaction.
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** A key with its concurrency state; the code default with `rowVersion` 0 when it has no row. */
  async get<Key extends SettingKey>(
    key: Key,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<SettingRecord<SettingValues[Key]>> {
    const schema = schemaOf(key);
    const row = await manager.findOne(AppSetting, { where: { key: schema.storageKey } });
    if (row === null) {
      return { value: defaultOf(key), rowVersion: 0, updatedBy: null, updatedAt: null };
    }
    return {
      value: schema.fromStored(row.value as SettingStoredValues[Key]),
      rowVersion: row.rowVersion,
      updatedBy: await this.actorOf(manager, row.updatedBy),
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Saves one key in the caller's transaction. `value` is the camelCase API value, validated here
   * with the key's rules (`400 VALIDATION_FAILED`, fields with the full camelCase path). The
   * update runs `WHERE row_version = :expected`; `expectedRowVersion` 0 inserts the first row, and
   * a concurrent first save loses. A write that touches no row is `409 STALE_VERSION` through the
   * row-version helper (A4-T2 adds the current value to the payload). `actorId` comes from the
   * access token.
   */
  async write<Key extends SettingKey>(
    manager: EntityManager,
    key: Key,
    value: unknown,
    expectedRowVersion: number,
    actorId: string,
  ): Promise<SettingRecord<SettingValues[Key]>> {
    if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 0) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [{ field: 'rowVersion', code: 'OUT_OF_RANGE', message: 'is out of range' }],
      });
    }
    const schema = schemaOf(key);
    const parsed = schema.parse(value);
    if (!parsed.ok) {
      throw new ApiError('VALIDATION_FAILED', { errors: parsed.errors });
    }
    const stored = schema.toStored(parsed.value);

    const row =
      expectedRowVersion === 0
        ? await insertFirst(manager, schema, stored, actorId)
        : await updateAt(manager, schema, stored, expectedRowVersion, actorId);

    if (row === undefined) {
      const current = await this.get(key, manager);
      return staleWrite(expectedRowVersion, current);
    }
    return {
      value: parsed.value,
      rowVersion: row.row_version,
      updatedBy: await this.actorOf(manager, actorId),
      updatedAt: row.updated_at,
    };
  }

  /** `reports.businessDayStartsAt`, the cutoff for common/time/business-date.ts (WA14). */
  async getBusinessDayStart(): Promise<string> {
    return (await this.get('reports')).value.businessDayStartsAt;
  }

  /** The `ordering` key: cart, scheduling, review, auto-cancel and board limits. */
  async getOrderingLimits(): Promise<OrderingSetting> {
    return (await this.get('ordering')).value;
  }

  /** The `brand` key, receipt settings included. */
  async getBrand(): Promise<BrandSetting> {
    return (await this.get('brand')).value;
  }

  private async actorOf(
    manager: EntityManager,
    userId: string | null,
  ): Promise<StaleVersionActor | null> {
    if (userId === null) {
      return null;
    }
    const user = await manager.findOne(User, {
      where: { id: userId },
      select: { id: true, displayName: true },
    });
    return user === null ? null : { id: user.id, name: user.displayName };
  }
}

function schemaOf<Key extends SettingKey>(key: Key): AnySettingSchema<Key> {
  return SETTING_SCHEMAS[key] as AnySettingSchema<Key>;
}

/** A fresh copy of the code default, so a caller can never change the shared constant. */
function defaultOf<Key extends SettingKey>(key: Key): SettingValues[Key] {
  const schema = schemaOf(key);
  return schema.fromStored(schema.toStored(SETTING_DEFAULTS[key]));
}

async function insertFirst<Key extends SettingKey>(
  manager: EntityManager,
  schema: AnySettingSchema<Key>,
  stored: SettingStoredValues[Key],
  actorId: string,
): Promise<WrittenRow | undefined> {
  const result = await manager
    .createQueryBuilder()
    .insert()
    .into(AppSetting)
    .values({ key: schema.storageKey, value: stored, updatedBy: actorId })
    .orIgnore()
    .returning('row_version, updated_at')
    .updateEntity(false)
    .execute();
  return (result.raw as WrittenRow[])[0];
}

/** The trigger bumps `row_version` and `updated_at`; both are read back with `RETURNING`. */
async function updateAt<Key extends SettingKey>(
  manager: EntityManager,
  schema: AnySettingSchema<Key>,
  stored: SettingStoredValues[Key],
  expectedRowVersion: number,
  actorId: string,
): Promise<WrittenRow | undefined> {
  const result = await manager
    .createQueryBuilder()
    .update(AppSetting)
    .set({ value: stored, updatedBy: actorId })
    .where('key = :key AND row_version = :expected', {
      key: schema.storageKey,
      expected: expectedRowVersion,
    })
    .returning('row_version, updated_at')
    .updateEntity(false)
    .execute();
  return (result.raw as WrittenRow[])[0];
}

/**
 * A write that touched no row. A saved key goes through the row-version helper with its current
 * state; a key with no row (an invented version) carries `updatedAt: null` (api-divergences D-103).
 */
function staleWrite(expected: number, current: SettingRecord<unknown>): never {
  if (current.updatedAt === null) {
    throw new ApiError('STALE_VERSION', {
      detail: STALE_DETAIL,
      extras: { current: { rowVersion: 0, updatedBy: null, updatedAt: null } },
    });
  }
  const state: RowVersionState = {
    rowVersion: current.rowVersion,
    updatedBy: current.updatedBy,
    updatedAt: current.updatedAt,
  };
  assertRowVersion(expected, state);
  // Same version yet no row matched: still refused, never written blindly.
  throw new ApiError('STALE_VERSION', {
    detail: STALE_DETAIL,
    extras: { ...staleVersionPayload(state) },
  });
}
