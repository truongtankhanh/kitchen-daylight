# `@kd/seed`

The seed tool ([migration-plan.md](../../docs/migration-plan.md), "Tools"; decision 0005 section 8). It writes reference and business data with its own SQL through `pg` and imports nothing from `apps/api`; the only workspace package it reads is `@kd/seed-data` (decision 0003 section 6), plus its own `data/` folder.

```sh
pnpm --filter "@kd/seed..." build
pnpm --filter @kd/seed seed reference            # dry run: plans, runs the SQL, rolls back
pnpm --filter @kd/seed seed reference --commit   # writes
pnpm --filter @kd/seed seed verify reference     # read-only checks, one line each
node dist/cli.js --help                          # usage and exit codes, no database needed
```

In the API image the same command is `node seed/dist/cli.js <mode> [--commit]` (or `verify <scope>`), run from `/app` by the `migrate` service; the image also holds `seed/data/`.

## Modes

| Mode        | State                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `reference` | steps `geography` (A2-T3), `app-settings`, `consent-documents`, `first-admin` (A4-T5). Safe in every tier, `prod` included |
| `business`  | not implemented (A13): exits 2                                                                                             |
| `demo`      | not implemented (A13): exits 2; refused when `APP_ENV=prod`                                                                |

**Steps still to come in `reference`**, each added to `referenceSteps` in `src/steps/index.ts` by the task that owns it: amenities and tags (A6-T5, the vocabulary seed), email templates with `MFA_RESET_NOTICE` (A12-T3) (api-divergences D-125).

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

## Step `app-settings`

- Reads `data/app-settings.defaults.json`: the eight storage keys (`brand`, `reports`, `min_app_version`, `maintenance`, `feature_flags`, `payment`, `ordering`, `loyalty`) in the stored snake_case form, with the WA14 and WA16 references in `_meta`.
- Checks the file against `src/settings-rules.ts` before any statement (exit 4 on a broken value).
- Inserts a key **only when it has no row**: `ON CONFLICT (key) DO NOTHING`. A value the owner edited is never overwritten, so `updated` is always 0.

> **Two copies.** The file is a copy of the API's `SETTING_DEFAULTS`, and `settings-rules.ts` a hand-written mirror of the API's settings DTOs, because this package may not import `@kd/api`. They can drift (api-divergences D-122): `verify reference` checks the stored rows against the rules, and the A4-T6 sheet compares the defaults printed here with `GET /admin/app-settings`. A shared check is a follow-up.

## Step `consent-documents`

Two sources, never both (api-divergences D-126):

- **Default: the committed placeholders** in `data/consent-documents.placeholder.json`: one `TERMS_OF_SERVICE` and one `PRIVACY_POLICY` for `vi`, version `placeholder-1`, whose first line says in Vietnamese that the text is a placeholder and not legal text. A type gets its placeholder only when **no document of that type and locale has text**; a row from before migration 0012 (no text) does not block, so it is healed without a reset.
- **`SEED_CONSENT_DOCUMENTS_FILE`: the owner's real documents**, see below.

The SHA-256 of the UTF-8 text is computed here and checked again by the database (migration 0012). A published row is never changed or deleted: a new version is a new row, and the latest `published_at` is current.

> **Placeholder text is not legal text.** `verify reference` FAILs in `prod` while a current document is a placeholder: publishing the real Terms and Privacy is a go-live step.

### Publishing the real Terms and Privacy

The text comes from the owner and counsel and never enters the repository. Keep it in private storage as a JSON file of the same shape as the placeholder file:

```json
{
  "rows": [
    { "type": "TERMS_OF_SERVICE", "locale": "vi", "version": "2026-12-01", "content": "..." },
    { "type": "PRIVACY_POLICY", "locale": "vi", "version": "2026-12-01", "content": "..." }
  ]
}
```

- `locale` is `vi` only (registration accepts `vi` documents only); `version` is 1 to 50 characters and never starts with `placeholder-`; `content` is the full text and not the placeholder text. One type alone is fine (a new Privacy version only).
- Run with the absolute path, first as a dry run:

  ```sh
  SEED_CONSENT_DOCUMENTS_FILE=/secure/legal-documents.json pnpm --filter @kd/seed seed reference
  SEED_CONSENT_DOCUMENTS_FILE=/secure/legal-documents.json pnpm --filter @kd/seed seed reference --commit
  pnpm --filter @kd/seed seed verify reference
  ```

  In a container, mount the file read-only and pass the variable to `node seed/dist/cli.js reference --commit`.

- Each (type, version, locale) is inserted once with `published_at` now, so it becomes current at once; a re-run changes nothing. Changing a published version's text exits 4: give the new text a new `version`.

## Step `first-admin`

- Reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_NAME` (root `.env` or the environment; decision 0005 section 2): both or neither. Neither skips the step; one alone, an invalid email or a name outside 1 to 60 characters exits 3.
- Inserts one user, role `ADMIN`, status `INVITED`, locale `vi`, no password and no MFA credential, **only when no user has that email** (`ON CONFLICT (email) DO NOTHING`); an existing user is never touched.
- The report prints the email domain only. The person opens the admin "forgot password" page, which sends an `INVITED` account a fresh invitation, sets a password and enrols TOTP at the first sign-in.

Creating the first ADMIN of a tier, once (the values are personal data: set them in the environment of that run only, never in a committed file):

```sh
SEED_ADMIN_EMAIL=owner@kitchendaylight.example SEED_ADMIN_NAME="Owner Example" \
  pnpm --filter @kd/seed seed reference --commit
```

In a container, pass both variables to the `migrate` service run of `node seed/dist/cli.js reference --commit` (the Docker repository does not set them yet; without them the step is skipped and `verify reference` FAILs "admin users").

## `verify reference`

Read only, in a `READ ONLY` transaction that is rolled back; no `--commit`. One line per check, `ok` or `FAIL`, with counts, keys, field paths or types, never a row's content:

```
  ok    provinces count
  ok    wards count
  ok    wards have their province
  ok    app_settings brand
  ...
  ok    consent_documents TERMS_OF_SERVICE vi (placeholder text, refused in prod)
  ok    admin users
verify reference: passed
```

Checks: the province and ward counts equal the committed JSON; every ward has its province; the eight settings keys exist and pass the rules; the current `vi` document of each type exists and has text, and is not a placeholder when `APP_ENV=prod`; at least one `ADMIN` with status `INVITED` or `ACTIVE`. Two active admins with TOTP (acceptance check 8) and the other scopes are A13-T4. Exit 0 when every check passes, 4 when one fails.

## Checking the image

The API image copies `tools/seed/data` to `/app/seed/data` (`apps/api/Dockerfile`), because the steps read `../../data/` from `dist/steps/`. After a change to the Dockerfile, the owner checks it:

```sh
docker build -f apps/api/Dockerfile -t kd-api:local .
docker run --rm kd-api:local ls /app/seed/data
docker run --rm kd-api:local node seed/dist/cli.js --help
```

## Exit codes

| Code | Meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | success, including a dry run and "nothing to change"                                                   |
| 1    | runtime failure: connection, SQL error (rolled back), unexpected error                                 |
| 2    | usage: unknown mode, option or argument; a mode not implemented yet                                    |
| 3    | configuration invalid, or a mode refused for this `APP_ENV`                                            |
| 4    | integrity: a source file breaks a rule, a table changed other than planned, or a `verify` check failed |

An error prints its name and its SQLSTATE or Node code only, never the driver's message (it may name a host or a role).

## Adding a step

A step is a `SeedStep` (`src/steps/step.ts`): a `name`, `plan(client)` returning the counts per table, and `apply(client)` returning the rows each table changed. Add it to the mode's list in `src/steps/index.ts`, after the steps whose tables it references. Keep `plan` read only, and make `apply` an upsert whose `WHERE` matches the plan's notion of "unchanged", so that the runner's check holds and a re-run changes nothing.
