import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppRole,
  openRoleClient,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';

// Migration 0001_database_helpers (A0-T5): kd_unaccent, the two row triggers and the two domains.
// Tables made here are TEMP tables inside a transaction that is rolled back after each test, so
// nothing is left in the database.

describe('database helpers (0001_database_helpers)', () => {
  let migrator: RoleClient;
  let app: RoleClient;

  beforeAll(async () => {
    migrator = await openRoleClient('kd_migrator');
    app = await openAppRole();
  });

  afterAll(async () => {
    await migrator?.close();
    await app?.close();
  });

  describe('as kd_migrator, in a rolled-back transaction', () => {
    beforeEach(async () => {
      await migrator.query('BEGIN');
    });

    afterEach(async () => {
      await migrator.query('ROLLBACK');
    });

    it('finds "bò" with the query "bo" through kd_unaccent', async () => {
      await migrator.query('CREATE TEMP TABLE probe_dishes (name text NOT NULL)');
      await migrator.query(
        `INSERT INTO probe_dishes (name) VALUES ('Bò kho'), ('Cá kho tộ'), ('Gà nướng')`,
      );

      const rows = await migrator.query<{ name: string }>(
        `SELECT name FROM probe_dishes
          WHERE lower(public.kd_unaccent(name)) LIKE '%' || lower(public.kd_unaccent($1)) || '%'
          ORDER BY name`,
        ['bo'],
      );

      expect(rows.map((row) => row.name)).toEqual(['Bò kho']);
    });

    it('can be used in an index expression (IMMUTABLE)', async () => {
      await migrator.query('CREATE TEMP TABLE probe_index (name text NOT NULL)');
      await migrator.query(
        'CREATE INDEX probe_index_name_unaccent_idx ON probe_index (public.kd_unaccent(name))',
      );

      const rows = await migrator.query<{ indexdef: string }>(
        `SELECT pg_get_indexdef('probe_index_name_unaccent_idx'::regclass) AS indexdef`,
      );
      expect(rows[0]?.indexdef).toContain('kd_unaccent(name)');
    });

    it('sets updated_at and bumps row_version on update, only for the listed columns', async () => {
      await migrator.query(`CREATE TEMP TABLE probe_versioned (
        id           integer PRIMARY KEY,
        name         text NOT NULL,
        rating_count integer NOT NULL DEFAULT 0,
        row_version  integer NOT NULL DEFAULT 1,
        updated_at   timestamptz NOT NULL DEFAULT now()
      )`);
      await migrator.query(`CREATE TRIGGER probe_versioned_set_updated_at
        BEFORE UPDATE ON probe_versioned
        FOR EACH ROW EXECUTE FUNCTION public.kd_set_updated_at()`);
      await migrator.query(`CREATE TRIGGER probe_versioned_bump_row_version
        BEFORE UPDATE OF name ON probe_versioned
        FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version()`);
      await migrator.query(
        `INSERT INTO probe_versioned (id, name, updated_at) VALUES (1, 'Phở', '2026-01-01T00:00:00Z')`,
      );

      type Versioned = { row_version: number; updated_now: boolean };
      const returning = 'RETURNING row_version, updated_at = now() AS updated_now';

      const [renamed] = await migrator.query<Versioned>(
        `UPDATE probe_versioned SET name = 'Phở bò' WHERE id = 1 ${returning}`,
      );
      expect(renamed).toEqual({ row_version: 2, updated_now: true });

      // The statement's value is ignored: OLD.row_version + 1.
      const [forced] = await migrator.query<Versioned>(
        `UPDATE probe_versioned SET name = 'Phở gà', row_version = 99 WHERE id = 1 ${returning}`,
      );
      expect(forced?.row_version).toBe(3);

      // A background counter is not in the column list: no new version.
      const [counted] = await migrator.query<Versioned>(
        `UPDATE probe_versioned SET rating_count = 5 WHERE id = 1 ${returning}`,
      );
      expect(counted).toEqual({ row_version: 3, updated_now: true });
    });

    it('refuses a trigger attached other than BEFORE UPDATE FOR EACH ROW', async () => {
      await migrator.query(
        'CREATE TEMP TABLE probe_wrong (id integer PRIMARY KEY, row_version integer NOT NULL DEFAULT 1)',
      );
      await migrator.query(`CREATE TRIGGER probe_wrong_bump
        AFTER UPDATE ON probe_wrong
        FOR EACH ROW EXECUTE FUNCTION public.kd_bump_row_version()`);
      await migrator.query('INSERT INTO probe_wrong (id) VALUES (1)');

      await migrator.query('SAVEPOINT wrong_attachment');
      // RAISE EXCEPTION is SQLSTATE P0001.
      await expectSqlState(
        migrator.query('UPDATE probe_wrong SET row_version = 2 WHERE id = 1'),
        'P0001',
      );
      await migrator.query('ROLLBACK TO SAVEPOINT wrong_attachment');
    });
  });

  describe('as kd_app', () => {
    it('can execute the functions and use the domains', async () => {
      const [unaccented] = await app.query<{ value: string }>(
        `SELECT public.kd_unaccent('Bò kho') AS value`,
      );
      expect(unaccented?.value).toBe('Bo kho');

      const [privileges] = await app.query<Record<string, boolean>>(`SELECT
        has_function_privilege('public.kd_unaccent(text)', 'EXECUTE') AS kd_unaccent,
        has_function_privilege('public.kd_set_updated_at()', 'EXECUTE') AS kd_set_updated_at,
        has_function_privilege('public.kd_bump_row_version()', 'EXECUTE') AS kd_bump_row_version,
        has_type_privilege('public.e164_phone', 'USAGE') AS e164_phone,
        has_type_privilege('public.vnd', 'USAGE') AS vnd`);
      expect(privileges).toEqual({
        kd_unaccent: true,
        kd_set_updated_at: true,
        kd_bump_row_version: true,
        e164_phone: true,
        vnd: true,
      });
    });

    it.each(['+84901234567', '+12025550123', '+4420'])('e164_phone accepts %s', async (phone) => {
      const [row] = await app.query<{ value: string }>('SELECT $1::public.e164_phone AS value', [
        phone,
      ]);
      expect(row?.value).toBe(phone);
    });

    it.each(['0901234567', '84901234567', '+0901234567', '+84 90 123 4567', '+1234567890123456'])(
      'e164_phone rejects %s',
      async (phone) => {
        await expectSqlState(app.query('SELECT $1::public.e164_phone', [phone]), CHECK_VIOLATION);
      },
    );

    it.each([0, 45_000, 2_147_483_647])('vnd accepts %i', async (amount) => {
      const [row] = await app.query<{ value: number }>('SELECT $1::public.vnd AS value', [amount]);
      expect(row?.value).toBe(amount);
    });

    it('vnd rejects a negative amount', async () => {
      await expectSqlState(app.query('SELECT (-1)::public.vnd'), CHECK_VIOLATION);
    });
  });
});
