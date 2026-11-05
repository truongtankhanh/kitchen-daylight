import { fileURLToPath } from 'node:url';

import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions.js';

import type { CliConfig } from '../config/load-config.js';
import { OutboxEvent } from '../modules/realtime/entities/outbox-event.entity.js';

/** `apps/api/migrations/` from `src/database/` and `dist/database/` alike; `/app/migrations/` in the image. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * The single `DataSource` definition (decision 0005, section 7), shared by the server
 * (`DatabaseModule`, as `kd_app`) and the CLI (`migrate`, as `kd_migrator`). The role is the
 * one in `config.database.url`. SQL migrations run through `cli/migrate.ts`, not TypeORM.
 */
export function createDataSourceOptions(config: CliConfig): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    url: config.database.url,
    synchronize: false,
    migrationsRun: false,
    migrations: [],
    // Listed explicitly, never globbed.
    entities: [OutboxEvent],
    logging: false,
  };
}

/** `host:port/database` for messages; never the user, the password or the query string. */
export function describeDatabaseTarget(url: string): string {
  if (!URL.canParse(url)) {
    return 'the configured database';
  }
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || '5432'}/${decodeURIComponent(pathname.slice(1))}`;
}
