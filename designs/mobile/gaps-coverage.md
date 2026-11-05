# Where each customer-app gap went (2026-11-03)

The 146 gap IDs G1 to G146 of [brief.md](brief.md) ("API and data gaps found") were folded into [docs/data-model.md](../../docs/data-model.md) and [docs/api-outline.md](../../docs/api-outline.md) on 2026-11-03, on the owner's order, by two parallel reviewers (one per file). Each addition carries a `(mobile G#)` tag; the prefix `mobile` is needed because the web brief has its own G1 to G8 (audit log). They are still **proposals** until the owner and the engineers confirm them. The same fold was done for the web gaps on 2026-10-30: see [../web/gaps-coverage.md](../web/gaps-coverage.md).

How to read it: `folded` = the file now contains the change; `—` = the gap has no effect on that file (the other file owns it, or it is a rule that lives on the device); `not folded` = left out on purpose, with the reason (UI wording, design-only label, owner decision still open); `already covered` = a web addition of 2026-10-30 already says it; the mobile tag was added to that line.

Totals (146 gaps). data-model.md: 86 —, 27 folded, 26 not folded, 7 already covered. api-outline.md: 95 folded, 35 not folded, 8 already covered, 8 —. Left out by both: 40 gaps (G10, G15, G16, G17, G28, G30, G37, G38, G44, G47, G50, G53, G54, G61, G68, G69, G71, G76, G77, G78, G79, G80, G88, G93, G98, G105, G106, G107, G108, G109, G113, G128, G130, G131, G132, G139, G141, G142, G143, G144).

The open questions of the mobile brief (1 to 22) were accepted as recommended on 2026-11-03 ([../open-questions-sheet.md](../open-questions-sheet.md)). Gaps whose answer is still an owner decision or an outside fact are listed in "Findings and open items" item 15 of data-model.md and "Open items" 27 to 31 of api-outline.md.

| Gap | data-model.md | api-outline.md | Notes |
|---|---|---|---|
| G1 | — | folded | data-model: api-only (`/home` activeOrders, list filter); api-outline: Public `/home` row: `activeOrders[{ id, orderNumber, status }]`; also `scope=active` on `/me/orders` (G62). Chose the `/home` option and kept both |
| G2 | — | folded | data-model: api-only (BranchSummary fields derive from `default_prep_minutes`, `delivery_zones`); api-outline: Response shapes BranchSummary: `pickupPrepMinutes`, `delivery { fromFee, etaMinutes }`; `/home` row |
| G3 | — | folded | data-model: api-only (today's hours already derived on read, brief C8); api-outline: BranchSummary: `hoursToday { open, close }` |
| G4 | — | folded | data-model: api-only (openState shape; derived from `order_cutoff_minutes`); api-outline: BranchSummary `openState.acceptingOrders`, `acceptingUntil`; `/branches/{id}` row |
| G5 | — | folded | data-model: api-only (delivery open state; the rule already exists, brief C12); api-outline: BranchSummary `openState.delivery { state, nextChangeAt }`; `/branches/{id}` row |
| G6 | folded | folded | data-model: Menu: `menu_categories.icon` (nullable key, fixed list checked by API, list not written); api-outline: `/home` row: `categories[{ id, name, icon }]`; the `icon` column is data-model |
| G7 | — | folded | data-model: api/app-only (device records time saved); api-outline: Conventions new row 'Customer app: offline copies and addresses': app records stored-at time, no API change |
| G8 | — | folded | data-model: api-only (default sort `sort_order` then `name`; column already exists); api-outline: Public `/branches` row: default order `sort_order`, then `name` |
| G9 | — | folded | data-model: api-only (paging of `GET /branches`); api-outline: Public `/branches` row: optional `limit` and `cursor`, `nextCursor`; unpaged otherwise (first of the two options) |
| G10 | not folded | not folded | data-model: map tile source: ADR-0008 open item 1, no schema effect; api-outline: map tile source is ADR-0008 open item 1; no API effect (`mapStyleUrl` exists) |
| G11 | folded | folded | data-model: Branches: `branches.pause_message` (nullable, <= 200, CHECK) + note; CHECK list in "Rules enforced"; api-outline: Public `/branches/{id}` row: `pauseMessage` (nullable, max 200). How it is set stays open (Open items 29); column is data-model |
| G12 | folded | folded | data-model: Branches: `branch_special_hours.display_note` (nullable) + note; api-outline: Public `/branches/{id}` row: `specialDays[].displayNote`; Open item 14 tagged. Column is data-model |
| G13 | — | folded | data-model: api-only (window of special days); api-outline: Public `/branches/{id}` row: `specialDays[]` for the next 60 days from today |
| G14 | — | folded | data-model: api-only (`mine` flag); api-outline: Public branch reviews row: `isMine` per item with a token (existing Review shape name kept) |
| G15 | not folded | not folded | data-model: sample data / per-branch phone owner screen is open item C34 (Findings 15 lists it); api-outline: owner confirms per-branch phones (data-model C34) and sample data; `phone` already in BranchSummary |
| G16 | — | not folded | data-model: design-only (icon sprite symbols; the 8 amenity icon keys already exist); api-outline: design-only (icon sprite); amenity icon keys already in the admin amenities row |
| G17 | not folded | not folded | data-model: open question 7 (device cart when branch removed); Findings 15; api-outline: client rule for the cart when the selected branch disappears; mobile open question 7 (listed in Open items 31) |
| G18 | folded | folded | data-model: "Derived on read": `hasRequiredOptions` = any `item_option_groups` row with `min_select >= 1`; api-outline: `hasRequiredOptions` in MenuItem shape, menu row, `/home` popular |
| G19 | folded | folded | data-model: Query patterns, Branch menu: empty categories not returned; same for Home category row; api-outline: Public menu row: never return an empty category; `/home` `categories` same rule |
| G20 | — | folded | data-model: api-only (`200` with empty array); api-outline: Public menu row: `200` with `categories: []` |
| G21 | — | folded | data-model: api-only (search params/shape; `hasRequiredOptions` part is G18); api-outline: Public `/menu/search` row: AND semantics, result `category { id, name }`, `matchedIn`, `hasRequiredOptions` |
| G22 | — | folded | data-model: api-only (suggest mode); api-outline: `/menu/search`: `suggest=1`, at most 8, no paging (first option) |
| G23 | — | folded | data-model: api-only (`excludeTagIds`, `verifiedOnly`; `menu_item_tags.verified_at` exists); api-outline: `/menu/search`: `excludeTagIds[]`, `verifiedOnly` (default true) |
| G24 | — | folded | data-model: api-only (`maxPrice`); api-outline: `/menu/search`: `maxPrice` |
| G25 | — | folded | data-model: api-only (`countOnly`/`total`); api-outline: `/menu/search`: `total` in every response (second option); no `countOnly` |
| G26 | — | folded | data-model: api-only (`GET /tags` scoped by branch); api-outline: Public `/tags` row: optional `branchId` |
| G27 | folded | folded | data-model: "Derived on read": `lowStock` only when `0 < stock_qty <= low_stock_threshold`; api-outline: MenuItem `lowStock` only when `0 < stock <= threshold`; Realtime `menu.availability_changed` staff-only `stockQty` |
| G28 | not folded | not folded | data-model: sample-data fix (empty "Món chính"); web finding 7; api-outline: sample-data fix (empty category 'Món chính' in the mobile sample) |
| G29 | — | folded | data-model: api-only (event payload); api-outline: Realtime `menu.availability_changed` row: no item name, app looks the item up |
| G30 | — | not folded | data-model: design/api-only (Menu header switch); api-outline: UI placement of the service type on the Menu; mobile open question 4 |
| G31 | — | folded | data-model: api-only (optionGroups shape; maps existing columns); api-outline: MenuItem shape: `optionGroups[{ id, name, minSelect, maxSelect, options[...] }]` (renamed from `min`/`max`) |
| G32 | folded | folded | data-model: `order_items.note` <= 200 CHECK; `app_settings.ordering.item_note_max` (proposed 200); CHECK list; api-outline: `ordering.itemNoteMax` (200) in `/meta/config`; `TOO_LONG` row; `POST /orders` row. Settings key `item_note_max` is data-model |
| G33 | already covered | already covered | data-model: `app_settings.ordering` proposed defaults (brief L3: `max_cart_lines` 30); mobile tag added to that sentence; api-outline: defaults already proposed in data-model (brief L3: `max_cart_lines` 30) and Open item 21; tag added to Open item 21 and `/meta/config` row |
| G34 | — | folded | data-model: api-only (`OPTION_INVALID` details); api-outline: Payloads: `OPTION_INVALID` `invalid[{ itemIndex, optionIds[] }]` |
| G35 | already covered | — | data-model: `item_options` notes ("limitation", Findings 5 and 12); mobile tag added; api-outline: accepted data-model limit (options not per branch); no API effect |
| G36 | — | folded | data-model: api-only (`isFavorite`; derived from `favorite_items`); api-outline: `GET /menu/items/{id}` row and MenuItem shape: `isFavorite` with a token (first option) |
| G37 | — | — | data-model: app-only (similar items computed on device); api-outline: computed on the device, no API |
| G38 | — | — | data-model: api-only (Quote subtotal); api-outline: client rule (`Quote.subtotal` already exists; before a branch exists the device computes) |
| G39 | — | folded | data-model: api-only (quote without address); api-outline: `POST /orders/quote` row and Quote shape: quote without address, `deliveryFee: null`, `deliveryFeeFrom`, `rings[]` (first option) |
| G40 | — | folded | data-model: api-only (Quote `zone` members; columns exist); api-outline: Quote shape `zone { fee, minOrder, freeOver, etaMinutes }`; quote row |
| G41 | already covered | not folded | data-model: `app_settings.feature_flags` already lists `vouchers` (brief Z3); mobile tag added with note that the choice (vouchers vs loyalty flag) is open (Q6, Q21); api-outline: voucher flag vs `loyalty` flag: mobile open questions 6, 21; Open items 27 |
| G42 | — | folded | data-model: api-only (Quote warnings shape); api-outline: Quote shape `warnings[{ code, itemId, ... }]` with `was`/`now`, `left`, `inactiveOptionIds[]` |
| G43 | — | folded | data-model: api-only (`BRANCH_CLOSED` body); api-outline: Catalogue `BRANCH_CLOSED` + payload `reason`, `nextOpenAt` |
| G44 | — | — | data-model: app-only (offline quote); api-outline: app-side (offline cart keeps the last quote) |
| G45 | — | folded | data-model: api-only (time slots; `schedule_*` keys already exist); api-outline: `POST /orders` row: no slots endpoint, the app builds slots from hours and `/meta/config` (second option); server checks `requestedFor` |
| G46 | folded | folded | data-model: `customer_addresses.note` and `orders.delivery_note` <= 200 CHECK; saved-address limit (10) left open, open question 8; api-outline: `TOO_LONG` for `deliveryNote` 200; `/me/addresses` and `POST /orders` rows. Address cap (10) left open: Open items 27 (mobile open question 8) |
| G47 | not folded | not folded | data-model: ward list source: ADR-0008 open decision, no schema effect now; Findings 15; api-outline: ward list source is an owner decision; `GET /wards?provinceCode=` already exists |
| G48 | — | folded | data-model: api/design-only (no reverse geocoding; no data stored); api-outline: Conventions row 'Customer app: offline copies and addresses': no customer geocoding or address search |
| G49 | folded | folded | data-model: `app_settings.payment`: complete rule (proposal: bank name, account number, holder); public config says only whether complete; api-outline: `/meta/config` row: `payment { bankTransferEnabled }` |
| G50 | not folded | not folded | data-model: owner task / open question 9 (bank details); Findings 15; api-outline: owner task (real bank details in `app_settings.payment`); mobile open question 9 |
| G51 | folded | folded | data-model: `app_settings.payment`: account number stored as one continuous digits string; api-outline: Order shape `transferInfo.accountNumber` one continuous string |
| G52 | already covered | already covered | data-model: `app_settings.payment` optional QR media id (brief A13); mobile tag added; api-outline: `transferInfo.qrUrl?` already in Order shape (brief A13); tag added |
| G53 | — | not folded | data-model: api-only (phone in order body vs `PATCH /me`); api-outline: phone in order body vs `PATCH /me` first; mobile open question 8; Open items 27 |
| G54 | — | not folded | data-model: api-only (rate limit; server configuration, brief L15); api-outline: no figure proposed by the brief and rate-limit figures are open (brief E16); Open items 27 |
| G55 | — | folded | data-model: api-only (PRICE_CHANGED body); api-outline: Payloads: `PRICE_CHANGED` body is the fresh quote with full `lines[]` |
| G56 | — | folded | data-model: api-only (ITEM_UNAVAILABLE body); api-outline: Payloads: `ITEM_UNAVAILABLE` `items[{ id, soldOut, left? }]` |
| G57 | — | folded | data-model: api-only (idempotency conflict code); api-outline: Catalogue: new `IDEMPOTENCY_CONFLICT` (409); Conventions Idempotency row; `POST /orders` row |
| G58 | — | already covered | data-model: api-only (FORBIDDEN wording); api-outline: Authentication section already says customer login rejects staff accounts; tag added |
| G59 | folded | folded | data-model: Orders note: `eta_at = requested_for` when set; api-outline: Order shape `etaAt` equals `requestedFor` when set; `POST /orders` row |
| G60 | — | already covered | data-model: api-only (event on payment_status change); api-outline: Realtime `order.updated` already goes to the customer on payment change; tag added to the row |
| G61 | — | — | data-model: no effect ("None; mention only"); api-outline: no API change (mention only) |
| G62 | — | folded | data-model: api-only (`scope` filter); api-outline: `/me/orders` row: `scope=active\\|history`, cursor paging per tab |
| G63 | — | folded | data-model: api-only (list item fields); api-outline: `/me/orders` row and new shape `MyOrderSummary` (item summary, `canReview`, `review { rating }`) |
| G64 | folded | folded | data-model: Query patterns, History: customer list has no time limit, only paging; api-outline: `/me/orders` row: no time limit, only paging |
| G65 | — | folded | data-model: api-only (reorder response); api-outline: `POST /orders/{id}/reorder` row and new shape `ReorderDraft` |
| G66 | — | folded | data-model: api-only (reorder across branches; clamp); api-outline: reorder row: draft limited to `maxCartLines`; the 'refresh the cart for another branch' rule is open question 1 and left open |
| G67 | — | folded | data-model: app-only (local cache update); api-outline: `/me/orders` row and `order.status_changed` row: list cache updated from the event, no extra call |
| G68 | not folded | not folded | data-model: open question 10 (the four cancel reasons; would add `cancel_reason_code` values); Findings 15; api-outline: customer cancel reasons: mobile open question 10; Open items 28 |
| G69 | — | not folded | data-model: api-only (idempotent cancel); api-outline: idempotent customer cancel: mobile open question 10; Open items 28 |
| G70 | folded | already covered | data-model: `app_settings.ordering.call_hint_minutes` proposed default 10; api-outline: `ordering.callHintMinutes` already in `/meta/config`; data-model `call_hint_minutes`, WA16 default 10; tag added |
| G71 | not folded | not folded | data-model: UI state; requiring a courier phone would be an owner decision; Findings 15; api-outline: design-only state; 'require a phone' would change the staff transition rule, not decided |
| G72 | folded | folded | data-model: `order_status_events` note: customer sees `note` and a role label only, never `actor_user_id`; api-outline: Order shape `timeline[{ status, at, note?, actor }]`, `actor` = `CUSTOMER`/`STAFF`/`SYSTEM` |
| G73 | — | folded | data-model: api-only (`paid_at`, `refunded_at` already columns); api-outline: Order shape `paidAt?`, `refundedAt?` |
| G74 | — | folded | data-model: api-only (event scope/payload); api-outline: Realtime `order.status_changed` row: customer copy `{ orderId, status, rowVersion }`, own customer only |
| G75 | — | folded | data-model: api-only (`GET /orders/{id}` review fields); api-outline: Order shape `review? { rating, status }`; `/me/orders` row |
| G76 | — | — | data-model: app-only (device retention); api-outline: retention of order copies on the device; client rule, no API effect |
| G77 | not folded | not folded | data-model: sample-data fix (web order BT-261020-0088); api-outline: sample-data fix (web sample order BT-261020-0088) |
| G78 | not folded | not folded | data-model: UI label map for `DINE_IN` / "Đã phục vụ" (wording); api-outline: UI label (chip 'Tại bàn'); `type` DINE_IN already in Order shape |
| G79 | not folded | not folded | data-model: assumption pending owner (hide `CLOSED` branches); related open question 12; Findings 15; api-outline: owner to confirm; client assumption that `CLOSED` branches are hidden |
| G80 | not folded | not folded | data-model: UI wording for `cancelled_by = SYSTEM` (brief line "Quán chưa kịp xác nhận" differs from the text in data-model.md "Quán không xác nhận kịp"); see conflicts; api-outline: UI wording; `cancelledBy` already in Order shape |
| G81 | folded | folded | data-model: `reviews` note + "Rules that no CHECK can express": customer edits only a `PUBLISHED` review (error code itself is API); api-outline: Catalogue `REVIEW_NOT_PUBLISHED` extended; `PATCH, DELETE /reviews/{id}` row |
| G82 | folded | folded | data-model: `reviews` note: customer edit has no `row_version`; rating change updates `rating_sum` (body shape is API); reply kept after edit = open question 13; api-outline: `PATCH /reviews/{id}` row: body `{ rating, body? }`, no `rowVersion` |
| G83 | — | folded | data-model: api-only (rating filter); api-outline: branch reviews row: optional `rating` 1..5 (the brief's closing list names a star filter as an owner item; flagged) |
| G84 | — | folded | data-model: api-only (paging of public list); api-outline: branch reviews row: `page`, `pageSize`, `total` |
| G85 | folded | folded | data-model: `reviews` note + rules: customer delete only while `PUBLISHED`; api-outline: `PATCH, DELETE /reviews/{id}` row: `DELETE` on HIDDEN/REMOVED returns `REVIEW_NOT_PUBLISHED` |
| G86 | folded | folded | data-model: `reviews` note: customer delete is a hard delete, counters drop, may write again inside `review_window_days`; api-outline: `DELETE /reviews/{id}` hard delete; `POST /orders/{id}/review` row: may write again inside the window |
| G87 | — | folded | data-model: api-only (`reason` in error details); api-outline: Payloads: `ORDER_NOT_REVIEWABLE` `details { reason }`; review row |
| G88 | not folded | not folded | data-model: sample-data fix (web file); api-outline: sample-data fix (web file) |
| G89 | — | folded | data-model: api-only (`DUPLICATE_REPORT` code; the partial unique index already exists); api-outline: Catalogue: new row `DUPLICATE_REPORT` (409); `/reports` row |
| G90 | already covered | already covered | data-model: `review_reports` note (brief V20): report only for `PUBLISHED`; mobile tag added; api-outline: `REVIEW_NOT_PUBLISHED` already a 409 proposal (brief V4, V20; Open item 15); tag added |
| G91 | folded | folded | data-model: "Rules that no CHECK can express": a customer cannot report their own review; api-outline: `/reports` row: reporting own review returns `FORBIDDEN` |
| G92 | — | folded | data-model: api-only/no endpoint (nothing stored); api-outline: `/reports` row: no endpoint for the reporter; `GET /me/reports` later |
| G93 | not folded | not folded | data-model: sample-data fix (web file); api-outline: sample-data fix (web file) |
| G94 | — | folded | data-model: api-only (`email`, `email_verified_at`, `avatar_url` already columns); api-outline: `/me` row: `email`, `emailVerifiedAt`, `avatarUrl` |
| G95 | folded | folded | data-model: `users.display_name` <= 60 CHECK; CHECK list; api-outline: `/me` row: `displayName` max 60 (`TOO_LONG`); CHECK is data-model |
| G96 | — | folded | data-model: api-only (`users.phone` already nullable); api-outline: `/me` row: `PATCH` may set `phone` to null; next order `PHONE_REQUIRED` |
| G97 | folded | folded | data-model: Conventions, Text: phone of a customer accepted in national form, stored E.164, Vietnamese mobile; api-outline: Conventions new row 'Phone numbers' |
| G98 | not folded | not folded | data-model: open question 14 (password row for social-only accounts); `password_hash` is already nullable; api-outline: password row for social-only accounts: mobile open question 14; Open items 29 |
| G99 | — | folded | data-model: api-only (paging of lists); api-outline: `/me/addresses`, `/me/favorites`, `/me/sessions` rows: `page`, `pageSize` (20), `total` |
| G100 | — | folded | data-model: api-only (undo; `deleted_at` soft delete already exists); api-outline: `/me/addresses` row: no restore endpoint, the app delays the `DELETE` |
| G101 | not folded | folded | data-model: open question 14 (deleting the default address); api-outline: `/me/addresses` row: deleting the default does not choose another |
| G102 | folded | folded | data-model: `favorite_items` note: rows kept after the dish is switched off, sold out or soft-deleted; shown unavailable/sold out/removed; api-outline: `/me/favorites` row: `branchId`, rows `{ menuItem, available, soldOut, removed }` |
| G103 | — | folded | data-model: api-only (`NOT_FOUND` on PUT of a removed item); api-outline: `/me/favorites` row: `PUT` on a removed item returns `NOT_FOUND` |
| G104 | — | already covered | data-model: api-only (public consent documents endpoint); api-outline: public `GET /legal/documents/current` already exists; brief names `/consent-documents/current`, outline name kept; tag added |
| G105 | not folded | not folded | data-model: sample-data fix (web file); api-outline: sample-data fix (web file) |
| G106 | — | not folded | data-model: design-only (field errors not drawn); api-outline: design-only (frame 12 error drawing) |
| G107 | — | not folded | data-model: design-only (RATE_LIMITED not drawn); api-outline: design-only (frame 12 error drawing); `Retry-After` already specified |
| G108 | — | not folded | data-model: design-only (ACCOUNT_SUSPENDED not drawn); api-outline: design-only (frame 12 error drawing) |
| G109 | — | not folded | data-model: design-only (network loss not drawn); api-outline: design-only (frame 12 error drawing) |
| G110 | folded | — | data-model: Account deletion table: new `review_reports` line (keep; reporter points to tombstone; 24-month retention); api-outline: data-only (deletion table of data-model) |
| G111 | — | folded | data-model: api/app-only (pre-check source); api-outline: `DELETE /me` row: app checks loaded orders, relies on `409` for reservations |
| G112 | — | folded | data-model: api-only (409 body); api-outline: Payloads: `HAS_ACTIVE_ORDERS` `details { orders, reservations }`; `DELETE /me` row |
| G113 | not folded | not folded | data-model: pending legal/accountant review; same as Findings item 1; api-outline: pending accountant and legal review (retention of order contact fields); data-model |
| G114 | — | folded | data-model: app-only (quote again on launch); api-outline: `POST /orders/quote` row: quote again on launch when the cart is not empty |
| G115 | — | folded | data-model: app-only (price at add time); api-outline: `POST /orders/quote` row: app stores price at add time and compares; server stores no old price |
| G116 | — | folded | data-model: api-only (event payload); api-outline: Realtime `order.updated` row: customer copy carries no ETA, the app refetches (second option) |
| G117 | — | folded | data-model: api-only (connection threshold); api-outline: Realtime connection paragraph: 30-second threshold also for the customer app |
| G118 | — | folded | data-model: api-only (no separate review event); api-outline: Realtime paragraph: no separate event for new reviews, aggregate in `branch.updated` |
| G119 | already covered | folded | data-model: Conventions, "No cart table": device-local; mobile tag added with note that a synced cart would need a table, not designed; api-outline: `POST /orders/quote` row: cart device-local, no cart endpoint, sync not designed; survival on sign-out stays open (Open items 31) |
| G120 | folded | folded | data-model: `voucher_assignments` note: saved public code stored as a row (proposal; `source` column is the alternative; not decided); Findings 15; api-outline: Current user: new row `POST /me/vouchers`; `/me/vouchers` paging; `/home` `vouchers` uses the `MyVoucher` card (assumption) |
| G121 | — | folded | data-model: api-only (/home missing fields, reorder rule; items covered in G1-G6, G18); api-outline: `/home` row (`reorder` = last completed order, `activeOrders`, `categories`, ...); reorder row wording |
| G122 | — | folded | data-model: api-only (reservation-slots shape); api-outline: Reservations `reservation-slots` row and shape `ReservationSlots` |
| G123 | — | folded | data-model: api-only (alternatives); api-outline: `POST /reservations` row: no `alternatives[]`, the app builds times from reloaded slots (first option) |
| G124 | — | folded | data-model: api-only (VALIDATION_FAILED details); api-outline: Field-level codes: `OUTSIDE_OPENING_HOURS`, `TOO_SOON`, `TOO_FAR`, `PARTY_TOO_LARGE` in `errors[]`; `POST /reservations` row |
| G125 | — | folded | data-model: api-only (DUPLICATE_RESERVATION code, or accept); api-outline: Catalogue: new `DUPLICATE_RESERVATION` (409), proposal; `POST /reservations` row |
| G126 | — | folded | data-model: api-only (branch switched off error); api-outline: `POST /reservations` row: `FORBIDDEN` (first option) when the branch no longer takes reservations; `branch.updated` locks the form |
| G127 | — | folded | data-model: api-only (my reservations shape; `endsAt` derives from `reserved_at` + `duration_minutes`); api-outline: `/me/reservations` row and shape `MyReservation` |
| G128 | not folded | not folded | data-model: open question 20 (table name shown to the customer); api-outline: table name visible to the customer: mobile open question 20; `tables[]` in `MyReservation` marked conditional; Open items 29 |
| G129 | folded | folded | data-model: `reservations.note` <= 200 CHECK; CHECK list; api-outline: `TOO_LONG` row and `POST /reservations` row: `note` max 200; CHECK is data-model |
| G130 | not folded | not folded | data-model: open question 20 (verified email before reserving); api-outline: verified email to reserve: mobile open question 20; Open items 29 |
| G131 | — | not folded | data-model: api-only (idempotent cancel); api-outline: idempotent reservation cancel follows G69 (mobile open question 10); Open items 28 |
| G132 | not folded | not folded | data-model: sample-data fix (web file); api-outline: sample-data fix (web file) |
| G133 | — | folded | data-model: api-only (use `branch.updated`); api-outline: Realtime `branch.updated` row and `POST /reservations` row |
| G134 | — | folded | data-model: api-only (`app_settings.loyalty` keys already exist; only exposure to customers); api-outline: `/meta/config` row: `loyalty { earnVndPerPoint, redeemVndPerPoint, minRedeemPoints, expiryMonths }` (first of two places); `MyPoints` shape note |
| G135 | already covered | folded | data-model: `loyalty_ledger` note (brief M21): customer sees only the reason type; `balanceAfter` derived (M18); mobile tag added; api-outline: `/me/points` row and new shape `MyPoints` |
| G136 | not folded | folded | data-model: decision needed on how a not-yet-started or switched-off voucher appears (no open question number); query params are API; Findings 15; api-outline: `/me/vouchers` row: `branchId`, `type`, `subtotal`; the states for not-started/inactive left open |
| G137 | — | folded | data-model: api-only (`/vouchers/validate` params and body); api-outline: `POST /vouchers/validate` row: `type` and `subtotal` optional, body `{ applies, discount, voucher }` |
| G138 | folded | folded | data-model: Promotions and loyalty paragraph: partial redemption, whole number between `min_redeem_points` and balance/allowed amount; api-outline: `POST /orders/quote` row: `redeemPoints` is an integer, partial redemption |
| G139 | not folded | — | data-model: owner decision: which flow writes `REVERSE_EARN` (and `EXPIRE`) or remove them; Findings 15; api-outline: enum/flow question (`REVERSE_EARN`, `EXPIRE`) for data-model and owner; no endpoint change |
| G140 | — | already covered | data-model: api-only (no events); api-outline: Realtime paragraph already says no points or voucher event, `voucher.updated` open (brief M11, M24); refetch trigger added with tag |
| G141 | — | not folded | data-model: design-only (frame fix); api-outline: frame fix (design-only) |
| G142 | not folded | not folded | data-model: open question 22 (ratings and counts on every dish); conflicts with `WA6` and "Item-level ratings are not collected"; Findings 15; api-outline: mobile open question 22 and WA6 (no item-level ratings); Open items 30 |
| G143 | not folded | not folded | data-model: open question 22 (who chooses suggested dishes); api-outline: mobile open question 22 (who chooses the suggested dishes); Open items 30 |
| G144 | not folded | not folded | data-model: open question 22 (who chooses the featured dish); api-outline: mobile open question 22 (who chooses the featured dish); Open items 30 |
| G145 | — | folded | data-model: api-only (`pointsToEarn` in Quote; earn rule already in loyalty paragraph); api-outline: Quote shape `pointsToEarn` |
| G146 | folded | folded | data-model: "Derived on read": `lowStock` carries the threshold (`low_stock_threshold`); api-outline: MenuItem shape `lowStock { left, threshold }` |

## Conflicts and assumptions: data-model.md

Names and values I chose that the brief did not state:

- G6: column name `menu_categories.icon`, nullable; the brief says "an `icon` key to categories" without nullability or the list of keys. I copied the pattern of `amenities.icon` (fixed list checked by the API) and said the list is not written.
- G11: `branches.pause_message` is nullable, <= 200 (from the brief); whether resuming clears it is not stated and I left it open in the text.
- G12: column name `display_note` (from the brief); nullable; length limit and translations left undecided (no value invented).
- G32: the brief says 200 characters returned as `ordering.item_note_max`. I made the CHECK 200 on `order_items.note` and the setting a value "not above the CHECK" (proposed 200). The key name is the brief's, the "not above the CHECK" relation is mine.
- G46: `customer_addresses.note` and `orders.delivery_note` both <= 200 (the brief only says `delivery_note`). I applied it to both because the order copies the address note. The saved-address limit 10 is only "for example" in the brief and open question 8 asks the owner; I did not set it.
- G49: "complete" is undefined in the brief. Proposal written: bank name, account number and account holder filled. `bank_code` (6 digits, needed only for the QR) is deliberately not required; the brief says the owner has no QR (G52). The flag name `payment.bankTransferEnabled` is API-side and not repeated in data-model.md.
- G51: "digits only" is mine (brief: "one continuous string"); some bank accounts may contain letters, but the existing text and the VietQR use digits.
- G59: only the equality `eta_at = requested_for` is stated; how `eta_at` is estimated for an ASAP order is not described in data-model.md (not in the brief either).
- G70: default 10 minutes is the brief's; the phrase "without acceptance" paraphrases "unaccepted".
- G72: "role label (customer, restaurant or system)" is my wording of "anonymous actor"; the exact label set is not in the brief.
- G81/G85/G91: placed in "Rules that no CHECK can express" because they cannot be a CHECK.
- G82: "rating change updates `rating_sum`" is my consequence of the existing `rating_sum` rule; the brief states only body and no `rowVersion`.
- G86: hard delete is the brief's proposal. Consequences I noticed and left open: (1) `review_reports.review_id` needs cascade or a blocking rule; (2) it departs from "history is never destroyed" / append-only spirit for reviews; (3) the audit trail for a customer delete is not specified (no `audit_logs` action invented).
- G95: the 60-character CHECK is on `users.display_name`, which also holds staff names (the brief reasons about customers only).
- G97: scoped the Vietnamese-mobile rule to customer phones; branch phones may be landlines (the hotline `028 3822 0000`), so a mobile-only CHECK on `branches.phone` would break G15's sample.
- G102: "removed" is taken as `is_active = false` or `deleted_at` set; the brief does not define it.
- G110: the deletion line says `review_reports` are kept and the reporter becomes the tombstone; the "24 months after resolution" retention was already in the retention table.
- G120: reusing `voucher_assignments` for a saved public code is my reading (the brief only says "add a way to save a code"); this conflicts with the existing note "For `ASSIGNED` vouchers only" and with M3 (an admin can revoke an unused assignment). Left as a proposal with a `source` column as the alternative.
- G138: "any whole number from `min_redeem_points` up to the balance and up to the amount that the subtotal after the voucher allows" is the brief's rule worded as a data rule.
- G142 conflict: data-model.md says item-level ratings are not collected (`WA6`, Scope table "item-level ratings" out of scope), while the brief wants `ratingAvg`, `ratingCount`, `orderCount` per dish "computed from `reviews` and `order_items`". An order-level rating cannot be a dish rating without a decision, so nothing was folded.
- G80: the brief's reason line "Quán chưa kịp xác nhận" differs from the existing system cancel text "Quán không xác nhận kịp" in data-model.md. Not changed (UI wording).
- G41: `vouchers` flag already exists in `feature_flags` (brief Z3), so the brief's "add a `vouchers` flag" is already satisfied; whether the app uses it is open (Q6, Q21).
- G33: data-model.md already proposes `max_cart_lines` 30 (brief L3), same as the mobile frames; the brief says "defaults are still not set", which is out of date against data-model.md. Also `max_item_quantity` 20 vs the mobile gap's silence on it: no conflict.
- G15 / C34: the brief says `branches.phone` has an open owner screen; that open item stays in Findings 14, and Findings 15 repeats it.
- Findings: I added item 15 (the document's Findings list had 14) and a revision paragraph at the top; no existing finding was renumbered or removed. The Status line was edited to say revised 2026-10-28, 2026-10-30 and 2026-11-03 (the 2026-10-30 revision was missing from it).
- Tag form: the prefix is `mobile G#`. The revision paragraph uses the literal `(mobile G#)` as an example; Findings item 15 uses bare G/Q numbers in the style of item 14 (no "mobile" prefix) and defines them in its first sentence.
- No ER diagram was changed: the three mermaid diagrams show relations only, no columns, and no table was added.
- Phase 1 table count (Findings 13) is unchanged because no table was added.

## Conflicts and assumptions: api-outline.md

Status words: `—` is used for data-only gaps (column, CHECK, retention) and for rules that live only on the device; `not folded` for sample-data fixes, UI wording or frame fixes, owner tasks and open-question items.

Names or values chosen by me (the brief did not state them), all marked as proposals in api-outline.md:
- `BRANCH_CLOSED.reason` values `CLOSED`, `PAUSED`, `PAST_CUTOFF`, `SERVICE_OFF` (G43); `nextOpenAt` null when unknown.
- `ORDER_NOT_REVIEWABLE` `details.reason` values `NOT_COMPLETED`, `WINDOW_EXPIRED`, `NOT_OWNER` (G87). `details` kept as a problem+json member, as the brief wrote `error.details`.
- `IDEMPOTENCY_CONFLICT` (409) as the code name of G57 (the brief said "its own code"; `422` noted as alternative).
- `acceptingUntil` chosen over `orderCutoffAt` (G4); defined as the time after which orders are no longer accepted.
- `rings[]` as the name of the ring list in an address-less quote (G39); fields: "the zone summary of `GET /branches/{id}`".
- `itemSummary { names[], count }` in `MyOrderSummary` (G63); the brief only said "first two names, count". What `count` counts is mobile open question 10.
- `timeline[].actor` values `CUSTOMER`, `STAFF`, `SYSTEM` taken from `orders.cancelled_by` (G72).
- `ordering.itemNoteMax` (G32): camelCase of the brief's `ordering.item_note_max`. Cross-file: data-model must add the `app_settings.ordering` key `item_note_max` (other agent).
- `MyReservation`, `MyPoints`, `MyOrderSummary`, `ReorderDraft`, `ReservationSlots` as shape names.
- G9: chose the first option (optional `limit` and `cursor`, unpaged without them). G22: `suggest=1`. G25: `total` in every response. G36: `isFavorite`. G39: address-less quote. G45: the app computes the slots (second option, no endpoint). G116: the app refetches (no ETA in the payload). G123: no `alternatives[]`. G125: `DUPLICATE_RESERVATION` as proposal. G126: `FORBIDDEN` (first of three). G134: rates served in `GET /meta/config` `loyalty {...}` (first of two places). G1: `/home` `activeOrders` (first option), plus `scope` on `/me/orders` from G62.
- G120: the `/home` `vouchers` array is said to use the `MyVoucher` card (the brief names a "Home voucher shape" without defining it).
- G66: "clamp to `maxCartLines`" read as: the reorder draft holds at most `maxCartLines` lines (server side). The branch-change part is left open (mobile open question 1).
- G45: I wrote that the server checks `requestedFor` against hours, cutoff, lead and days-ahead; the brief does not say it, it follows from "valid slots = hours minus cutoff".
- G13: the brief's text says the frames assume 30 days, the proposal says 60; I used 60 as the proposal states.
- G83: the brief's closing list ("Things the owner still has to provide") names "a star filter on reviews"; I folded it because the gap is an optional parameter and no numbered open question covers it. Remove it if the owner sees that list as a blocker.
- G34: the brief shows one object `invalid { itemIndex, optionIds[] }`; I wrote a list `invalid[{ ... }]` because several lines can be wrong. Only deviation from a stated shape besides G31.

Conflicts with existing text or between gaps:
- G31 renames `optionGroups[].min`/`max` to `minSelect`/`maxSelect` in the MenuItem shape (the existing sketch used `min`, `max`); data-model uses `min_select`/`max_select`. I edited the existing shape line.
- G27 vs existing `menu.availability_changed` row: the Public event payload carried `stockQty?`. G27 says the app never sees raw stock. I edited the row: `stockQty` only in the staff copy.
- G42 vs G115: G42 gives `PRICE_CHANGED` warnings `was`/`now`, but the quote request carries no old price and G115 says the app compares with the price saved when the line was added. `was` has no source on the server unless the client sends it. I kept the brief's shape and wrote in the quote row that the server stores no old price. To be settled by engineers (is `was` sent by the client, or dropped?).
- G14: brief `mine` vs existing Review shape `isMine?`; kept `isMine`.
- G104: brief `GET /consent-documents/current` vs existing `GET /legal/documents/current`; kept the existing path.
- G124: brief `details[{ field, reason }]` vs existing `errors[{ field, code, message }]`; used `errors[]` with field-level codes.
- G142 (ratings on every dish) conflicts with WA6 (no item-level ratings; reviews are per order). Not folded; recorded in Open items 30.
- G33 and G70 are marked already covered, but the mobile brief says "defaults not set": data-model already proposes `max_cart_lines` 30 (brief L3) and `call_hint_minutes` 10 (WA16); the mobile brief did not re-check.
- G69 and G131: not folded under mobile open question 10, although the web convention (brief A27) already makes staff transitions idempotent. G131 is not itself in an open question, it follows G69; if the owner accepts G69, G131 follows.
- G68, G98, G130, G128, G53, G41: left to Open items 27 to 29 as API decisions. G41: public `featureFlags` stays at four keys; the admin config already has `features.vouchers` (admin only).
- G11: `pauseMessage` is returned but how the manager sets it is not in the brief (the pause call has only an optional `reason`, brief A25); left open in Open items 29.
- G119: only the device-local statement is folded; cart sync endpoints are mentioned as not designed.
- G9 and G46: the "ceiling of about ten branches" and "10 addresses" come from the brief's own wording ("about ten", "for example 10"); the address cap is left open.
- G17, G66 (branch change) and G119 (sign-out) depend on mobile open questions 1 and 7; only recorded in Open items 31.
- Mobile finding 2 (reorder wording): fixed in `/home` row (`reorder` = last completed order) and the reorder row; the `POST /orders/{id}/reorder` endpoint itself is not restricted to completed orders (the brief only says Home draws the completed one).
- Mobile findings 3, 8, 10, 12 (priming text, return screen after sign-in, address-less quote, three events and 30 s): only G39 and G117 have API effect and were folded; the others are UI.
- Cross-file hints for the data-model agent (not edited by me): `app_settings.ordering.item_note_max`, `branches.pause_message`, `branch_special_hours.display_note`, `menu_categories.icon`, `users` fields already exist (`avatar_url`, `email_verified_at`), `display_name` CHECK 60, `reservations.note` CHECK 200, `delivery_note` 200.

## Cross-file check (2026-11-03)

Names chosen by one reviewer and needed by the other were checked in both files: `item_note_max` / `itemNoteMax`, `pause_message` / `pauseMessage`, `display_note`, `menu_categories.icon`, `voucher_assignments`. G86 (customer deletes a review), G120 (saved voucher code) and G142 (ratings on every dish) are treated the same way in both files: G86 and G120 folded as proposals with the open point flagged, G142 not folded.
