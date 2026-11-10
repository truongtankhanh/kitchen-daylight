import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BranchMedia } from '../../src/modules/branches/entities/branch-media.entity.js';
import { BranchMenuItem } from '../../src/modules/menu/entities/branch-menu-item.entity.js';
import { ItemOption } from '../../src/modules/menu/entities/item-option.entity.js';
import { MenuItemTag } from '../../src/modules/menu/entities/menu-item-tag.entity.js';
import { MenuItem } from '../../src/modules/menu/entities/menu-item.entity.js';
import { Tag } from '../../src/modules/menu/entities/tag.entity.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppDataSource,
  openAppRole,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0015_menu.sql (A6-T4). Fictional data only.

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';
/** SQLSTATE `foreign_key_violation`: an insert that references a missing row. */
const FOREIGN_KEY_VIOLATION = '23503';
/**
 * SQLSTATE `restrict_violation`: a delete refused by `ON DELETE RESTRICT`. PostgreSQL 18 raises
 * 23001 here, not 23503 (`foreign_key_violation`, NO ACTION), as the A1-T3 run showed
 * (branch-details-schema.int-spec.ts).
 */
const RESTRICT_VIOLATION = '23001';

const BRANCH_ID = '01900000-0000-7000-8000-0000000000b1';
const MANAGER_ID = '01900000-0000-7000-8000-0000000000a1';
const MEDIA_IDS = [
  '01900000-0000-7000-8000-00000000d001',
  '01900000-0000-7000-8000-00000000d002',
  '01900000-0000-7000-8000-00000000d003',
] as const;
const UNKNOWN_MEDIA_ID = '01900000-0000-7000-8000-00000000dfff';

type Table =
  | 'menu_categories'
  | 'menu_items'
  | 'menu_item_translations'
  | 'tags'
  | 'menu_item_tags'
  | 'item_option_groups'
  | 'item_options'
  | 'menu_item_media'
  | 'branch_media'
  | 'branch_menu_items'
  | 'media';

type Values = Readonly<Record<string, unknown>>;

const CATEGORY_ROW: Values = {
  slug: 'mon-chinh',
  names: '{"vi": "Món chính", "en": "Mains"}',
  sort_order: 1,
  is_active: true,
};

const TAG_ROW: Values = {
  kind: 'ALLERGEN',
  slug: 'dau-phong',
  names: '{"vi": "Đậu phộng", "en": "Peanut"}',
};

describe('menu schema (migration 0015)', () => {
  let app: RoleClient;
  let dataSource: DataSource;

  /** Inserts one row as `kd_app`; returns the `id` column when the table has one. */
  async function insert(table: Table, values: Values, returning = 'NULL AS id'): Promise<string> {
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const rows = await app.query<{ id: string }>(
      `INSERT INTO public.${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
       RETURNING ${returning}`,
      Object.values(values),
    );
    return rows[0]?.id ?? '';
  }

  function insertId(table: Table, values: Values): Promise<string> {
    return insert(table, values, 'id');
  }

  async function insertMedia(id: string, n: number): Promise<void> {
    await insertId('media', {
      id,
      storage_key: `media/2027/01/${id}`,
      content_type: 'image/webp',
      width: 800,
      height: 600,
      bytes: 1024,
      sha256: n.toString(16).padStart(64, '0'),
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    });
  }

  /** A category and one item in it; returns both ids. */
  async function insertItem(
    overrides: Values = {},
  ): Promise<{ categoryId: string; itemId: string }> {
    const categoryId = await insertId('menu_categories', CATEGORY_ROW);
    const itemId = await insertId('menu_items', {
      slug: 'com-tam',
      category_id: categoryId,
      base_price: 55000,
      sort_order: 1,
      is_active: false,
      ...overrides,
    });
    return { categoryId, itemId };
  }

  async function insertGroup(itemId: string, overrides: Values = {}): Promise<string> {
    return insertId('item_option_groups', {
      menu_item_id: itemId,
      names: '{"vi": "Kích cỡ", "en": "Size"}',
      min_select: 1,
      max_select: 1,
      sort_order: 1,
      ...overrides,
    });
  }

  function optionRow(groupId: string, overrides: Values = {}): Values {
    return {
      group_id: groupId,
      names: '{"vi": "Lớn"}',
      price_delta: 10000,
      is_default: false,
      is_active: true,
      sort_order: 1,
      ...overrides,
    };
  }

  function branchMenuRow(itemId: string, overrides: Values = {}): Values {
    return { branch_id: BRANCH_ID, menu_item_id: itemId, is_available: true, ...overrides };
  }

  /** Runs `work` in one transaction on the `kd_app` connection; rolls back when it throws. */
  async function inTransaction(work: () => Promise<void>): Promise<void> {
    await app.query('BEGIN');
    try {
      await work();
    } catch (error) {
      await app.query('ROLLBACK');
      throw error;
    }
  }

  beforeAll(async () => {
    app = await openAppRole();
    dataSource = await openAppDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ userIds: [MANAGER_ID], branchIds: [BRANCH_ID] });
  });

  describe("names ? 'vi' (testing-strategy, CHECK constraints)", () => {
    it.each([
      ['names without vi', '{"en": "Mains"}'],
      ['names that are an array holding vi', '["vi"]'],
    ])('menu_categories rejects %s', async (_case, names) => {
      await expectSqlState(insert('menu_categories', { ...CATEGORY_ROW, names }), CHECK_VIOLATION);
    });

    it.each([
      ['names without vi', '{"en": "Peanut"}'],
      ['names that are an array holding vi', '["vi"]'],
    ])('tags rejects %s', async (_case, names) => {
      await expectSqlState(insert('tags', { ...TAG_ROW, names }), CHECK_VIOLATION);
    });

    it('item_option_groups rejects names without vi', async () => {
      const { itemId } = await insertItem();

      await expectSqlState(insertGroup(itemId, { names: '{"en": "Size"}' }), CHECK_VIOLATION);
    });

    it('item_options rejects names without vi', async () => {
      const { itemId } = await insertItem();
      const groupId = await insertGroup(itemId);

      await expectSqlState(
        insert('item_options', optionRow(groupId, { names: '{"en": "Large"}' })),
        CHECK_VIOLATION,
      );
    });
  });

  describe('menu_categories and menu_items', () => {
    it('keeps slugs unique', async () => {
      const { categoryId } = await insertItem();

      await expectSqlState(insert('menu_categories', CATEGORY_ROW), UNIQUE_VIOLATION);
      await expectSqlState(
        insert('menu_items', {
          slug: 'com-tam',
          category_id: categoryId,
          base_price: 1,
          sort_order: 2,
          is_active: false,
        }),
        UNIQUE_VIOLATION,
      );
    });

    it('accepts a free item and an item with no prep time', async () => {
      await expect(insertItem({ base_price: 0, prep_minutes: null })).resolves.toMatchObject({
        itemId: expect.any(String),
      });
    });

    it.each([
      ['a negative base_price', { base_price: -1 }],
      ['prep_minutes of 0', { prep_minutes: 0 }],
    ])('rejects %s', async (_case, overrides) => {
      await expectSqlState(insertItem(overrides), CHECK_VIOLATION);
    });

    it('refuses to delete a category that an item uses, soft-deleted or not', async () => {
      const { categoryId, itemId } = await insertItem();
      await app.query('UPDATE public.menu_items SET deleted_at = now() WHERE id = $1', [itemId]);

      await expectSqlState(
        app.query('DELETE FROM public.menu_categories WHERE id = $1', [categoryId]),
        RESTRICT_VIOLATION,
      );
    });

    it('deletes an empty category', async () => {
      const categoryId = await insertId('menu_categories', CATEGORY_ROW);

      expect(
        await app.query('DELETE FROM public.menu_categories WHERE id = $1 RETURNING id', [
          categoryId,
        ]),
      ).toHaveLength(1);
    });

    it('bumps row_version and updated_at of an item, whatever the statement sets', async () => {
      const { itemId } = await insertItem({ updated_at: '2020-01-01T00:00:00Z' });

      const rows = await app.query<{ row_version: number; moved: boolean }>(
        `UPDATE public.menu_items SET base_price = 60000, updated_by = $2, row_version = 99
         WHERE id = $1
         RETURNING row_version, updated_at > '2020-01-01T00:00:00Z' AS moved`,
        [itemId, MANAGER_ID],
      );

      expect(rows).toEqual([{ row_version: 2, moved: true }]);
    });

    it('maps an item through the entity', async () => {
      const { categoryId, itemId } = await insertItem();

      const item = await dataSource.getRepository(MenuItem).findOneByOrFail({ id: itemId });

      expect(item).toMatchObject({
        categoryId,
        basePrice: 55000,
        prepMinutes: null,
        isActive: false,
        rowVersion: 1,
        updatedBy: null,
        deletedAt: null,
      });
    });
  });

  describe('menu_item_translations (api-divergences D-152)', () => {
    it.each([
      ['a vi row without description', { locale: 'vi', name: 'Cơm tấm' }],
      [
        'a 120-character name and a 2000-character description',
        { locale: 'en', name: 'a'.repeat(120), description: 'b'.repeat(2000) },
      ],
    ])('accepts %s', async (_case, values) => {
      const { itemId } = await insertItem();

      await expect(
        insert('menu_item_translations', { menu_item_id: itemId, ...values }),
      ).resolves.toBe('');
    });

    it.each([
      ['an empty name', { name: '' }],
      ['a 121-character name', { name: 'a'.repeat(121) }],
      ['a 2001-character description', { name: 'Cơm tấm', description: 'b'.repeat(2001) }],
    ])('rejects %s', async (_case, values) => {
      const { itemId } = await insertItem();

      await expectSqlState(
        insert('menu_item_translations', { menu_item_id: itemId, locale: 'vi', ...values }),
        CHECK_VIOLATION,
      );
    });

    it('keeps one row per item and locale', async () => {
      const { itemId } = await insertItem();
      const row = { menu_item_id: itemId, locale: 'vi', name: 'Cơm tấm' };
      await insert('menu_item_translations', row);

      await expectSqlState(insert('menu_item_translations', row), UNIQUE_VIOLATION);
    });
  });

  describe('tags and menu_item_tags', () => {
    it('rejects an unknown kind', async () => {
      // 22P02 invalid_text_representation: the native enum refuses the value.
      await expectSqlState(insert('tags', { ...TAG_ROW, kind: 'OTHER' }), '22P02');
    });

    it('keeps slug unique', async () => {
      await insertId('tags', TAG_ROW);

      await expectSqlState(insert('tags', TAG_ROW), UNIQUE_VIOLATION);
    });

    it.each([
      ['an unverified claim', {}],
      ['a verified claim', { verified_at: '2027-01-02T03:04:05Z', verified_by: MANAGER_ID }],
    ])('accepts %s', async (_case, overrides) => {
      const { itemId } = await insertItem();
      const tagId = await insertId('tags', TAG_ROW);

      await expect(
        insert('menu_item_tags', { menu_item_id: itemId, tag_id: tagId, ...overrides }),
      ).resolves.toBe('');
    });

    it.each([
      ['verified_at without verified_by', { verified_at: '2027-01-02T03:04:05Z' }],
      ['verified_by without verified_at', { verified_by: MANAGER_ID }],
    ])('rejects %s', async (_case, overrides) => {
      const { itemId } = await insertItem();
      const tagId = await insertId('tags', TAG_ROW);

      await expectSqlState(
        insert('menu_item_tags', { menu_item_id: itemId, tag_id: tagId, ...overrides }),
        CHECK_VIOLATION,
      );
    });

    it('refuses to delete a tag that an item uses', async () => {
      const { itemId } = await insertItem();
      const tagId = await insertId('tags', TAG_ROW);
      await insert('menu_item_tags', { menu_item_id: itemId, tag_id: tagId });

      await expectSqlState(
        app.query('DELETE FROM public.tags WHERE id = $1', [tagId]),
        RESTRICT_VIOLATION,
      );
    });

    it('bumps row_version of a tag on an edit', async () => {
      const tagId = await insertId('tags', TAG_ROW);

      const rows = await app.query<{ row_version: number }>(
        `UPDATE public.tags SET kind = 'DIETARY' WHERE id = $1 RETURNING row_version`,
        [tagId],
      );

      expect(rows).toEqual([{ row_version: 2 }]);
    });

    it('maps a tag and a verified link through the entities', async () => {
      const { itemId } = await insertItem();
      const tagId = await insertId('tags', TAG_ROW);
      await insert('menu_item_tags', {
        menu_item_id: itemId,
        tag_id: tagId,
        verified_at: '2027-01-02T03:04:05Z',
        verified_by: MANAGER_ID,
      });

      const tag = await dataSource.getRepository(Tag).findOneByOrFail({ id: tagId });
      const link = await dataSource.getRepository(MenuItemTag).findOneByOrFail({ tagId });

      expect(tag).toMatchObject({ kind: 'ALLERGEN', names: { vi: 'Đậu phộng', en: 'Peanut' } });
      expect(link).toMatchObject({ menuItemId: itemId, verifiedBy: MANAGER_ID });
      expect(link.verifiedAt?.toISOString()).toBe('2027-01-02T03:04:05.000Z');
    });
  });

  describe('item_option_groups and item_options (option group min and max)', () => {
    it.each([
      ['exactly one choice', { min_select: 1, max_select: 1 }],
      ['zero to three choices', { min_select: 0, max_select: 3 }],
    ])('accepts %s', async (_case, overrides) => {
      const { itemId } = await insertItem();

      await expect(insertGroup(itemId, overrides)).resolves.toEqual(expect.any(String));
    });

    it.each([
      ['min_select above max_select', { min_select: 2, max_select: 1 }],
      ['a negative min_select', { min_select: -1, max_select: 1 }],
    ])('rejects %s', async (_case, overrides) => {
      const { itemId } = await insertItem();

      await expectSqlState(insertGroup(itemId, overrides), CHECK_VIOLATION);
    });

    it('accepts a price_delta of 0 and rejects a negative one', async () => {
      const { itemId } = await insertItem();
      const groupId = await insertGroup(itemId);

      const optionId = await insertId('item_options', optionRow(groupId, { price_delta: 0 }));
      await expectSqlState(
        insert('item_options', optionRow(groupId, { price_delta: -1 })),
        CHECK_VIOLATION,
      );

      const option = await dataSource.getRepository(ItemOption).findOneByOrFail({ id: optionId });
      expect(option).toMatchObject({ groupId, priceDelta: 0, isDefault: false, isActive: true });
    });
  });

  describe('branch_menu_items', () => {
    it('accepts an untracked row and a tracked one at 0', async () => {
      const { itemId } = await insertItem();

      await insert('branch_menu_items', branchMenuRow(itemId));
      await app.query(
        `UPDATE public.branch_menu_items SET stock_qty = 0, low_stock_threshold = 0,
                price_override = 1 WHERE menu_item_id = $1`,
        [itemId],
      );

      const row = await dataSource
        .getRepository(BranchMenuItem)
        .findOneByOrFail({ branchId: BRANCH_ID, menuItemId: itemId });
      expect(row).toMatchObject({ stockQty: 0, lowStockThreshold: 0, priceOverride: 1 });
    });

    it.each([
      ['price_override of 0', { price_override: 0 }],
      ['stock_qty of -1', { stock_qty: -1 }],
      ['low_stock_threshold of -1', { low_stock_threshold: -1 }],
    ])('rejects %s', async (_case, overrides) => {
      const { itemId } = await insertItem();

      await expectSqlState(
        insert('branch_menu_items', branchMenuRow(itemId, overrides)),
        CHECK_VIOLATION,
      );
    });

    it('bumps row_version on a staff edit but not on a stock change (D-157)', async () => {
      const { itemId } = await insertItem();
      await insert('branch_menu_items', branchMenuRow(itemId, { stock_qty: 10 }));

      const afterStock = await app.query<{ row_version: number }>(
        `UPDATE public.branch_menu_items SET stock_qty = stock_qty - 1
         WHERE branch_id = $1 AND menu_item_id = $2 RETURNING row_version`,
        [BRANCH_ID, itemId],
      );
      const afterEdit = await app.query<{ row_version: number }>(
        `UPDATE public.branch_menu_items SET is_available = false, updated_by = $3
         WHERE branch_id = $1 AND menu_item_id = $2 RETURNING row_version`,
        [BRANCH_ID, itemId, MANAGER_ID],
      );

      expect(afterStock).toEqual([{ row_version: 1 }]);
      expect(afterEdit).toEqual([{ row_version: 2 }]);
    });

    it('deletes a row when the branch stops selling the item', async () => {
      const { itemId } = await insertItem();
      await insert('branch_menu_items', branchMenuRow(itemId));

      expect(
        await app.query(
          `DELETE FROM public.branch_menu_items WHERE branch_id = $1 AND menu_item_id = $2
           RETURNING menu_item_id`,
          [BRANCH_ID, itemId],
        ),
      ).toHaveLength(1);
    });
  });

  describe('branch_media, menu_item_media and branches.cover_media_id', () => {
    beforeEach(async () => {
      for (const [index, id] of MEDIA_IDS.entries()) {
        await insertMedia(id, index + 1);
      }
    });

    it('swaps two positions of a branch gallery inside one transaction', async () => {
      await insert('branch_media', { branch_id: BRANCH_ID, media_id: MEDIA_IDS[0], position: 0 });
      await insert('branch_media', { branch_id: BRANCH_ID, media_id: MEDIA_IDS[1], position: 1 });

      await inTransaction(async () => {
        await app.query(
          'UPDATE public.branch_media SET position = 1 WHERE branch_id = $1 AND media_id = $2',
          [BRANCH_ID, MEDIA_IDS[0]],
        );
        await app.query(
          'UPDATE public.branch_media SET position = 0 WHERE branch_id = $1 AND media_id = $2',
          [BRANCH_ID, MEDIA_IDS[1]],
        );
        await app.query('COMMIT');
      });

      const rows = await dataSource
        .getRepository(BranchMedia)
        .find({ where: { branchId: BRANCH_ID }, order: { position: 'ASC' } });
      expect(rows.map(({ mediaId, position }) => ({ mediaId, position }))).toEqual([
        { mediaId: MEDIA_IDS[1], position: 0 },
        { mediaId: MEDIA_IDS[0], position: 1 },
      ]);
    });

    it('refuses two photos of a branch at one position at commit', async () => {
      await insert('branch_media', { branch_id: BRANCH_ID, media_id: MEDIA_IDS[0], position: 0 });

      await inTransaction(async () => {
        await insert('branch_media', {
          branch_id: BRANCH_ID,
          media_id: MEDIA_IDS[1],
          position: 0,
        });
        // Deferred: the duplicate passes until COMMIT, which fails and ends the transaction.
        await expectSqlState(app.query('COMMIT'), UNIQUE_VIOLATION);
      });
    });

    it('swaps two positions of an item gallery inside one transaction (D-156)', async () => {
      const { itemId } = await insertItem();
      await insert('menu_item_media', {
        menu_item_id: itemId,
        media_id: MEDIA_IDS[0],
        position: 0,
      });
      await insert('menu_item_media', {
        menu_item_id: itemId,
        media_id: MEDIA_IDS[1],
        position: 1,
      });

      await inTransaction(async () => {
        await app.query(
          `UPDATE public.menu_item_media
              SET position = CASE position WHEN 0 THEN 1 ELSE 0 END
            WHERE menu_item_id = $1`,
          [itemId],
        );
        await app.query('COMMIT');
      });

      const rows = await app.query<{ media_id: string }>(
        'SELECT media_id FROM public.menu_item_media WHERE menu_item_id = $1 AND position = 0',
        [itemId],
      );
      expect(rows).toEqual([{ media_id: MEDIA_IDS[1] }]);
    });

    it('rejects a negative position', async () => {
      await expectSqlState(
        insert('branch_media', { branch_id: BRANCH_ID, media_id: MEDIA_IDS[0], position: -1 }),
        CHECK_VIOLATION,
      );
    });

    it('refuses to delete an image that a gallery or a branch cover uses', async () => {
      const { itemId } = await insertItem();
      await insert('branch_media', { branch_id: BRANCH_ID, media_id: MEDIA_IDS[0], position: 0 });
      await insert('menu_item_media', {
        menu_item_id: itemId,
        media_id: MEDIA_IDS[1],
        position: 0,
      });
      await app.query('UPDATE public.branches SET cover_media_id = $2 WHERE id = $1', [
        BRANCH_ID,
        MEDIA_IDS[2],
      ]);

      for (const id of MEDIA_IDS) {
        await expectSqlState(
          app.query('DELETE FROM public.media WHERE id = $1', [id]),
          RESTRICT_VIOLATION,
        );
      }
    });

    it('rejects a branch cover that is not a media row', async () => {
      await expectSqlState(
        app.query('UPDATE public.branches SET cover_media_id = $2 WHERE id = $1', [
          BRANCH_ID,
          UNKNOWN_MEDIA_ID,
        ]),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe('kd_app privileges', () => {
    it('cannot delete or truncate menu_items (soft delete only)', async () => {
      const { itemId } = await insertItem();

      await app.expectPermissionDenied('DELETE FROM public.menu_items WHERE id = $1', [itemId]);
      await app.expectPermissionDenied('TRUNCATE TABLE public.menu_items');
    });

    it('deletes from every other menu table', async () => {
      const { itemId } = await insertItem();
      const tagId = await insertId('tags', TAG_ROW);
      const groupId = await insertGroup(itemId);
      const optionId = await insertId('item_options', optionRow(groupId));
      await insertMedia(MEDIA_IDS[0], 1);
      await insert('menu_item_translations', {
        menu_item_id: itemId,
        locale: 'vi',
        name: 'Cơm tấm',
      });
      await insert('menu_item_tags', { menu_item_id: itemId, tag_id: tagId });
      await insert('menu_item_media', {
        menu_item_id: itemId,
        media_id: MEDIA_IDS[0],
        position: 0,
      });
      await insert('branch_media', { branch_id: BRANCH_ID, media_id: MEDIA_IDS[0], position: 0 });
      await insert('branch_menu_items', branchMenuRow(itemId));
      const emptyCategoryId = await insertId('menu_categories', {
        ...CATEGORY_ROW,
        slug: 'trang-mieng',
      });

      const deletes: [string, unknown[]][] = [
        [
          'DELETE FROM public.menu_item_translations WHERE menu_item_id = $1 RETURNING locale',
          [itemId],
        ],
        ['DELETE FROM public.menu_item_tags WHERE menu_item_id = $1 RETURNING tag_id', [itemId]],
        ['DELETE FROM public.tags WHERE id = $1 RETURNING id', [tagId]],
        ['DELETE FROM public.item_options WHERE id = $1 RETURNING id', [optionId]],
        ['DELETE FROM public.item_option_groups WHERE id = $1 RETURNING id', [groupId]],
        ['DELETE FROM public.menu_item_media WHERE menu_item_id = $1 RETURNING media_id', [itemId]],
        ['DELETE FROM public.branch_media WHERE branch_id = $1 RETURNING media_id', [BRANCH_ID]],
        [
          'DELETE FROM public.branch_menu_items WHERE menu_item_id = $1 RETURNING branch_id',
          [itemId],
        ],
        ['DELETE FROM public.menu_categories WHERE id = $1 RETURNING id', [emptyCategoryId]],
      ];
      for (const [sql, parameters] of deletes) {
        expect(await app.query(sql, parameters)).toHaveLength(1);
      }
    });
  });
});
