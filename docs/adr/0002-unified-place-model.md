# ADR-0002: Unify `foods` and `restaurant branches` into a single `Place` entity

- **Status:** Accepted (option A, confirmed by the project owner). **Superseded 2026-10-27 by [ADR-0009](0009-owner-business-pivot.md):** VER.02 is now the owner's own restaurant, so there is no catalog of third-party venues to unify. `Place` becomes `branches` (the restaurant's own locations) and "foods" become `menu_items` ([data-model.md](../data-model.md) v5). The reasoning below is kept as history.
- **Date:** 2026-10-21

## Context

VER.01 has two overlapping concepts for "a place you can eat at":

- `restaurants` (brand) → `restaurants_branch` (a physical location with address, opening hours, price range).
- `foods`, despite its name, is also a physical venue: it has its own address, a price range, an image and a `kind_code` (Buffet / Vegetarian / Restaurant / Street food / Eatery). The name column holds a venue name such as "Ẩm Thực Buffet Chay An Đông".

Findings from the seed data in `cuisines.sql` (210 foods, 38 restaurants, 102 branches):

- Only 24 foods carry a `res_code`; **23 of those 24 have the same address as an existing branch**, and 21 have the same name. The same venue is stored twice.
- Branches have **no kind**, foods have **no opening hours**. Each representation is incomplete.
- The mobile app duplicates screens and endpoints for each concept (like, history and comment flows exist three times: restaurant, branch, food).
- Comments for branches reuse the `food_code` column, so the schema already treats them as one target.
- Every venue in the seed data is in Ho Chi Minh City.

## Decision

Replace `foods` and `restaurants_branch` with one **`places`** table. Keep an optional **`brands`** table for chains (the old `restaurants`).

- `place.brand_id` is nullable: standalone venues have no brand; chain outlets point to a brand.
- `place.venue_type_id` (required) replaces `kind_code`; dietary and cuisine attributes become `tags`, per [ADR-0006](0006-database-redesign.md).
- Favorites, view history and reviews all target `place_id` only.
- `number_of_branches` is no longer stored; it is derived (`COUNT(places) per brand`). One brand in the seed data already has a stored count that disagrees with its branch rows.

## Alternatives considered

- **Option B: keep `Restaurant → Branch` and `Food` as in VER.01.** Easiest to compare with the 2018 report, but keeps duplicated venues and triples every user-facing feature (favorites, history, reviews, map). Rejected by the project owner.
- **Single table with a `type` discriminator (`brand`/`branch`/`standalone`) instead of two tables.** Rejected: a brand has no address, location or price, so most columns would be null, and the constraints get weaker.

## Consequences

- One code path per feature in the API, admin and mobile app instead of three parallel ones (restaurant, branch, food) for favorites, history and reviews.
- Migration must deduplicate: a food row that matches a branch (same normalized address, or name) is merged into that branch's place instead of creating a second place. Anything unmatched becomes its own place. Details are in `docs/data-model.md`.
- Branches have no venue type in VER.01; migration assigns a default and a heuristic dietary tag (see `data-model.md`) that must be reviewed.
- The 2018 report's class/ER diagrams no longer match the new model. This is expected; VER.01 remains the reference for behavior, not for structure.
