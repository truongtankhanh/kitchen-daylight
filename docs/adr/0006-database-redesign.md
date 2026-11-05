# ADR-0006: Database redesign for current conditions

- **Status:** **Superseded in part by [ADR-0009](0009-owner-business-pivot.md) (2026-10-27).** The conventions (UUIDv7, structured address on current administrative units, translations, opening hours as periods, media table, consent log, append-only audit, anonymised deletion) still hold and are reused in data model v5; the venue-catalog parts (venue types, cuisine tags, destinations, place-based reviews and reports) are replaced by branches, menu, orders and related tables. Original status: Scope **Accepted** by the project owner on 2026-10-21 (reviews with rating, weekly hours, tags, contacts and amenities, reporting and moderation, consent records, Vietnamese content with room for more languages). Design decisions below are **Proposed**.
- **Date:** 2026-10-21
- **Result:** [data-model.md](../data-model.md) (v3)
- **Depends on:** [ADR-0001](0001-tech-stack.md), [ADR-0002](0002-unified-place-model.md), [ADR-0003](0003-authentication.md)

## Context

The v2 draft was a trimmed port of the 2018 schema. Checking it against how food-discovery apps work today and against the law found these gaps:

| Gap | Evidence |
|---|---|
| Address is one string, and the seed addresses use administrative units that no longer exist | Vietnam moved to a two-tier system on 1 July 2025 (no district level; 63 provinces became 34; thousands of commune-level units merged). Every VER.01 address carries "Quận X" and an old ward. Sources: [PwC](https://www.pwc.com/vn/en/publications/vietnam-publications/vietnam-administrative-reform.html), [Vietnam News](https://vietnamnews.vn/politics-laws/1720781/viet-nam-sets-two-tier-local-government-system.html). |
| VER.01 "cities" are tourist areas, not administrative units | Hạ Long Bay, Hội An, Sa Pa. After the merges, Hội An and Đà Nẵng share a province, so province-keyed cities no longer work. |
| One fixed "kind" mixes two independent ideas | "Vegetarian" is a dietary property, while "Buffet" and "Street food" are kinds of venue. |
| No rating, no reporting | User-generated content needs both. |
| Opening hours have no weekday and no special days | The seed already contains an ambiguous case (`10:00 - 23:00 \| 10:00 - 02:00`). |
| No contacts, amenities or multi-valued tags | |
| No language model, no consent or deletion handling | Vietnam's Personal Data Protection Law took effect on 1 January 2026. Per secondary sources: consent must be provable and withdrawable, and location is treated as sensitive. Sources: [Tilleke & Gibbins](https://tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look), [Rajah & Tann](https://www.rajahtannasia.com/viewpoints/new-decree-implementing-the-law-on-personal-data-protection-passed/). I read commentary, not the statute. |

## Decisions

### D1. Structured address on the current administrative units
`provinces` and `wards` tables loaded from the official list, `address_line` free text, `province_code` required, `ward_code` optional, composite FK so ward and province cannot disagree, `address_legacy` kept for audit.
- *Alternative: keep one address string and rely on the geocoder.* Rejected: filtering by area, consistent display and correcting addresses all need structure.
- *Alternative: model district as well.* Rejected: the level no longer exists.
- Effective-date columns allow future reorganisations without rewriting history.

### D2. `destinations` replace `cities`; they are not administrative
Editorial areas defined by a center point and radius; a place belongs to a destination by proximity. This survives province merges and lets a small area (Hội An) coexist with a larger one (Đà Nẵng).
- *Alternative: destination as a set of wards.* More exact, but needs ward data for every destination and manual maintenance on each reorganisation.

### D3. `venue_types` plus `tags` replace the single category
`venue_types` answers "what kind of place" (one per place). `tags` (kind `CUISINE` or `DIETARY`) answer "what does it serve and for whom" (many per place). The VER.01 "Vegetarian" kind becomes a dietary tag. This also removes the guesswork of the previous migration heuristic: the data states vegetarian explicitly for 53 foods.
- `place_tags.verified_at` marks whether staff confirmed the claim.
- *Alternative: keep five kinds.* Rejected: forces one label to carry two dimensions.

### D4. Translations
- **`place_translations`** (`place_id`, `locale`, `name`, `description`) for content that is long, searched and edited per language.
- **`names jsonb` with a required `vi` key** for small admin vocabularies (venue types, tags, amenities, destinations, provinces, wards) that are read whole and never searched with trigrams.
- Brands, being proper names, are not translated.
- Adding English later means adding rows, not changing the schema.
- *Alternative: JSONB everywhere.* Rejected for places: harder to index per locale and to validate; cannot FK per translation.
- *Alternative: generic key-value translations table.* Rejected: loses typing and joins.
- *Alternative: a column per language.* Rejected: a schema change for each language.

### D5. Opening hours as relational periods and special days
`place_opening_periods` (weekday, open, close, `closes_next_day`) plus `place_special_hours` (date range, closed or alternate hours) that override the weekly periods. This supports "open now" queries with indexes.
- `CHECK` constraints keep period shape valid; overlap between periods is validated in the API.
- *Alternative: JSONB (schema.org-like).* Rejected: cannot be indexed for "open now" and has no database-level validation.
- *Alternative: minutes since start of week.* Compact, but unreadable in the database and in debugging.
- `places.hours_verified_at` records that migrated hours are an assumption.

### D6. Reviews carry a rating; aggregates are counters
`reviews.rating` 1-5, one review per user per place. `places.review_count` and `rating_sum` are updated in the same transaction and reconciled nightly; the average is derived, so it cannot drift.
- *Alternative: compute on read.* Fine at 300 places, but sorting and filtering by rating on every list then needs aggregation.
- *Alternative: materialised view.* Stale between refreshes.
- Ranking will use a smoothed score so one five-star review does not beat a hundred strong ones; that is an API decision, not a schema one.

### D7. Media table and gallery
Every image is a `media` row (type, size, hash, blurhash placeholder). `place_media` orders a gallery; position 0 is the cover.
- Prevents duplicate uploads, enables a mobile placeholder and makes future user or review photos an addition rather than a rewrite.

### D8. Contacts as rows, amenities as a vocabulary
`place_contacts` carries a `kind` per row, with `CHECK`s requiring E.164 phones and `https://` URLs only. This blocks dangerous schemes (`javascript:`) in links that the apps will open. `amenities` is a vocabulary joined to places.

### D9. Consent as an append-only event log; deletion by anonymising
- `consent_documents` + `user_consents` (granted/withdrawn events) give proof of what was accepted and when, and the withdrawal history.
- Account deletion keeps the `users` row as a scrubbed tombstone and deletes sessions, identities, favorites and history. Reviews stay attributed to the tombstone. This keeps foreign keys, aggregates and uniqueness valid while removing personal data. Whether reviews should be deleted instead is open.
- A request-tracking table (`data_subject_requests`) is **deferred** for the first release. Deletion is recorded in `audit_logs`; export, restriction and correction requests are handled manually. Revisit it with the legal review, because the law sets response deadlines.
- The server does not persist user locations, and logs must not record precise coordinates.
- *Alternative: hard-delete users.* Rejected: it orphans or cascades through reviews and breaks counters.

### D10. Governance: reports and an append-only audit log
`reports` with a target consistency `CHECK`; `audit_logs` receives staff catalog edits, moderation and role changes. The application role has `INSERT` only on `audit_logs`, so a compromised API cannot rewrite history. This also compensates for the accepted absence of MFA (ADR-0003): admin actions become traceable.

### D11. Technical conventions
UUIDv7 keys (native `uuidv7()` in PostgreSQL 18, [source](https://www.dbvis.com/thetable/uuidv7-in-postgresql-18-what-you-need-to-know/)); native enums for closed sets; `citext` email; `timestamptz` everywhere; Vietnam time zone as configuration.

## Consequences

- **About 27 tables, up from about 12.** The extra tables are justified by the accepted scope, but each adds API and admin form work. The owner delegated the trim decision (2026-10-21): `data_subject_requests` is dropped from v1, everything else in the accepted scope stays in the schema, and API and admin UI delivery is phased. If scope must shrink further, defer in this order: `destinations` (it already loads inactive), `place_special_hours`, `place_contacts` (keep only phone and website in columns), `media` gallery (cover only).
- **ORM fit (see ADR-0001).** Several objects here are database-specific: `geography` columns, GiST and unaccented trigram indexes, generated columns, `citext`, partial indexes, `CHECK` constraints, enums and role grants. They are created by hand-written SQL migrations whichever ORM is used; the ORM maps the tables and does not generate the schema. ADR-0001 accepts TypeORM. An earlier version of this ADR said Prisma has no spatial support; newer Prisma documentation describes a geometry field type and I could not confirm whether it covers `geography`, so that statement is withdrawn.
- **Dependency on an official administrative-unit dataset.** Its source and license are not identified yet.
- **Migration changes.** Venue types and tags replace the category heuristic; hours expand to seven days with an assumption flag; addresses are split and `ward_code` stays null; destinations need coordinates by hand. The migration plan must be revised.
- **API changes.** New vocabularies, report and consent endpoints, ratings, locale handling; see the impact list in `data-model.md`.
- **Encryption at rest** (EBS and S3) should be stated in ADR-0004.
- The retention periods are proposals and need legal review; nothing here is legal advice.

## Open items

1. ~~Official province and ward dataset~~ fetched on 2026-10-21 ([data/admin-units](../../data/admin-units/README.md)); its reuse terms are unverified. Its `effective_*` columns were dropped in data model v4 (ADR-0008 #17).
2. Destination geometry (phase 2; `destinations` is deferred and nullable, ADR-0008 #20).
3. Legal review of retention, consent evidence, minors and review deletion (anonymise is the working decision, ADR-0008 #4).
4. Verify `@nestjs/typeorm` compatibility with TypeORM 1.0 and `migration:generate` behaviour with PostGIS columns (TypeORM itself is accepted).
5. How to treat the VER.01 `|` opening-hours separator (migration plan v3 loads it as written, flags overlaps and expands to seven days as an assumption).
6. Data model v4 added seven tables (about 34 in total) for realtime, export, system email, provenance and runtime settings; see its change summary.
