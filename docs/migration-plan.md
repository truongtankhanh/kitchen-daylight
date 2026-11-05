# Data plan: seed the restaurant's real data (v4)

Status: **draft for review** (2026-10-27, revised 2026-10-28 for data model v5.1). Replaces the VER.01 migration plan (v3), which converted 289 third-party venues. Under [ADR-0009](adr/0009-owner-business-pivot.md) VER.02 is a rebuild for the owner's own restaurant, and the owner confirmed that VER.01 is not mapped exactly. The VER.01 conversion pipeline (`tools/migrate-ver01`) is **dropped**; the pre-pivot version of this file is kept only in the backup.

## What data the app needs on day one

| Data | Source | Owner of the content |
|---|---|---|
| `provinces`, `wards` | [data/admin-units](../data/admin-units/README.md) (34 and 3,321 rows, official service) | Fetched; reuse terms unverified |
| Brand settings (`app_settings.brand`), consent documents (Terms, Privacy) | The owner and counsel | Owner; legal text is an open item |
| Branches (address, pin, phone, hours, services, delivery zones, tables) | The owner | Owner |
| Menu: categories, items, descriptions, prices, options, tags, photos | The owner | Owner. **Photos and descriptions must be the restaurant's own**, so the image-rights risk of earlier drafts disappears for this content |
| Amenities and tags vocabularies | Us (editorial) | Us, reviewed by the owner |
| First `ADMIN` account | Environment variables at seed time | Owner |
| Email templates, loyalty settings | Us (defaults) | Owner reviews |

## Principles

1. **Seed, don't migrate.** Real data is entered once through the admin or loaded from files the owner provides (a spreadsheet of the menu is the likely form). Nothing is read from VER.01.
2. **Dry-run by default;** writing needs `--commit`. A dry run prints what would change.
3. **Idempotent and re-runnable,** keyed by slugs and codes, so the same file can be loaded in `dev`, `demo` and `prod`.
4. **No personal data in fixtures, and the restaurant's real data is not committed (the repositories are public, ADR-0010).** The real menu, prices, photos, bank details and tax code arrive from private storage at deploy time; only synthetic examples and templates live in the repository. Sample customers, orders and staff are synthetic and use reserved domains (`example.com`, `kitchendaylight.example`).
5. **Same pipeline in every tier;** `prod` receives only data the owner has approved in `demo`.
6. **Production safety guard** (ADR-0004) applies: a synthetic seed can never run with `APP_ENV=prod`.

## Tools

Package `tools/seed` (replaces `tools/migrate-ver01` and `tools/import-overture` in [scaffold-plan.md](scaffold-plan.md)):

| Command | Purpose |
|---|---|
| `seed reference` | `provinces`, `wards`, amenities, tags, default `app_settings` (`brand`, `payment` empty, `ordering` with the accepted defaults of `WA16`, `reports.business_day_starts_at` = `04:00`, `loyalty`, feature flags), email templates (including `MFA_RESET_NOTICE`), the first `ADMIN`, who must set up TOTP at the first sign-in. Safe in every tier. |
| `seed business --file <path>` | Branches (with their `code`), hours, special days, delivery zones, tables, menu categories, items with their `sort_order`, option groups and options, per-branch availability and stock, from a structured file (JSON or CSV templates the owner fills in). Validates every price (integer VND), hours shape, E.164 phones, and that every item has a Vietnamese name. Reports problems; loads only valid rows. |
| `seed images --dir <path>` | Validates (magic bytes, size, decodability), resizes, computes `sha256` and `blurhash`, uploads through `StoragePort`, links as cover or gallery by file-name convention. The original file name is never used in an object key. |
| `seed demo` | Synthetic customers, orders, reservations and reviews for `dev` and `demo` only, to make the live board and reports demonstrable. Orders follow the status machine and the arithmetic of the data model (`total = subtotal - discount_total + delivery_fee`), include couriers, paid and refunded cases and a spread of `business_date` values for the Excel report. Refuses to run in `prod`. |
| `verify` | Acceptance checks below. |

## Acceptance checks

0. `app_settings.brand` has the business name, address, hotline, optional tax code and the receipt settings (title, footer, paper width) before the first real order, because every printed receipt uses them.
1. Every branch has a unique `code` (2 to 4 letters, the order-number prefix), a confirmed `location`, a phone, at least one hours period and, if delivery is on, an active zone.
2. Every active menu item has a Vietnamese name, a price greater than zero, a cover photo with `blurhash`, and an offered row in at least one branch.
3. Option groups obey `min_select <= max_select`; no active item has an empty required group.
4. No dangling foreign keys; every `media.storage_key` resolves in the tier's bucket.
5. Dietary and allergen tags are unverified until a manager confirms them (`verified_at` null), and the apps label them so.
6. No row, log or fixture contains a real customer's personal data; no secret is committed.
7. Re-running a seed command changes nothing (idempotency).
8. Before go-live in `prod`: at least two active `ADMIN` accounts with TOTP set up and recovery codes stored (ADR-0009 `WA20`); if `BANK_TRANSFER` is offered, `app_settings.payment` is filled; every branch that accepts delivery has an active zone; the accepted `ordering` defaults are present.

## Not done on purpose

- **No VER.01 conversion,** including its venues, members, likes, history and images. If any VER.01 text or photo is wanted later, the owner must confirm they own it (the old report says VER.01 imitated a public app).
- **No open-data place import** (Overture, OpenStreetMap): irrelevant to a single restaurant. [data-sources.md](data-sources.md) keeps value only for the administrative-unit fixtures.

## Tier procedure

| Tier | Run |
|---|---|
| `dev` | Reference + business seed + `seed demo`; repeat freely. Emulated mail and storage; geocoder fixture. |
| `demo` | Same files as `prod` will get, with real S3 and SES (sandbox); the owner reviews the menu, branches and photos on a real build. |
| `prod` | `seed reference` and `seed business` from CI or a one-off task after the owner approves `demo`. Snapshot and `pg_dump` first (ADR-0004). Never `seed demo`. |

## Open items

1. The owner's actual data: branch list and addresses, opening hours, delivery areas, the menu with prices and options, and photos.
2. Format the owner will fill in (spreadsheet columns); em will provide a template with the schema constraints noted per column.
3. Legal text for Terms and Privacy (also needed for App Store and Google Play).
4. Whether any VER.01 content is the owner's own and reusable.
