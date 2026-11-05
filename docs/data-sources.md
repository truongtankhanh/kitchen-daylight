# Data sources: review of the tables and what can be fetched

> **Mostly obsolete (2026-10-27, [ADR-0009](adr/0009-owner-business-pivot.md)).** The open-data place import (sections 1 and 3 to 5) is dropped because VER.02 is the owner's own restaurant, not a venue directory. Only the administrative-unit fixtures (section 2, [../data/admin-units](../data/admin-units/README.md)) stay useful, for branch and customer delivery addresses. The text below is kept as research history.

Status: **draft for review (2026-10-21); decisions taken 2026-10-27.** The recommendation in section 3 (option D, import in advance and answer GPS queries locally) and the findings 1, 3, 4 and 5 of section 4 were accepted as a batch in [ADR-0008](adr/0008-open-items-resolution.md) (#13 to #19): `effective_*` dropped, `place_sources` added to [data model v4](data-model.md), `ward_boundaries` deferred, imported places shown only at confidence 0.8 or higher with a visible "chưa xác minh" label. Cafés in or out, the one-province spike and the capacity check are still open. Reviews every table in [data-model.md](data-model.md) (v3) for where its data can come from, fetches what a trustworthy source provides, and answers whether place data can be sourced by GPS. Seed files and probe scripts are in [../data/](../data/).

## Summary

| Question | Answer |
|---|---|
| Which tables can be filled from a trustworthy external source? | `provinces` and `wards` (official, done: 34 and 3,321 rows). Place candidates (`places` and children) can come from open datasets, but as unverified drafts. Nothing else has an external source worth using: the rest is editorial, user-generated or system data |
| Can place data be fetched live by the user's GPS? | **Not from a third-party service at request time** (license, architecture and coverage reasons below). **Yes from our own database**, filled in advance from an open dataset (Overture Maps first, OpenStreetMap as a supplement) and queried by GPS with PostGIS |
| Biggest decision for the owner | Whether imported, unverified places may appear in the app (labelled), because staff cannot verify about 90,000 to 300,000 places |

## 1. Table-by-table review

"Source" means where the rows come from. **Seed** = loaded once or rarely; **Import** = bulk-loaded from outside and then curated; **Staff** = typed in the admin; **Users** = created in the app; **System** = written by the API.

| Table | Source | Verdict |
|---|---|---|
| `provinces`, `wards` | Official (NSO web service) | **Done**: [admin-units](../data/admin-units/README.md). Findings 1 and 2 |
| `destinations` | Staff; coordinates could come from Wikidata (CC0, not checked) | Mobile now uses GPS, so nothing consumes it; the admin screen A10 and the table can be deferred (ADR-0006 lists deferral candidates) |
| `brands` | VER.01 (38) + Staff; chains could be matched by Overture `brand.wikidata` | Keep manual. Optional later: derive from imported places |
| `venue_types`, `tags`, `amenities` | Seed by us (editorial vocabularies) | No external source needed. The import needs a mapping from Overture / OSM categories (finding 6) |
| `places`, `place_translations` | VER.01 (289) + Import candidates + Staff | See section 3. Finding 5 |
| `place_tags`, `place_amenities` | Import (category, `diet:*`, `internet_access` …) + Staff | Imported dietary tags are always unverified (`verified_at` null) |
| `place_contacts` | Import: phones, websites, social links | Overture has phones for 85% of places near Bến Thành. Needs a normaliser (finding 7) |
| `place_opening_periods`, `place_special_hours` | Staff; OSM `opening_hours` for about 15% of OSM places | Overture has **no hours**. Imported places will have none, and "open now" cannot be computed for them (finding 8) |
| `media`, `place_media` | Staff uploads | **No usable external source**: neither dataset has photos; photos from Google, Foody or Facebook cannot be copied. Image rights for VER.01 are still an open risk (migration plan) |
| `users`, `auth_identities`, `refresh_tokens`, `email_tokens` | Users, System | Not applicable |
| `consent_documents` | Legal text written with counsel | Not applicable; a template is not a data source |
| `user_consents`, `favorites`, `view_history` | Users | Not applicable |
| `reviews`, `reports` | Users | **Do not import external reviews or ratings**: Google and Foody terms forbid it (Google: see section 3). Imported places start with zero reviews |
| `audit_logs`, proposed `outbox_events`, `export_jobs`, `email_messages`, `email_templates` | System | Not applicable |

## 2. Fetched: administrative units

Built from the NSO web service `danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx` (SOAP, no key). Details, checks and the field mapping are in [../data/admin-units/README.md](../data/admin-units/README.md).

- 34 provinces (9 `CITY`, 25 `PROVINCE`) and 3,321 commune-level units (709 wards, 2,599 communes, 13 special zones); HCMC has 168 units.
- Codes match a second community dataset exactly; names match after normalising whitespace and tone-mark placement.
- Reproducible: `node fetch.mjs`, validated by `node verify.mjs`.
- Why this matters beyond the seed: the structure is still changing. Between 2025-07-01 and 2026-10-21 the same service shows 3 provinces moving from `PROVINCE` to `CITY` and 22 communes from `Xã` to `Phường`, all with unchanged codes. The loader must be re-runnable and the schema must tolerate renames (finding 1).

## 3. Place data by GPS: is it feasible?

### What was measured (2026-10-21)

Overture Maps places, release 2026-09-23.1, "food and drink" categories, a 4 x 4 km box (about 16 km²) around each point, read straight from the public bucket with DuckDB (`data/poi-feasibility/overture_probe.py`). OpenStreetMap through the public Overpass instance, a 2 km radius circle (about 12.6 km²), `amenity` restaurant, fast food, cafe, food court, bar, pub, ice cream (`osm_probe.sh`). The areas differ by a factor of 1.27, so Overture's lead below is overstated by that factor.

| Area | Overture | OpenStreetMap |
|---|---|---|
| HCMC, Bến Thành | 13,304 | 1,569 |
| Hà Nội, Hoàn Kiếm | 9,319 | 1,708 |
| Hội An | 1,810 | 764 |
| HCMC, Thủ Đức | 2,503 | 88 |
| Hà Giang town | 394 | 100 |
| Bạc Liêu | 630 | 5 |

| Field | Overture, Bến Thành box | OSM, Bến Thành circle |
|---|---|---|
| Name | all | 75% |
| Address | 98% | street 38%, house number 34% |
| Phone | 85% | 13% |
| Website | 35% | 8% |
| Social link (mostly Facebook) | 99% | not a standard key |
| Opening hours | **field does not exist** | 15% |
| Cuisine or category | all (taxonomy) | cuisine 39% |
| Vegetarian / vegan | by category (`vegetarian_restaurant`) | `diet:vegetarian` 9% |
| Photos, rating, price | **none** | none (image 0.2%) |
| Quality signal | `confidence` 0 to 1: average 0.62; at least 0.8 for 28% (3,724); at least 0.5 for 68% (8,989) | none |
| Closed or moved | `operating_status` was empty for every row | not distinguishable |
| Sources / license | 13,088 Meta, 147 Foursquare (Apache-2.0), 35 Microsoft, 34 AllThePlaces (CC0); dataset license CDLA-Permissive-2.0 | ODbL 1.0 |

Vietnam as a whole in Overture: 313,399 food and drink places, 86,157 with confidence at least 0.8; one DuckDB scan of the country took about 36 seconds.

**Not verified:** I did not check any sample on a map or by phone, so I cannot say how many of the 13,304 are duplicates, closed, or private individuals' pages. Treat the counts as an upper bound of candidates, not of real venues.

### Options for "by GPS"

| Option | Verdict | Why |
|---|---|---|
| A. Call Google Places Nearby on each app request | **No** | The Places policies let you keep only the `place_id` indefinitely and latitude/longitude for 30 days; details, photos and reviews cannot be stored, and results shown on a map must be shown on a Google Map with attribution. That conflicts with the MapLibre and OpenStreetMap decision (ADR-0005) and with favorites and reviews that need a stable local place id. I read search excerpts of the terms, not the live pages, and did not check prices |
| B. Query public Overpass (OSM) on each request | **No** | The public instance is for light use and asks commercial users to run their own; coverage outside the big cities is thin (Thủ Đức 88, Bạc Liêu 5); no hours, photos or ratings |
| C. Query Overture Parquet on each request | **No** | A country scan took 36 s; it is a bulk file format, not a low-latency service |
| D. **Import into our own PostGIS in advance, answer GPS queries locally** | **Yes, recommended** | `GET /places/nearby` already works this way (PostGIS, GiST index). Licenses allow storage. Latency, cost and availability are ours |
| E. D plus "fill an area when users ask": publish an area's candidates when a user's GPS lands in a region with few places | Possible refinement of D | Same data, decided by a publishing rule (below) |

### Recommended pipeline for D

1. **Select** from the Overture snapshot: country VN, food and drink, confidence above a threshold (for example 0.5: about 231,000 places; 0.8: about 86,000), plus name and a point.
2. **Normalise** into our model: category → `venue_types` and tags (mapping table, finding 6); phones to E.164 and websites to `https://` (the table CHECKs require both); address text kept as `address_line`; `ward_code` and `province_code` derived from the point (needs ward boundaries, finding 4).
3. **De-duplicate** against the 289 VER.01 places and between sources (distance plus name similarity); the VER.01 record wins.
4. **Load as `DRAFT`** with provenance (finding 5) so staff can promote them and so a later snapshot can update them.
5. **Publish rule** (owner decision): either only staff-promoted places appear, or imported places above a confidence threshold appear with a visible "Thông tin từ nguồn mở, chưa xác minh" label and with the existing missing-data states ("Chưa có đánh giá", "Đang cập nhật", no hours, no photo). The honest-data principle favors the label; the cost is a thinner card than the designs show.
6. **Refresh** quarterly (Overture publishes monthly), as a re-runnable job, never overwriting fields staff edited.
7. **Attribution**: keep the license text for CDLA-Permissive-2.0, the Apache-2.0 notice for Foursquare-sourced rows, and "© OpenStreetMap contributors" wherever OSM-derived rows are used.

### Risks and open points for D

- **ODbL (OSM)**: its share-alike applies to a derived database when it is made publicly available; mailing-list discussion I found is from 2009 and 2010 and not authoritative. Using only Overture avoids the question; use OSM only for hours and diet tags after a legal read.
- **Personal data**: phone numbers and pages of sole proprietors are in the Overture data. Vietnam's personal data law (effective 2026-01-01) was not reviewed here.
- **Quality**: closed businesses and duplicates will exist; no operating status is provided. A "report wrong information" flow (M7, frame 06) and staff review of reported places become the main correction loop.
- **Volume**: 86,000 to 313,000 `places` rows with children is small for PostgreSQL, but the admin list needs the paging and search pattern already designed (designs/web frame 17), and the editor's "Cần xử lý" filter would be dominated by imported rows unless filtered by source.
- **Scope**: coffee shops, bubble tea, bakeries and bars are most of the food and drink rows near Bến Thành. Whether the product includes cafés (VER.01 had only restaurant kinds) is a product decision.

## 4. Findings for the data model

1. **`effective_from` / `effective_to` cannot hold history while `code` is the primary key.** The official service changed the type or name of 25 units under unchanged codes in 16 months. Either drop the two columns for now and update rows in place, or use a composite key (`code`, `effective_from`) and make `places` reference the code only.
2. **Two spelling conventions for tone marks** ("Hoà" 81 names, "Hòa" 181) and 7 communes with apostrophe variants in the official data. Search is unaffected (`unaccent`), but one convention should be chosen for display. The fixture keeps the official spelling.
3. **`names.vi_full`** is an extra key beyond the required `vi`; the app needs the prefix-less name for compact labels and the full name for formal ones.
4. **No ward boundaries.** Deriving `places.ward_code` from a GPS point, and showing the ward on the location line of the Home screen, need a boundary table (for example `ward_boundaries(ward_code, geom)`). A community GIS dataset exists (derived from `sapnhap.bando.com.vn`); its boundary license is not verified.
5. **No provenance for imported places.** Add a source table (for example `place_sources(place_id, source, external_id, license, confidence, fetched_at)`) or columns on `places`, so imports can be refreshed, attributed and filtered.
6. **Category mapping.** Overture's top categories near Bến Thành: restaurant 2,814, coffee_shop 2,613, cafe 1,034, diner 930, vietnamese_restaurant 831, bakery 569, bar 509, bubble_tea_shop 279. `venue_types` today has restaurant, eatery, buffet, street-food; a mapping and a decision on cafés are needed.
7. **Contact normalisation.** Overture phones come as `+842838567746` but also `02822102308`; the E.164 CHECK rejects the second form. Websites may be `http://`; the CHECK needs `https://`.
8. **Imported places have no hours**, so the "Đang mở" label, the open-now filter and "Đóng cửa lúc …" cannot be shown for them. The designs treat hours as optional only in the M4 detail; M1 to M3 cards need an explicit "Chưa có giờ mở cửa" state.
9. **VER.01 addresses use districts that no longer exist.** Community old-to-new mapping tables exist (one claims 10,977 rules); not evaluated.

## 5. Next steps (proposed)

1. Owner decisions: publish rule for imported places (section 3, step 5), cafés in or out, quarterly refresh.
2. Resolve finding 1 and add `place_sources` and `ward_boundaries` to data-model.md (v4) if D is accepted.
3. Write the loader for `provinces` and `wards` from the fixtures (part of the `tools/` package in the migration plan).
4. Spike for D on one province: import, de-duplicate against VER.01, sample 200 places by hand for closed and duplicate rate. That number decides the confidence threshold.

## References

- NSO administrative-unit web service: <https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx>
- Decision 19/2025/QĐ-TTg (codes of 34 provinces and 3,321 communes), as reported by <https://lsvn.vn/danh-muc-va-ma-so-cua-34-tinh-thanh-moi-a160079.html> and <https://thitruongtaichinhtiente.vn/print/68708.html>
- Community dataset used for the cross-check (MIT): <https://github.com/ThangLeQuoc/vietnamese-provinces-database>
- Overture Maps places, license note: <https://docs.overturemaps.org/blog/2025/09/24/release-notes/>
- Foursquare Open Source Places (Apache 2.0, gated download): <https://docs.foursquare.com/data-products/docs/fsq-places-open-source>
- Google Places API policies: <https://developers.google.com/maps/documentation/places/web-service/policies> and the archived terms <https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250501>
- Overpass API usage: <https://wiki.openstreetmap.org/wiki/Overpass_API>
