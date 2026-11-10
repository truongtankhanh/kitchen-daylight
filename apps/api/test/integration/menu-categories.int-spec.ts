import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A6-T6, `/admin/menu-categories` (api-outline "Menu and stock"; brief B4, B25 to B28, B31; mobile
// G6): list paging and `itemCount`, create and duplicate slug, the icon shape, PATCH with a stale
// version, delete of an empty category, IN_USE with a soft-deleted item inside, reorder (success,
// missing id, duplicate id, stale version, no partial change), items-order (success, mismatch,
// raised item versions), the role matrix and 401. As `kd_app` against real PostgreSQL. Fictional
// data only.

const ADMIN_ID = '01930000-0000-7000-8000-000000006601';
const MANAGER_ID = '01930000-0000-7000-8000-000000006602';
const STAFF_ID = '01930000-0000-7000-8000-000000006603';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000006604';
const SESSION_ID = '01930000-0000-7000-8000-0000000066a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000066b1';
const UNKNOWN_ID = '01930000-0000-7000-8000-0000000066ff';

const MANAGER_NAME = 'Quản lý Danh mục Mẫu';

const CATEGORIES = '/api/v1/admin/menu-categories';

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

interface Category {
  id: string;
  slug: string;
  names: { vi: string; en?: string };
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
  rowVersion: number;
  updatedAt: string;
}

interface Page {
  items: Category[];
  page: number;
  pageSize: number;
  total: number;
}

describe('admin menu categories (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A] });
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
    await insertUser(ADMIN_ID, 'ADMIN', 'Quản trị Danh mục Mẫu');
    await insertUser(MANAGER_ID, 'MANAGER', MANAGER_NAME);
    await insertUser(STAFF_ID, 'STAFF', 'Nhân viên Danh mục Mẫu');
    await insertUser(CUSTOMER_ID, 'CUSTOMER', 'Khách Danh mục Mẫu');
    await query(
      'INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $3), ($2, $3)',
      [MANAGER_ID, STAFF_ID, BRANCH_A],
    );
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(id: string, role: UserRole, displayName: string): Promise<unknown> {
    return query(INSERT_USER_SQL, [
      id,
      `fixture-categories-${id.slice(-4)}@kd.example`,
      displayName,
      role,
    ]);
  }

  async function headersOf(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  const asAdmin = () => headersOf(ADMIN_ID, 'ADMIN');
  const asManager = () => headersOf(MANAGER_ID, 'MANAGER');
  const asStaff = () => headersOf(STAFF_ID, 'STAFF');
  const asCustomer = () => headersOf(CUSTOMER_ID, 'CUSTOMER');

  async function createCategory(body: Record<string, unknown>): Promise<Category> {
    const response = await client.post(
      CATEGORIES,
      { isActive: true, ...body },
      {
        headers: await asManager(),
      },
    );
    expect(response.status).toBe(201);
    return response.body as Category;
  }

  async function listCategories(search = ''): Promise<Page> {
    const response = await client.get(`${CATEGORIES}${search}`, { headers: await asManager() });
    expect(response.status).toBe(200);
    return response.body as Page;
  }

  async function send(
    method: 'PATCH' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.request(path, { method, body, headers: headers ?? (await asManager()) });
  }

  function fieldErrors(response: TestResponse): { field: string; code: string }[] {
    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
    return (response.problem?.errors ?? []).map(({ field, code }) => ({ field, code }));
  }

  /** One item per `[slug, viName]` in the category; returns the item ids in order. */
  async function insertItems(
    categoryId: string,
    rows: readonly [string, string][],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const [index, [slug, name]] of rows.entries()) {
      const [item] = await query<{ id: string }>(
        `INSERT INTO public.menu_items (slug, category_id, base_price, sort_order, is_active)
         VALUES ($1, $2, 50000, $3, false) RETURNING id::text AS id`,
        [slug, categoryId, 10 + index],
      );
      if (item === undefined) {
        throw new Error('no item');
      }
      await query(
        `INSERT INTO public.menu_item_translations (menu_item_id, locale, name)
         VALUES ($1, 'vi', $2)`,
        [item.id, name],
      );
      ids.push(item.id);
    }
    return ids;
  }

  function softDelete(itemId: string): Promise<unknown> {
    return query('UPDATE public.menu_items SET deleted_at = now() WHERE id = $1', [itemId]);
  }

  // -------------------------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------------------------

  describe('roles', () => {
    it('answers 401 without a token', async () => {
      const response = await client.get(CATEGORIES);

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });

    it.each([
      ['STAFF', asStaff, 403],
      ['CUSTOMER', asCustomer, 403],
      ['MANAGER', asManager, 200],
      ['ADMIN', asAdmin, 200],
    ] as const)('answers %s with %i on the list', async (_role, headers, status) => {
      const response = await client.get(CATEGORIES, { headers: await headers() });

      expect(response.status).toBe(status);
    });

    it('refuses STAFF on every write with FORBIDDEN', async () => {
      const category = await createCategory({ names: { vi: 'Món chính' } });
      const staff = await asStaff();

      const responses = [
        await client.post(
          CATEGORIES,
          { names: { vi: 'Khác' }, isActive: true },
          { headers: staff },
        ),
        await send('PATCH', `${CATEGORIES}/${category.id}`, { rowVersion: 1 }, staff),
        await send('POST', `${CATEGORIES}/reorder`, { ids: [], rowVersions: [] }, staff),
        await send('PUT', `${CATEGORIES}/${category.id}/items-order`, { itemIds: [] }, staff),
        await send('DELETE', `${CATEGORIES}/${category.id}?rowVersion=1`, undefined, staff),
      ];

      expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Create, PATCH
  // -------------------------------------------------------------------------------------------

  describe('create and update', () => {
    it('creates after the last category, derives the slug and records the editor', async () => {
      const first = await createCategory({ names: { vi: 'Khai vị' }, sortOrder: 5 });
      const second = await createCategory({
        names: { vi: 'Món chính', en: 'Mains' },
        icon: 'rice-bowl',
        isActive: false,
      });

      expect(first).toMatchObject({ slug: 'khai-vi', sortOrder: 5, icon: null, itemCount: 0 });
      expect(second).toMatchObject({
        slug: 'mon-chinh',
        names: { vi: 'Món chính', en: 'Mains' },
        icon: 'rice-bowl',
        sortOrder: 6,
        isActive: false,
        rowVersion: 1,
      });
      const [stored] = await query<{ updated_by: string }>(
        'SELECT updated_by::text AS updated_by FROM public.menu_categories WHERE id = $1',
        [second.id],
      );
      expect(stored?.updated_by).toBe(MANAGER_ID);
    });

    it('refuses a duplicate slug with ALREADY_EXISTS', async () => {
      await createCategory({ names: { vi: 'Đồ uống' } });

      const response = await client.post(
        CATEGORIES,
        { names: { vi: 'Đồ uống' }, isActive: true },
        { headers: await asManager() },
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('ALREADY_EXISTS');
    });

    it('refuses an icon that is not a lower-case key, and needs names.vi', async () => {
      const response = await client.post(
        CATEGORIES,
        { names: { en: 'Drinks' }, icon: 'Đồ uống', isActive: true },
        { headers: await asManager() },
      );

      expect(fieldErrors(response)).toEqual(
        expect.arrayContaining([
          { field: 'icon', code: 'INVALID' },
          { field: 'names.vi', code: 'REQUIRED' },
        ]),
      );
    });

    it('updates with the current rowVersion and clears the icon with null', async () => {
      const category = await createCategory({ names: { vi: 'Khai vị' }, icon: 'salad' });

      const response = await send('PATCH', `${CATEGORIES}/${category.id}`, {
        rowVersion: category.rowVersion,
        icon: null,
        isActive: false,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        icon: null,
        isActive: false,
        slug: 'khai-vi',
        rowVersion: category.rowVersion + 1,
      });
    });

    it('refuses a stale PATCH with STALE_VERSION naming the last editor', async () => {
      const category = await createCategory({ names: { vi: 'Khai vị' } });
      const first = await send('PATCH', `${CATEGORIES}/${category.id}`, {
        rowVersion: category.rowVersion,
        names: { vi: 'Món khai vị' },
      });
      const current = first.body as Category;

      const stale = await send(
        'PATCH',
        `${CATEGORIES}/${category.id}`,
        { rowVersion: category.rowVersion, isActive: false },
        await asAdmin(),
      );

      expect(stale.status).toBe(409);
      expect(stale.problem?.code).toBe('STALE_VERSION');
      expect(stale.problem?.['current']).toEqual({
        rowVersion: current.rowVersion,
        updatedBy: { id: MANAGER_ID, name: MANAGER_NAME },
        updatedAt: current.updatedAt,
      });
    });

    it('answers 404 for an unknown category', async () => {
      const response = await send('PATCH', `${CATEGORIES}/${UNKNOWN_ID}`, { rowVersion: 1 });

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------------------------

  describe('list', () => {
    it('pages by sortOrder, name, id with total, q without accents and live itemCount', async () => {
      const drinks = await createCategory({ names: { vi: 'Đồ uống' }, sortOrder: 3 });
      await createCategory({ names: { vi: 'Món chính' }, sortOrder: 2 });
      await createCategory({ names: { vi: 'Khai vị' }, sortOrder: 1 });
      await createCategory({ names: { vi: 'Bánh ngọt' }, sortOrder: 3 });
      const [, , cu] = await insertItems(drinks.id, [
        ['tra-da', 'Trà đá'],
        ['ca-phe', 'Cà phê'],
        ['nuoc-cu', 'Nước cũ'],
      ]);
      await softDelete(cu ?? '');

      const all = await listCategories('?pageSize=50');
      const first = await listCategories('?page=1&pageSize=2');
      const second = await listCategories('?page=2&pageSize=2');
      const search = await listCategories('?q=DO%20UONG');

      expect(all.total).toBe(4);
      expect(all.items.map((category) => category.slug)).toEqual([
        'khai-vi',
        'mon-chinh',
        'banh-ngot',
        'do-uong',
      ]);
      expect([...first.items, ...second.items].map((category) => category.id)).toEqual(
        all.items.map((category) => category.id),
      );
      expect([first.page, first.pageSize, first.total, second.page]).toEqual([1, 2, 4, 2]);
      expect(search.items.map((category) => category.slug)).toEqual(['do-uong']);
      expect(search.items[0]?.itemCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------------------------

  describe('delete', () => {
    it('hard-deletes an empty category', async () => {
      const category = await createCategory({ names: { vi: 'Trống' } });

      const response = await send(
        'DELETE',
        `${CATEGORIES}/${category.id}?rowVersion=${category.rowVersion}`,
      );

      expect(response.status).toBe(204);
      expect(
        await query('SELECT 1 FROM public.menu_categories WHERE id = $1', [category.id]),
      ).toEqual([]);
    });

    it('refuses a category whose only item is soft-deleted, with IN_USE counting it', async () => {
      const category = await createCategory({ names: { vi: 'Món cũ' } });
      const [item] = await insertItems(category.id, [['mon-da-xoa', 'Món đã xoá']]);
      await softDelete(item ?? '');

      const list = await listCategories();
      const response = await send(
        'DELETE',
        `${CATEGORIES}/${category.id}?rowVersion=${category.rowVersion}`,
      );

      expect(list.items[0]?.itemCount).toBe(0);
      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('IN_USE');
      expect(response.problem?.['usage']).toEqual({
        count: 1,
        sample: [{ id: item, name: 'Món đã xoá' }],
        filter: { categoryId: category.id },
      });
    });

    it('refuses a stale delete with STALE_VERSION', async () => {
      const category = await createCategory({ names: { vi: 'Trống' } });
      await send('PATCH', `${CATEGORIES}/${category.id}`, {
        rowVersion: category.rowVersion,
        isActive: false,
      });

      const response = await send(
        'DELETE',
        `${CATEGORIES}/${category.id}?rowVersion=${category.rowVersion}`,
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('STALE_VERSION');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Reorder
  // -------------------------------------------------------------------------------------------

  describe('reorder', () => {
    let categories: Category[];

    beforeEach(async () => {
      categories = [
        await createCategory({ names: { vi: 'Khai vị' } }),
        await createCategory({ names: { vi: 'Món chính' } }),
        await createCategory({ names: { vi: 'Đồ uống' } }),
      ];
    });

    async function storedOrder(): Promise<{ id: string; sort_order: number }[]> {
      return query(
        'SELECT id::text AS id, sort_order FROM public.menu_categories ORDER BY sort_order, id',
      );
    }

    it('rewrites sort_order 1 to N and returns the list with the new versions', async () => {
      const [a, b, c] = categories;
      const ids = [c?.id, a?.id, b?.id];

      const response = await send('POST', `${CATEGORIES}/reorder`, {
        ids,
        rowVersions: [c?.rowVersion, a?.rowVersion, b?.rowVersion],
      });

      expect(response.status).toBe(200);
      const body = response.body as { items: Category[]; total: number };
      expect(body.total).toBe(3);
      expect(body.items.map((category) => [category.id, category.sortOrder])).toEqual([
        [c?.id, 1],
        [a?.id, 2],
        [b?.id, 3],
      ]);
      expect(body.items.every((category) => category.rowVersion === 2)).toBe(true);
    });

    it.each([
      ['a missing id', (ids: string[]) => ids.slice(0, 2)],
      ['a duplicate id', (ids: string[]) => [ids[0] ?? '', ids[0] ?? '', ids[1] ?? '']],
      ['an unknown id', (ids: string[]) => [ids[0] ?? '', ids[1] ?? '', UNKNOWN_ID]],
    ])('refuses %s with VALIDATION_FAILED on ids, changing nothing', async (_case, pick) => {
      const before = await storedOrder();
      const ids = pick(categories.map((category) => category.id));

      const response = await send('POST', `${CATEGORIES}/reorder`, {
        ids,
        rowVersions: ids.map(() => 1),
      });

      expect(fieldErrors(response)).toEqual([{ field: 'ids', code: 'INVALID' }]);
      expect(await storedOrder()).toEqual(before);
    });

    it('refuses rowVersions that are not parallel to ids', async () => {
      const response = await send('POST', `${CATEGORIES}/reorder`, {
        ids: categories.map((category) => category.id),
        rowVersions: [1],
      });

      expect(fieldErrors(response)).toEqual([{ field: 'rowVersions', code: 'INVALID' }]);
    });

    it('refuses a stale version with STALE_VERSION and leaves every row as it was', async () => {
      const [a, b, c] = categories;
      const edited = await send('PATCH', `${CATEGORIES}/${b?.id ?? ''}`, {
        rowVersion: b?.rowVersion,
        isActive: false,
      });
      const before = await storedOrder();

      const response = await send('POST', `${CATEGORIES}/reorder`, {
        ids: [c?.id, b?.id, a?.id],
        rowVersions: [c?.rowVersion, b?.rowVersion, a?.rowVersion],
      });

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('STALE_VERSION');
      expect(response.problem?.['current']).toMatchObject({
        rowVersion: (edited.body as Category).rowVersion,
      });
      expect(await storedOrder()).toEqual(before);
      const versions = await query<{ row_version: number }>(
        'SELECT row_version FROM public.menu_categories WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[a?.id, c?.id]],
      );
      expect(versions.every((row) => row.row_version === 1)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Items order
  // -------------------------------------------------------------------------------------------

  describe('items-order', () => {
    it('rewrites the live items 1 to N and raises each item version', async () => {
      const category = await createCategory({ names: { vi: 'Món chính' } });
      const [com, pho, bun, old] = await insertItems(category.id, [
        ['com-tam', 'Cơm tấm'],
        ['pho-bo', 'Phở bò'],
        ['bun-cha', 'Bún chả'],
        ['mon-cu', 'Món cũ'],
      ]);
      await softDelete(old ?? '');

      const response = await send('PUT', `${CATEGORIES}/${category.id}/items-order`, {
        itemIds: [bun, com, pho],
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [
          { id: bun, sortOrder: 1, rowVersion: 2 },
          { id: com, sortOrder: 2, rowVersion: 2 },
          { id: pho, sortOrder: 3, rowVersion: 2 },
        ],
      });
      const [stored] = await query<{ updated_by: string; sort_order: number }>(
        'SELECT updated_by::text AS updated_by, sort_order FROM public.menu_items WHERE id = $1',
        [bun],
      );
      expect(stored).toEqual({ updated_by: MANAGER_ID, sort_order: 1 });
    });

    it.each([
      ['a missing item', (ids: string[]) => ids.slice(0, 1)],
      ['a soft-deleted item', (ids: string[]) => ids],
      ['an item of another category', (ids: string[]) => [ids[0] ?? '', UNKNOWN_ID]],
    ])('refuses %s with VALIDATION_FAILED on itemIds', async (_case, pick) => {
      const category = await createCategory({ names: { vi: 'Món chính' } });
      const ids = await insertItems(category.id, [
        ['com-tam', 'Cơm tấm'],
        ['pho-bo', 'Phở bò'],
        ['mon-cu', 'Món cũ'],
      ]);
      await softDelete(ids[2] ?? '');

      const response = await send('PUT', `${CATEGORIES}/${category.id}/items-order`, {
        itemIds: pick(ids),
      });

      expect(fieldErrors(response)).toEqual([{ field: 'itemIds', code: 'INVALID' }]);
      const versions = await query<{ row_version: number }>(
        'SELECT row_version FROM public.menu_items WHERE category_id = $1 AND deleted_at IS NULL',
        [category.id],
      );
      expect(versions.every((row) => row.row_version === 1)).toBe(true);
    });

    it('answers 404 for an unknown category', async () => {
      const response = await send('PUT', `${CATEGORIES}/${UNKNOWN_ID}/items-order`, {
        itemIds: [],
      });

      expect(response.status).toBe(404);
    });
  });
});
