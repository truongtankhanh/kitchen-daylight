import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A6-T5, `/admin/tags` and `/admin/amenities` (api-outline "Menu and stock"; brief B24, B27, B30,
// B31, B32): list filters and sort stability across pages, select mode, the per-row counts,
// IN_USE with `usage.sample` for a used tag and a used amenity, the refused kind change,
// STALE_VERSION, duplicate slug, the icon list, 403 for STAFF on tags and MANAGER on amenities,
// 401 without a token. As `kd_app` against real PostgreSQL. Fictional data only.

const ADMIN_ID = '01930000-0000-7000-8000-000000006501';
const MANAGER_ID = '01930000-0000-7000-8000-000000006502';
const STAFF_ID = '01930000-0000-7000-8000-000000006503';
const SESSION_ID = '01930000-0000-7000-8000-0000000065a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000065b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000065b2';
const BRANCH_C = '01930000-0000-7000-8000-0000000065b3';
const UNKNOWN_ID = '01930000-0000-7000-8000-0000000065ff';

const MANAGER_NAME = 'Quản lý Thẻ Mẫu';

const TAGS = '/api/v1/admin/tags';
const AMENITIES = '/api/v1/admin/amenities';

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

interface Tag {
  id: string;
  kind: string;
  slug: string;
  names: { vi: string; en?: string };
  itemCount: number;
  unverifiedCount: number;
  branchCount: number;
  rowVersion: number;
  updatedAt: string;
}

interface Amenity {
  id: string;
  code: string;
  names: { vi: string; en?: string };
  icon: string;
  branchCount: number;
  rowVersion: number;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

describe('admin tags and amenities (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B, BRANCH_C] });
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
    await insertUser(ADMIN_ID, 'ADMIN', 'Quản trị Thẻ Mẫu');
    await insertUser(MANAGER_ID, 'MANAGER', MANAGER_NAME);
    await insertUser(STAFF_ID, 'STAFF', 'Nhân viên Thẻ Mẫu');
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
      `fixture-tags-${id.slice(-4)}@kd.example`,
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

  async function createTag(body: Record<string, unknown>): Promise<Tag> {
    const response = await client.post(TAGS, body, { headers: await asManager() });
    expect(response.status).toBe(201);
    return response.body as Tag;
  }

  async function createAmenity(body: Record<string, unknown>): Promise<Amenity> {
    const response = await client.post(AMENITIES, body, { headers: await asAdmin() });
    expect(response.status).toBe(201);
    return response.body as Amenity;
  }

  async function patch(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) {
    return client.request(path, { method: 'PATCH', body, headers });
  }

  async function remove(path: string, rowVersion: number, headers: Record<string, string>) {
    return client.request(`${path}?rowVersion=${rowVersion}`, { method: 'DELETE', headers });
  }

  async function listTags(search = ''): Promise<Page<Tag>> {
    const response = await client.get(`${TAGS}${search}`, { headers: await asManager() });
    expect(response.status).toBe(200);
    return response.body as Page<Tag>;
  }

  function fieldErrors(response: TestResponse): { field: string; code: string }[] {
    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
    return (response.problem?.errors ?? []).map(({ field, code }) => ({ field, code }));
  }

  /** A category and one item per `[slug, viName]`; returns the item ids in order. */
  async function insertItems(rows: readonly [string, string][]): Promise<string[]> {
    const [category] = await query<{ id: string }>(
      `INSERT INTO public.menu_categories (slug, names, sort_order, is_active)
       VALUES ('mon-mau', '{"vi": "Món mẫu"}', 1, true) RETURNING id::text AS id`,
    );
    const ids: string[] = [];
    for (const [index, [slug, name]] of rows.entries()) {
      const [item] = await query<{ id: string }>(
        `INSERT INTO public.menu_items (slug, category_id, base_price, sort_order, is_active)
         VALUES ($1, $2, 50000, $3, false) RETURNING id::text AS id`,
        [slug, category?.id, index],
      );
      if (item === undefined) {
        throw new Error('no item');
      }
      await query(
        `INSERT INTO public.menu_item_translations (menu_item_id, locale, name) VALUES ($1, 'vi', $2)`,
        [item.id, name],
      );
      ids.push(item.id);
    }
    return ids;
  }

  async function link(itemId: string, tagId: string, verified = false): Promise<void> {
    await query(
      `INSERT INTO public.menu_item_tags (menu_item_id, tag_id, verified_at, verified_by)
       VALUES ($1, $2, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN $4::uuid END)`,
      [itemId, tagId, verified, MANAGER_ID],
    );
  }

  async function sell(branchId: string, itemId: string): Promise<void> {
    await query(
      `INSERT INTO public.branch_menu_items (branch_id, menu_item_id, is_available) VALUES ($1, $2, true)`,
      [branchId, itemId],
    );
  }

  // -------------------------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------------------------

  describe('roles', () => {
    it.each([TAGS, AMENITIES])('answers 401 on %s without a token', async (path) => {
      const response = await client.get(path);

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });

    it('answers 403 to STAFF on tags, 200 to MANAGER and ADMIN', async () => {
      const staff = await client.get(TAGS, { headers: await asStaff() });
      const staffCreate = await client.post(
        TAGS,
        { kind: 'LABEL', names: { vi: 'Cay' } },
        { headers: await asStaff() },
      );

      expect(staff.status).toBe(403);
      expect(staff.problem?.code).toBe('FORBIDDEN');
      expect(staffCreate.status).toBe(403);
      expect((await client.get(TAGS, { headers: await asManager() })).status).toBe(200);
      expect((await client.get(TAGS, { headers: await asAdmin() })).status).toBe(200);
    });

    it('answers 403 to MANAGER on amenities, 200 to ADMIN', async () => {
      const manager = await client.get(AMENITIES, { headers: await asManager() });
      const managerCreate = await client.post(
        AMENITIES,
        { names: { vi: 'Wifi' }, icon: 'wifi' },
        { headers: await asManager() },
      );

      expect(manager.status).toBe(403);
      expect(manager.problem?.code).toBe('FORBIDDEN');
      expect(managerCreate.status).toBe(403);
      expect((await client.get(AMENITIES, { headers: await asAdmin() })).status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Create and validation
  // -------------------------------------------------------------------------------------------

  describe('create', () => {
    it('creates a tag with a slug derived from the Vietnamese name', async () => {
      const tag = await createTag({ kind: 'ALLERGEN', names: { vi: 'Đậu phộng', en: 'Peanut' } });

      expect(tag).toMatchObject({
        kind: 'ALLERGEN',
        slug: 'dau-phong',
        names: { vi: 'Đậu phộng', en: 'Peanut' },
        itemCount: 0,
        unverifiedCount: 0,
        branchCount: 0,
        rowVersion: 1,
      });
      const [stored] = await query<{ updated_by: string }>(
        'SELECT updated_by::text AS updated_by FROM public.tags WHERE id = $1',
        [tag.id],
      );
      expect(stored?.updated_by).toBe(MANAGER_ID);
    });

    it('refuses a duplicate slug with ALREADY_EXISTS, sent or derived', async () => {
      await createTag({ kind: 'LABEL', names: { vi: 'Cay' } });

      const derived = await client.post(
        TAGS,
        { kind: 'LABEL', names: { vi: 'Cay' } },
        { headers: await asManager() },
      );
      const sent = await client.post(
        TAGS,
        { kind: 'DIETARY', slug: 'cay', names: { vi: 'Khác' } },
        { headers: await asManager() },
      );

      expect(derived.status).toBe(409);
      expect(derived.problem?.code).toBe('ALREADY_EXISTS');
      expect(sent.status).toBe(409);
      expect(sent.problem?.code).toBe('ALREADY_EXISTS');
    });

    it('requires names.vi and a known kind', async () => {
      const response = await client.post(
        TAGS,
        { kind: 'OTHER', names: { en: 'Spicy' } },
        { headers: await asManager() },
      );

      expect(fieldErrors(response)).toEqual(
        expect.arrayContaining([
          { field: 'kind', code: 'INVALID' },
          { field: 'names.vi', code: 'REQUIRED' },
        ]),
      );
    });

    it('creates an amenity with a code derived from the name and a listed icon', async () => {
      const amenity = await createAmenity({ names: { vi: 'Chỗ đậu xe' }, icon: 'car' });

      expect(amenity).toMatchObject({
        code: 'cho-dau-xe',
        names: { vi: 'Chỗ đậu xe' },
        icon: 'car',
        branchCount: 0,
        rowVersion: 1,
      });
    });

    it('rejects an icon outside the list with INVALID on icon', async () => {
      const created = await client.post(
        AMENITIES,
        { names: { vi: 'Hồ bơi' }, icon: 'pool' },
        { headers: await asAdmin() },
      );
      const amenity = await createAmenity({ names: { vi: 'Wifi' }, icon: 'wifi' });
      const patched = await patch(
        `${AMENITIES}/${amenity.id}`,
        { rowVersion: amenity.rowVersion, icon: 'WIFI' },
        await asAdmin(),
      );

      expect(fieldErrors(created)).toEqual([{ field: 'icon', code: 'INVALID' }]);
      expect(fieldErrors(patched)).toEqual([{ field: 'icon', code: 'INVALID' }]);
    });

    it('refuses a duplicate amenity code with ALREADY_EXISTS', async () => {
      await createAmenity({ code: 'wifi', names: { vi: 'Wifi' }, icon: 'wifi' });

      const response = await client.post(
        AMENITIES,
        { code: 'wifi', names: { vi: 'Wifi 2' }, icon: 'wifi' },
        { headers: await asAdmin() },
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('ALREADY_EXISTS');
    });
  });

  // -------------------------------------------------------------------------------------------
  // List: filters, sort, pages, select mode
  // -------------------------------------------------------------------------------------------

  describe('list', () => {
    beforeEach(async () => {
      for (const [kind, slug, vi] of [
        ['LABEL', 'cay', 'Cay'],
        ['LABEL', 'cay-nhe', 'Cáy'],
        ['ALLERGEN', 'dau-phong', 'Đậu phộng'],
        ['ALLERGEN', 'dau-nanh', 'Đậu nành'],
        ['ALLERGEN', 'sua', 'Sữa'],
        ['DIETARY', 'thuan-chay', 'Thuần chay'],
        ['DIETARY', 'mon-chay', 'Món chay'],
      ]) {
        await createTag({ kind, slug, names: { vi } });
      }
    });

    it('sorts by kind, unaccented name, then id, and pages without a gap or a repeat', async () => {
      const all = await listTags('?pageSize=50');
      const pages = [
        await listTags('?page=1&pageSize=3'),
        await listTags('?page=2&pageSize=3'),
        await listTags('?page=3&pageSize=3'),
      ];

      expect(all.total).toBe(7);
      expect(all.items.map((tag) => tag.slug).slice(0, 5)).toEqual([
        'mon-chay',
        'thuan-chay',
        'dau-nanh',
        'dau-phong',
        'sua',
      ]);
      // "Cay" and "Cáy" have the same unaccented name: `id` breaks the tie.
      const labels = all.items.slice(5);
      expect(labels.map((tag) => tag.slug).sort()).toEqual(['cay', 'cay-nhe']);
      expect((labels[0]?.id ?? '') < (labels[1]?.id ?? '')).toBe(true);
      expect(pages.flatMap((page) => page.items.map((tag) => tag.id))).toEqual(
        all.items.map((tag) => tag.id),
      );
      expect(pages.map((page) => [page.page, page.pageSize, page.total])).toEqual([
        [1, 3, 7],
        [2, 3, 7],
        [3, 3, 7],
      ]);
    });

    it('filters by kind, by q without accents, and by ids', async () => {
      const allergens = await listTags('?kind=ALLERGEN');
      const dau = await listTags('?q=DAU');
      const chosen = (await listTags('?q=chay')).items.map((tag) => tag.id);
      const byIds = await listTags(`?ids=${chosen[0] ?? ''}&ids=${UNKNOWN_ID}`);

      expect(allergens.items.map((tag) => tag.slug)).toEqual(['dau-nanh', 'dau-phong', 'sua']);
      expect(dau.items.map((tag) => tag.slug)).toEqual(['dau-nanh', 'dau-phong']);
      expect(dau.total).toBe(2);
      expect(chosen).toHaveLength(2);
      expect(byIds.items.map((tag) => tag.id)).toEqual([chosen[0]]);
    });

    it('in select mode returns the first limit rows as page 1, and caps limit at 20', async () => {
      const select = await listTags('?limit=2&page=3');
      const tooMany = await client.get(`${TAGS}?limit=21`, { headers: await asManager() });

      expect(select).toMatchObject({ page: 1, pageSize: 2, total: 7 });
      expect(select.items.map((tag) => tag.slug)).toEqual(['mon-chay', 'thuan-chay']);
      expect(fieldErrors(tooMany)).toEqual([{ field: 'limit', code: 'OUT_OF_RANGE' }]);
    });

    it('lists amenities by unaccented name with q', async () => {
      await createAmenity({ names: { vi: 'Wifi' }, icon: 'wifi' });
      await createAmenity({ names: { vi: 'Máy lạnh' }, icon: 'snow' });
      await createAmenity({ names: { vi: 'Lối đi cho xe lăn' }, icon: 'wheelchair' });

      const all = await client.get(AMENITIES, { headers: await asAdmin() });
      const filtered = await client.get(`${AMENITIES}?q=may%20lanh`, { headers: await asAdmin() });

      expect((all.body as Page<Amenity>).items.map((row) => row.code)).toEqual([
        'loi-di-cho-xe-lan',
        'may-lanh',
        'wifi',
      ]);
      expect((filtered.body as Page<Amenity>).items.map((row) => row.code)).toEqual(['may-lanh']);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Counts
  // -------------------------------------------------------------------------------------------

  describe('counts', () => {
    it('counts live items, unverified claims (none for LABEL) and live selling branches', async () => {
      const allergen = await createTag({ kind: 'ALLERGEN', names: { vi: 'Đậu phộng' } });
      const label = await createTag({ kind: 'LABEL', names: { vi: 'Bán chạy' } });
      const [goi, pho, cu] = await insertItems([
        ['goi-cuon', 'Gỏi cuốn'],
        ['pho-bo', 'Phở bò'],
        ['mon-cu', 'Món cũ'],
      ]);
      if (goi === undefined || pho === undefined || cu === undefined) {
        throw new Error('no items');
      }
      await link(goi, allergen.id, true);
      await link(pho, allergen.id, false);
      await link(cu, allergen.id, false);
      await link(goi, label.id, false);
      await query('UPDATE public.menu_items SET deleted_at = now() WHERE id = $1', [cu]);
      await sell(BRANCH_A, goi);
      await sell(BRANCH_B, goi);
      await sell(BRANCH_B, pho);
      await sell(BRANCH_C, pho);
      await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [BRANCH_C]);

      const rows = new Map((await listTags()).items.map((tag) => [tag.slug, tag]));

      expect(rows.get('dau-phong')).toMatchObject({
        itemCount: 2,
        unverifiedCount: 1,
        branchCount: 2,
      });
      expect(rows.get('ban-chay')).toMatchObject({
        itemCount: 1,
        unverifiedCount: 0,
        branchCount: 2,
      });
    });

    it('counts the live branches that show an amenity', async () => {
      const amenity = await createAmenity({ names: { vi: 'Wifi' }, icon: 'wifi' });
      await query(
        'INSERT INTO public.branch_amenities (branch_id, amenity_id) VALUES ($1, $3), ($2, $3)',
        [BRANCH_A, BRANCH_C, amenity.id],
      );
      await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [BRANCH_C]);

      const response = await client.get(AMENITIES, { headers: await asAdmin() });

      expect((response.body as Page<Amenity>).items[0]).toMatchObject({ branchCount: 1 });
    });
  });

  // -------------------------------------------------------------------------------------------
  // IN_USE and the kind change
  // -------------------------------------------------------------------------------------------

  describe('IN_USE', () => {
    it('refuses deleting a tag that items carry, with usage and a sample', async () => {
      const tag = await createTag({ kind: 'ALLERGEN', names: { vi: 'Sữa' } });
      const [cafe, che] = await insertItems([
        ['ca-phe-sua', 'Cà phê sữa'],
        ['che-sua', 'Chè sữa'],
      ]);
      await link(cafe ?? '', tag.id);
      await link(che ?? '', tag.id);

      const response = await remove(`${TAGS}/${tag.id}`, tag.rowVersion, await asManager());

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('IN_USE');
      expect(response.problem?.['usage']).toEqual({
        count: 2,
        sample: [
          { id: cafe, name: 'Cà phê sữa' },
          { id: che, name: 'Chè sữa' },
        ],
        filter: { tagId: tag.id },
      });
      expect(await query('SELECT 1 FROM public.tags WHERE id = $1', [tag.id])).toHaveLength(1);
    });

    it('refuses changing the kind of a tag that items carry, and allows its names', async () => {
      const tag = await createTag({ kind: 'ALLERGEN', names: { vi: 'Trứng' } });
      const [item] = await insertItems([['banh-flan', 'Bánh flan']]);
      await link(item ?? '', tag.id);

      const kind = await patch(
        `${TAGS}/${tag.id}`,
        { rowVersion: tag.rowVersion, kind: 'LABEL' },
        await asManager(),
      );
      const names = await patch(
        `${TAGS}/${tag.id}`,
        { rowVersion: tag.rowVersion, kind: 'ALLERGEN', names: { vi: 'Trứng gà', en: 'Egg' } },
        await asManager(),
      );

      expect(kind.status).toBe(409);
      expect(kind.problem?.code).toBe('IN_USE');
      expect(kind.problem?.['usage']).toMatchObject({ count: 1, filter: { tagId: tag.id } });
      expect(names.status).toBe(200);
      expect(names.body).toMatchObject({
        kind: 'ALLERGEN',
        names: { vi: 'Trứng gà', en: 'Egg' },
        rowVersion: tag.rowVersion + 1,
      });
    });

    it('changes the kind of an unused tag and deletes it', async () => {
      const tag = await createTag({ kind: 'LABEL', names: { vi: 'Món mới' } });

      const changed = await patch(
        `${TAGS}/${tag.id}`,
        { rowVersion: tag.rowVersion, kind: 'DIETARY' },
        await asManager(),
      );
      const deleted = await remove(
        `${TAGS}/${tag.id}`,
        (changed.body as Tag).rowVersion,
        await asManager(),
      );

      expect(changed.status).toBe(200);
      expect((changed.body as Tag).kind).toBe('DIETARY');
      expect(deleted.status).toBe(204);
      expect(await query('SELECT 1 FROM public.tags WHERE id = $1', [tag.id])).toEqual([]);
    });

    it('refuses deleting an amenity that a branch shows, with usage and a sample', async () => {
      const amenity = await createAmenity({ names: { vi: 'Phòng riêng' }, icon: 'door' });
      await query('INSERT INTO public.branch_amenities (branch_id, amenity_id) VALUES ($1, $2)', [
        BRANCH_A,
        amenity.id,
      ]);

      const response = await remove(
        `${AMENITIES}/${amenity.id}`,
        amenity.rowVersion,
        await asAdmin(),
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('IN_USE');
      expect(response.problem?.['usage']).toEqual({
        count: 1,
        sample: [{ id: BRANCH_A, name: 'Chi nhánh mẫu' }],
        filter: { amenityId: amenity.id },
      });
    });

    it('deletes an unused amenity, and answers 404 for an unknown id', async () => {
      const amenity = await createAmenity({ names: { vi: 'Hộp quà' }, icon: 'box' });

      const deleted = await remove(
        `${AMENITIES}/${amenity.id}`,
        amenity.rowVersion,
        await asAdmin(),
      );
      const unknown = await remove(`${AMENITIES}/${UNKNOWN_ID}`, 1, await asAdmin());

      expect(deleted.status).toBe(204);
      expect(unknown.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  // STALE_VERSION
  // -------------------------------------------------------------------------------------------

  describe('STALE_VERSION', () => {
    it('refuses a stale tag PATCH or DELETE and names the last editor', async () => {
      const tag = await createTag({ kind: 'LABEL', names: { vi: 'Cay' } });
      const first = await patch(
        `${TAGS}/${tag.id}`,
        { rowVersion: tag.rowVersion, names: { vi: 'Cay nồng' } },
        await asManager(),
      );
      const current = first.body as Tag;

      const stale = await patch(
        `${TAGS}/${tag.id}`,
        { rowVersion: tag.rowVersion, names: { vi: 'Cay xé' } },
        await asAdmin(),
      );
      const staleDelete = await remove(`${TAGS}/${tag.id}`, tag.rowVersion, await asAdmin());

      expect(stale.status).toBe(409);
      expect(stale.problem?.code).toBe('STALE_VERSION');
      expect(stale.problem?.['current']).toEqual({
        rowVersion: current.rowVersion,
        updatedBy: { id: MANAGER_ID, name: MANAGER_NAME },
        updatedAt: current.updatedAt,
      });
      expect(staleDelete.status).toBe(409);
      expect(staleDelete.problem?.code).toBe('STALE_VERSION');
    });

    it('refuses a stale amenity PATCH; updatedBy is null (no updated_by column)', async () => {
      const amenity = await createAmenity({ names: { vi: 'Wifi' }, icon: 'wifi' });
      const first = await patch(
        `${AMENITIES}/${amenity.id}`,
        { rowVersion: amenity.rowVersion, icon: 'box' },
        await asAdmin(),
      );

      const stale = await patch(
        `${AMENITIES}/${amenity.id}`,
        { rowVersion: amenity.rowVersion, icon: 'car' },
        await asAdmin(),
      );

      expect(first.status).toBe(200);
      expect(stale.status).toBe(409);
      expect(stale.problem?.['current']).toEqual({
        rowVersion: (first.body as Amenity).rowVersion,
        updatedBy: null,
        updatedAt: (first.body as Amenity).updatedAt,
      });
    });
  });
});
