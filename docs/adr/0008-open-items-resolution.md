# ADR-0008: Resolution of open items from the 2026-10-27 documentation review

- **Status:** **Partly superseded by [ADR-0009](0009-owner-business-pivot.md) the same day:** items #13 to #20 (open-data import, provenance, `ward_boundaries`, `destinations`), #22 to #25 (place filters and rating distribution on venues), #27 (reports of places) and the VER.01 migration are void; the identity, email, realtime, export, email-log and mobile-behaviour decisions (#1 to #12, #28 to #37 where they do not mention places) still hold. **Accepted as a batch** by the project owner on 2026-10-27 ("accept all" in response to the review that listed these items with proposals). The owner did not review each item separately, so every row below can be reopened on its own without affecting the others.
- **Date:** 2026-10-27
- **Depends on:** [ADR-0001](0001-tech-stack.md) to [ADR-0007](0007-realtime-sync.md), [data-model.md](../data-model.md) (v4), [api-outline.md](../api-outline.md) (v2)

## Context

The review of 2026-10-27 found that the documents were enough to start scaffolding but not to implement, mainly because many open questions sat in five different files (the two design briefs, `ui/README.md`, `data-sources.md` and the ADRs) and the API outline had not absorbed them. This ADR records one decision per open question so that the data model, the API outline and the ADRs can be reconciled against a single source.

Each decision uses the proposal that was already written in the source document. Where a source had no proposal, the item stays open (last section).

## Decisions

### Identity and email

| # | Decision | Source of the question |
|---|---|---|
| 1 | **Email verification and password reset for app users use a 6-digit code typed in the app**, not a link. Lifetime 10 minutes, at most 5 wrong attempts per code, then the code is dead. Stored as an HMAC of the code (keyed with a server secret), never in clear. Generic responses everywhere. The code goes to the account email; the user may enter another email, which the API checks before sending (mobile brief, decision "Email verification"). | Mobile brief finding 4, open question 2 |
| 2 | **Staff invitation keeps a link**, because the web admin has a browser: single-use, hashed, 48 hours, new `email_tokens.type = INVITE`. Password reset for staff also uses the link (30 minutes), since staff sign in on the web. | Web brief open question 12 |
| 3 | **JWT signing keys live in SSM Parameter Store (`SecureString`)**, as in ADR-0004. ADR-0003 is corrected. Secrets Manager stays the upgrade path. | Cross-document conflict |
| 4 | **On account deletion, reviews are kept and anonymised** (shown as "Người dùng đã xóa"), as the model already does. Counters stay correct. Legal review may still change this. | ADR-0003 item 2, ADR-0006 D9 |
| 5 | **Consent withdrawal in v1 is by deleting the account.** `user_consents.action = WITHDRAWN` stays in the schema for later. | Mobile brief open question 4 |
| 6 | **Concurrent refresh:** the API tolerates a re-presented, just-used refresh token for 10 seconds and returns the same successor. Beyond the window it counts as reuse. | ADR-0003 item 1 |

### Realtime ([ADR-0007](0007-realtime-sync.md))

| # | Decision |
|---|---|
| 7 | **Transport: Socket.IO** on the NestJS gateway (reconnect and heartbeat built in). To verify at scaffolding: Socket.IO client behaviour in React Native with the chosen Expo SDK. Plain WebSocket is the fallback. |
| 8 | **Auth on the socket:** the access token is passed in the connection handshake. When the client refreshes its token it reconnects. The server disconnects a socket whose token expired. |
| 9 | **No replay in v1.** After a reconnect or app resume the client refetches the queries it cares about. `outbox_events` are kept 7 days for debugging and for a later replay feature. |
| 10 | **Conflict policy: block on any stale `rowVersion`** (`409`), offer reload or explicit overwrite (audited). No field-level merge in v1. |
| 11 | **Latency target:** an event reaches a connected client in under 2 seconds at the 95th percentile on a normal connection. |
| 12 | **Guests** receive only events about published places and app configuration. They receive no user, report or review-moderation events. |

### Catalog, data and search

| # | Decision | Source |
|---|---|---|
| 13 | **Place import (option D of [data-sources.md](../data-sources.md)) is accepted**: import into our PostGIS in advance from Overture Maps, answer GPS queries locally. Imported places load as `DRAFT`, then publish by the rule in #14. OpenStreetMap is used only for hours and dietary tags, after a legal read of ODbL. | data-sources.md section 3 |
| 14 | **Publish rule for imported places:** places with Overture `confidence >= 0.8` may appear in the app **with the visible label "Thông tin từ nguồn mở, chưa xác minh"** and the missing-data states ("Chưa có đánh giá", "Chưa có giờ mở cửa", no photo). Lower confidence stays hidden until staff promote the place. The threshold is a starting value; the one-province spike (200 hand-checked places) may change it. | data-sources.md step 5 |
| 15 | **Refresh imports quarterly**, never overwriting fields staff edited. | data-sources.md step 6 |
| 16 | **Spike before bulk import:** one province only. Bulk import to `prod` waits for the spike result and for the capacity check in ADR-0004. | data-sources.md next step 4 |
| 17 | **`provinces` and `wards`: drop `effective_from` / `effective_to`.** Rows are updated in place (the official service changed 25 units under unchanged codes). History, if ever needed, is a separate table. `names.vi_full` becomes a documented key. | data-sources.md finding 1, 3 |
| 18 | **`ward_boundaries` is deferred.** Imported places get `province_code` from the point-in-province check only if boundaries for provinces are available; otherwise from the source address text. `ward_code` stays nullable. The ward-boundary license is unverified, so nothing is loaded yet. | data-sources.md finding 4 |
| 19 | **Provenance table `place_sources`** is added to the model. | data-sources.md finding 5 |
| 20 | **`destinations` is deferred to phase 2** and made nullable (`center`, `radius_m`; `is_active` requires both). Mobile does not use it (GPS only). | Web brief finding 3, data-sources.md |
| 21 | **Draft creation** asks for the four required fields in a small dialog (name `vi`, venue type, province, address line). The schema keeps its NOT NULL columns. `admin.md` wording is corrected. | Web brief finding 2 |
| 22 | **"Cần xử lý" quick filter** = missing location, unverified hours, or unverified dietary tags. No "missing venue type". | Web brief finding 1 |
| 23 | **Price filter:** keeps places with `price_min <= priceMax`; places with no price are excluded only while a price filter is active. | Mobile brief finding 6 |
| 24 | **Published places always have a location** (the publish checklist requires it), so list, search and nearby behave the same on that point. Drafts never reach the public API. | Mobile brief finding 10 |
| 25 | **Rating distribution is derived on read** (grouped count over the published-reviews partial index), not stored. | Mobile brief finding 11 |
| 26 | **Search suggestions** use `GET /places?q=&pageSize=8`; no dedicated endpoint until latency demands it. | API outline open item 2 |
| 27 | **Reports:** `details` at most 500 characters (CHECK). Reasons per target (review: spam, offensive, inaccurate, other; place: inaccurate, closed or moved, duplicate, other) are enforced in the API. | Mobile brief finding 5 |
| 28 | **An author can read a hidden or removed review of their own but cannot edit it.** | Mobile brief open question 1 |

### Admin behaviour

| # | Decision | Source |
|---|---|---|
| 29 | Report decisions: "apply to other reports on the same target" is checked by default. `IN_REVIEW` means a staff member opened the place editor from the report. A moderation note on a review without a report goes to `audit_logs.diff`. | Web brief findings 5 to 7, open question 2 |
| 30 | Cuisine tags added by staff count as confirmed; verification UI applies to `DIETARY` tags only. A dragged geocoded pin becomes `MANUAL`. "Chuyển về bản nháp" exists. | Web brief findings 8 to 10 |
| 31 | Editing any opening period clears `hours_verified_at`. The overlap check covers one day only in v1. | Web brief open questions 5, 6 |
| 32 | At most 20 photos per place. Amenity icon keys are owned by the mobile and admin design-token package. | Web brief open questions 8, 9 |
| 33 | Export: CSV with UTF-8 BOM and `;`-safe quoting is tested in Excel with Vietnamese regional settings before release (unverified); background jobs run in-process on a Postgres-backed queue (no Redis) while there is one API instance. The xlsx library is chosen at scaffolding. | Web brief open question 13 |
| 34 | System email suppression list is an own table fed by SES bounce and complaint notifications. An `ADMIN` sees app-user emails masked by default (as in the export design). Email log and templates stay phase 1 as designed. | Web brief open questions 14, 15 |

### Mobile behaviour

| # | Decision |
|---|---|
| 35 | The forced-update, maintenance and expected-back fields are added to `GET /meta/config`, stored in a new `app_settings` table editable by `ADMIN`. |
| 36 | The confirmation word for account deletion is "XÓA", accepted case-insensitively and without diacritics. |
| 37 | Location line shows "Vị trí hiện tại" only; reverse geocoding is not added. |

## Still open (no proposal existed, or the owner must act)

1. **Map tile source** (self-hosted vector tiles from a Vietnam OSM extract, or a provider with a free tier) and its cost. Blocks the real map in M3 and A3. ([ADR-0005](0005-geocoding.md))
2. **Geocoding provider**: decided by the coverage spike.
3. **Whether cafés, bubble tea, bakeries and bars are in scope.** Blocks the Overture category mapping into `venue_types`.
4. **Legal review** of retention, consent evidence, minors, and review deletion; terms and privacy policy text (also needed for App Store and Google Play listings).
5. **Right to use VER.01 images and venue data** before any public release.
6. **Trademark check** of "Kitchen Daylight"; font license and packaging; ward-boundary license; NSO fixture reuse terms.
7. **Final token TTLs** after UX review; domain name and registrar; prices in the AWS calculator.
8. **Capacity**: whether `t4g.small` holds the imported volume ([ADR-0004](0004-aws-hosting.md) open item 2).

## Consequences

- The data model gains tables and columns (v4) and the API outline is rewritten (v2); both reference decision numbers from this ADR.
- ADR-0003, ADR-0004 and ADR-0007 are updated to match; their remaining "Proposed" statuses now read "Accepted (batch, ADR-0008)" for the items covered here.
- Items #7 (Socket.IO in React Native) and #33 (Excel CSV behaviour) are untested assumptions, to be checked at scaffolding.
