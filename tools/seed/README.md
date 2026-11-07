# `@kd/seed`

The seed tool ([migration-plan.md](../../docs/migration-plan.md), "Tools"; decision 0005 section 8). It writes reference and business data with its own SQL through `pg` and imports nothing from `apps/api`; the only workspace package it reads is `@kd/seed-data` (decision 0003 section 6).

```sh
pnpm --filter "@kd/seed..." build
pnpm --filter @kd/seed seed reference            # dry run: plans, runs the SQL, rolls back
pnpm --filter @kd/seed seed reference --commit   # writes
node dist/cli.js --help                          # usage and exit codes, no database needed
```

In the API image the same command is `node seed/dist/cli.js <mode> [--commit]`, run from `/app` by the `migrate` service.

## Modes

| Mode        | State                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `reference` | step `geography` (A2-T3). Still to come: amenities (A5-T1), tags (A6-T4), settings, consents, first ADMIN (A4-T5) |
| `business`  | not implemented (A13): exits 2                                                                                    |
| `demo`      | not implemented (A13): exits 2; refused when `APP_ENV=prod`                                                       |

## How a run works

1. Parse the arguments (exit 2 on a usage error), then read `APP_ENV` and the database URL: `DATABASE_URL` in a container, `DATABASE_URL_MIGRATOR` on the host, not both (exit 3). The `seed` script loads the root `.env`; messages name a variable and a rule, never a value.
2. Open one connection as `kd_migrator`, `BEGIN`, and take a transaction-scoped advisory lock, so two runs never interleave.
3. For each step of the mode, in order: **plan** (read the source files and the tables, count what would change), **apply** (the upserts), then check that each table changed exactly the planned `inserted + updated` rows (exit 4 otherwise), and print one line per table:

   ```
   geography  provinces  inserted 0  updated 0  unchanged 34  stale 0
   geography  wards  inserted 0  updated 1  unchanged 3320  stale 0
   ```

4. Without `--commit`, `ROLLBACK`: a dry run runs the same SQL and writes nothing. With `--commit`, `COMMIT`. Any error rolls back.

A re-run against the same files reports `inserted 0  updated 0` for every table (migration-plan principle 3).

## Step `geography`

- Reads `@kd/seed-data/admin-units/provinces.json` and `wards.json` (`rows[]` with `code`, `names { vi, vi_full }`, `type`, and `province_code` for wards; `region` is ignored).
- Checks every row before any statement: 2-digit province codes, 5-digit ward codes, known types, non-empty `vi` and `vi_full`, no duplicate code, every ward's province in `provinces.json` (exit 4 on the first broken row).
- Upserts `provinces`, then `wards`, by `code` with `ON CONFLICT (code) DO UPDATE ... WHERE` the row differs: a changed name, type or province is updated in place (ADR-0008 #17), an equal row is not touched.
- Never deletes. A code in the table but not in the file is reported as **stale** (count and the first ten codes), because branches and addresses may reference it.

> **Reuse terms unverified.** The admin-unit files come from the NSO web service, whose license was not found (see [`tools/seed-data/admin-units/README.md`](../seed-data/admin-units/README.md)). Check the reuse terms with the owner before any public redistribution.

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| 0    | success, including a dry run and "nothing to change"                          |
| 1    | runtime failure: connection, SQL error (rolled back), unexpected error        |
| 2    | usage: unknown mode, option or argument; a mode not implemented yet           |
| 3    | configuration invalid, or a mode refused for this `APP_ENV`                   |
| 4    | integrity: a source file breaks a rule, or a table changed other than planned |

An error prints its name and its SQLSTATE or Node code only, never the driver's message (it may name a host or a role).

## Adding a step

A step is a `SeedStep` (`src/steps/step.ts`): a `name`, `plan(client)` returning the counts per table, and `apply(client)` returning the rows each table changed. Add it to the mode's list in `src/steps/index.ts`, after the steps whose tables it references. Keep `plan` read only, and make `apply` an upsert whose `WHERE` matches the plan's notion of "unchanged", so that the runner's check holds and a re-run changes nothing.
