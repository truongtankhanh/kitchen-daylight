import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { expect, inject } from 'vitest';

import { createDataSourceOptions } from '../../src/database/data-source.js';

/** SQLSTATE `insufficient_privilege`. */
export const PERMISSION_DENIED = '42501';
/** SQLSTATE `check_violation`, also raised by a domain `CHECK`. */
export const CHECK_VIOLATION = '23514';

export type DatabaseRole = 'kd_app' | 'kd_migrator';

/** One dedicated connection, so `BEGIN`, `SAVEPOINT` and `ROLLBACK` apply to the next statements. */
export interface RoleClient {
  readonly role: DatabaseRole;
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<Row[]>;
  /** Expects `sql` to fail with SQLSTATE `42501`. Outside a transaction, or inside a savepoint. */
  expectPermissionDenied(sql: string, parameters?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

/** Expects `work` to reject with a driver error of SQLSTATE `sqlState` (TypeORM copies `code`). */
export async function expectSqlState(work: Promise<unknown>, sqlState: string): Promise<void> {
  await expect(work).rejects.toMatchObject({ code: sqlState });
}

function urlOf(role: DatabaseRole): string {
  const urls = inject('kdTestDatabase');
  return role === 'kd_app' ? urls.appUrl : urls.migratorUrl;
}

/**
 * Opens one connection to the test database as `role` (TypeORM's `postgres` driver is `pg`; the
 * repository has no `@types/pg`, so the client goes through TypeORM) and checks `current_user`.
 */
export async function openRoleClient(role: DatabaseRole): Promise<RoleClient> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: urlOf(role),
    entities: [],
    logging: false,
    extra: { max: 1 },
  });
  await dataSource.initialize();
  const runner: QueryRunner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    const rows: { current_user: string }[] = await runner.query(
      'SELECT current_user::text AS current_user',
    );
    if (rows[0]?.current_user !== role) {
      throw new Error(`The test connection is not ${role}.`);
    }
  } catch (error) {
    await runner.release();
    await dataSource.destroy();
    throw error;
  }

  // Structured result: without it, TypeORM returns `[rows, rowCount]` for UPDATE and DELETE but
  // `rows` for every other command (PostgresQueryRunner.query). `records` is always the rows.
  const query = async <Row>(sql: string, parameters?: unknown[]): Promise<Row[]> => {
    const result = await runner.query(sql, parameters, true);
    return (result.records ?? []) as Row[];
  };

  return {
    role,
    query,
    expectPermissionDenied: (sql, parameters) =>
      expectSqlState(runner.query(sql, parameters), PERMISSION_DENIED),
    async close() {
      await runner.release();
      await dataSource.destroy();
    },
  };
}

/** A `kd_app` connection: what the application role may and may not do. */
export function openAppRole(): Promise<RoleClient> {
  return openRoleClient('kd_app');
}

/**
 * The server's own `DataSource` options (entities included) as `kd_app` on the test database, for
 * specs that drive a service with a real `EntityManager`. The caller destroys it in `afterAll`.
 */
export async function openAppDataSource(): Promise<DataSource> {
  const dataSource = new DataSource(
    createDataSourceOptions({ appEnv: 'test', database: { url: urlOf('kd_app') } }),
  );
  await dataSource.initialize();
  return dataSource;
}
