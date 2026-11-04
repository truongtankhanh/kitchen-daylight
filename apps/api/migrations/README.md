# Migrations

Hand-written SQL is the source of truth of the schema (ADR-0001, decision 0005 section 7). TypeORM never creates or changes the schema: `synchronize` and `migrationsRun` are off, and `migration:generate` is not used.

There is no migration in the foundation. The first one arrives with the first slice that needs a table.

## Naming

- `NNNN_snake_case_description.sql`: four digits, then a lowercase `snake_case` description, for example `0001_initial_schema.sql`.
- Versions are unique and increase. A new file must sort after the last applied one.
- Other files in this folder (this README) are ignored.

## Rules

- **SQL first.** Write the SQL by hand. Entities map tables that a migration already created; spatial and database-specific objects (PostGIS columns, trigram indexes, the `unaccent` wrapper) live only in SQL.
- **Never edit a merged file.** The runner stores each file's SHA-256 and refuses to run when an applied file changed or disappeared. A fix is a new file.
- **One transaction per file.** A failing file is rolled back and nothing after it runs. A file whose first line is `-- kd:no-transaction` runs outside a transaction, for `CREATE INDEX CONCURRENTLY`; keep it to a single statement.
- **Do not create extensions.** `postgis`, `pg_trgm`, `unaccent` and `citext` are created by the database provisioning, and the preflight checks them. `CREATE EXTENSION IF NOT EXISTS` is allowed only as a no-op safety.
- **`uuidv7()`** comes from PostgreSQL 18 core; no application-side fallback.

## Roles

- Migrations run as **`kd_migrator`**, the only role with DDL. The preflight refuses any other `current_user`.
- The application connects as **`kd_app`** and never runs DDL.
- The Docker baseline grants `kd_app` `SELECT, INSERT, UPDATE` on new tables and `USAGE` on new sequences by default. Anything stricter is written in the migration that creates the table: `REVOKE UPDATE` on the append-only tables (`audit_logs`, `order_status_events`, `stock_movements`, `loyalty_ledger`, `user_consents`), and `DELETE` only where the data model allows it (never on `orders` and their children).

## Running

```sh
pnpm --filter @kd/api build
pnpm --filter @kd/api migrate        # node dist/cli.js migrate
node dist/cli.js --help              # usage and exit codes, no database needed
```

The runner takes a session advisory lock, runs the preflight (role, PostgreSQL 18, the four extensions in `public`, `uuidv7()`), then applies the pending files and records them in `public.schema_migrations`. A second run applies nothing and exits 0.

| Exit code | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| 0         | success, including "nothing to apply"                    |
| 1         | runtime failure: connection, SQL error, unexpected error |
| 2         | usage error                                              |
| 3         | configuration invalid                                    |
| 4         | preflight or integrity check failed                      |
