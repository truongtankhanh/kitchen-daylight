# Where each gap of the brief went (2026-10-30)

The 322 gap IDs of [brief.md](brief.md) (plus A41 to A43 and P26 to P28, added later the same day and folded on 2026-10-30 after the owner's review of the brief) ("API and data gaps found") were folded into [docs/data-model.md](../../docs/data-model.md) and [docs/api-outline.md](../../docs/api-outline.md) on 2026-10-30, on the owner's order. Each addition in those two files carries a `(brief ID)` tag. They are still **proposals** until the owner and the engineers confirm them; the sample-data rows (section S), the open questions and the 18 deviation rows D1 to D18 of the brief are not gap IDs and are not in this table.

How to read it: `folded` = the file now contains the change; `—` = the gap has no effect on that file; `not folded` = left out on purpose, with the reason (UI wording, design-only label, owner decision with no schema or API effect, a decision such as "no invoice event for now").

Totals: 322 gaps (the six added later are listed at the end of the table and counted separately: five have an effect in at least one file, A43 is a decision with nothing to fold). data-model.md: 190 folded, 105 API-only, 27 not folded. api-outline.md: 279 folded, 20 data-only, 23 not folded. Left out by both: 18 gaps (including K3, the "requested by" column of the email log, and N10, the invoice event, both by decision).

The two files were folded by two parallel reviewers from the same brief; the pairs below were cross-checked (a gap that one file calls "the other file's job" is folded by the other). Names that the reviewers chose and the owner has not seen are listed in the "Conflicts and assumptions" sections of the two working notes, summarised in the report of 2026-10-30.

| Gap | data-model.md | api-outline.md | Notes |
|---|---|---|---|
| A1 | folded | folded | data-model: Orders `orders.type` gains `DINE_IN`; Scope row; transitions table; Receipts and statistics; api-outline: Orders, `GET /admin/orders` (`type` includes `DINE_IN`); Response shapes Order (`type`); `POST /admin/orders` row. Enum itself is left to data-model |
| A2 | folded | folded | data-model: Orders `orders.source` (`APP`, `COUNTER`, `PHONE`) and `orders.created_by`, with the CHECK; the list filter itself is API; api-outline: Orders, `GET /admin/orders` (`source` filter), `POST /admin/orders` (`source`, `createdBy`); AdminOrder shape. Columns left to data-model |
| A3 | folded | folded | data-model: Orders `orders.customer_id` nullable, `customer_name` and `customer_phone` nullable with the CHECK, unique (`created_by`, `idempotency_key`) for orders without a customer; ER diagram; finding 14; api-outline: Orders, `POST /admin/orders` (customer optional); AdminOrder shape (`customer` null). Nullable column left to data-model |
| A4 | folded | folded | data-model: Orders notes and `order_status_events`: counter order created directly at `ACCEPTED`, first event by staff; the endpoint body is API; api-outline: Orders, `POST /admin/orders` row: phase 2 -> 1, body, `ACCEPTED` first event, `Idempotency-Key` as header (not body); Conventions Idempotency |
| A5 | folded | folded | data-model: Orders `orders.table_label` (nullable, at most 20); index on `lower(table_label)` for prefix search; api-outline: Orders, `GET /admin/orders` (`q` matches table label), `POST /admin/orders` (`tableLabel`); Order shape (`tableLabel`). Column and index left to data-model |
| A6 | folded | — | data-model: Orders `order_items.round_no` |
| A7 | folded | folded | data-model: Orders notes (rounds, stock, totals, `READY` to `PREPARING`), transitions table row, "Rules that no CHECK can express"; endpoint is API; api-outline: Orders, new row `POST /admin/orders/{id}/items` (phase 1) |
| A8 | — | folded | api-outline: Error catalogue: `ORDER_NOT_EDITABLE` (409); Orders, `/items` row |
| A9 | folded | folded | data-model: Orders transitions table: `READY` to `COMPLETED` for dine-in (`Đã phục vụ`) and new row `READY` to `PREPARING` (dine-in only); api-outline: Orders, `POST .../transition` row (dine-in only `READY`->`PREPARING`, `READY`->`COMPLETED`) |
| A10 | — | folded | api-outline: Realtime, `order.updated` row (`itemsAdded`) |
| A11 | — | folded | api-outline: Orders, `POST .../payment` row (repeat confirm returns the order, no second audit row) |
| A12 | folded | folded | data-model: Findings item 14 (split payment deferred; `order_payments` is the option); orders notes say one payment per table; api-outline: Orders, `POST .../payment` row (one method, no split payment); Open items 11 (deferred) |
| A13 | folded | folded | data-model: `app_settings.payment.bank_code`; who may read the details is API; api-outline: Staff session, `GET /admin/meta/config` row and AdminMetaConfig shape (`payment`); Order shape (`transferInfo` + `bankCode?`, `qrUrl?`); Public `/meta/config` (never bank details). Columns `payment.bank_code`, `qr_media_id` left to data-model. Kept the existing name `transferInfo` instead of the gap's `payment {...}` |
| A14 | not folded | folded | data-model: Print transport (network printer, cloud print, print server) is infrastructure, undecided; no schema effect; api-outline: Open items 8 (automatic printing, printing from a phone); no endpoint |
| A15 | folded | folded | data-model: Finding 14 only (owner decision on a waiter confirming a transfer; no schema effect); api-outline: Orders, `POST .../payment` row; Open items 11 |
| A16 | folded | folded | data-model: `audit_logs` notes (`order.contact_reveal`); Personal data lifecycle "Masking and reveals"; endpoint is API; api-outline: Orders, new row `POST .../reveal-contact`; `GET /admin/orders/{id}` row (always masked, replaces the sentence "Reading contact details is written to the audit log"); Audit actions list (`order.contact_reveal`); Conventions Privacy |
| A17 | folded | folded | data-model: `order_items` notes and finding 14: stays open (read live tags vs jsonb snapshot); api-outline: AdminOrder shape (`lines[].tags[]`); snapshot vs live read is Open items 11 (shape) and left to data-model for the jsonb column |
| A18 | folded | folded | data-model: Orders `orders.refunded_at`, `orders.refunded_by` (amount is `total`, no partial refunds); api-outline: Orders, `POST .../payment` row (`refundedAt`, `refundedBy`, amount = total); AdminOrder shape. Columns left to data-model |
| A19 | folded | not folded | data-model: Orders notes and "Derived on read": note flag derived from `customer_note` and `order_items.note`; api-outline: UI derivation: the flag merges `customerNote` and line notes, both already in the order detail; no API change |
| A20 | — | folded | api-outline: Orders, `GET /admin/orders/{id}` row; AdminOrder shape (`review {...}`); chose the first option (not `GET /admin/reviews?orderId=`) |
| A21 | folded | not folded | data-model: Orders side-effects paragraph: no flag stored, read from the `ORDER_CANCEL` movement; api-outline: UI wording of the cancel detail; the existing `restoreStock` behaviour is unchanged |
| A22 | folded | folded | data-model: Receipts and statistics: false sentence "a reprint always matches" rewritten; snapshot stays open (finding 14); api-outline: Orders, `GET .../receipt` row; Open items 8 (snapshot receipt settings or fix the sentence) |
| A23 | folded | folded | data-model: `app_settings.brand` note (where `business_address` is used is open) and finding 14; api-outline: Open items 8 (legal address and tax code use); owner supplies values |
| A24 | folded | folded | data-model: "Derived on read" and `order_status_events` notes: time in status from the latest event; the `statusSince` field is API; api-outline: AdminOrder shape (`statusSince`); Orders, `GET /admin/orders/{id}` row |
| A25 | — | folded | api-outline: Branches, `POST .../pause` row (one call per branch); optional `reason` kept in Open items 12 |
| A26 | folded | folded | data-model: Orders notes: `cancel_reason` copied to the status event `note` on reject/cancel; api-outline: Orders, `POST .../transition` row (`REJECTED` note stored in event and `cancelReason`) |
| A27 | — | folded | api-outline: Conventions Idempotency; Orders, `POST .../transition` row; header alternative in Open items 12. Chose "return current order" (simplest) |
| A28 | — | folded | api-outline: Orders, `GET /admin/orders` row (`view=board`) |
| A29 | — | folded | api-outline: Conventions Branch scoping; Orders, `GET /admin/orders` row (`branchIds[]`) |
| A30 | — | folded | api-outline: Orders, `GET /admin/orders` row (`late=true`); AdminOrderSummary shape (`isLate`, `minutesInStatus`; names are mine, Open items 12) |
| A31 | — | folded | api-outline: Conventions Pagination (`prevCursor`); Orders, `GET /admin/orders` row. Chose server `prevCursor` over a client cursor stack |
| A32 | — | folded | api-outline: Conventions Pagination (`estimatedTotal { value, capped }`); Orders `GET /admin/orders` row |
| A33 | — | folded | api-outline: Response shapes: `AdminOrderSummary`; Orders, `GET /admin/orders` row |
| A34 | folded | folded | data-model: `app_settings.ordering.list_max_range_days` (92, proposed); error codes `RANGE_TOO_WIDE`, `RANGE_INVALID` are API; api-outline: Conventions Pagination (92 days, `RANGE_TOO_WIDE`, `RANGE_INVALID`, `placed_at` in Vietnam time); Field-level codes table |
| A35 | — | folded | api-outline: Reports and export, `POST /admin/exports` row (`resource: ORDERS`, `maskContact`, `reason`, `STAFF` -> `FORBIDDEN`) |
| A36 | folded | folded | data-model: Orders `customer_phone_last4` (generated) and index `(branch_id, customer_phone_last4)`; lifecycle scrub; order-number suffix search needs no new index; api-outline: Orders, `GET /admin/orders` row (`q` suffix/last four digits as proposal); Open items 12. Column `customer_phone_last4` left to data-model |
| A37 | — | folded | api-outline: Orders, `GET /admin/orders` row (`customerId`) |
| A38 | folded | — | data-model: Indexes: `orders (branch_id, placed_at DESC, id DESC)` and `(customer_id, placed_at DESC, id DESC)`, edited in place |
| A39 | — | folded | api-outline: Orders, `GET /admin/orders` row (`status=active`, exact `total` so `pageSize=1` is a count, `paymentMethod`); Screen coverage Settings row |
| A40 | folded | folded | data-model: Orders columns: a `REJECTED` order carries `cancelled_by = STAFF` (simplest of the two options); api-outline: Orders, `POST .../cancel` row (rejected counts as cancelled by `STAFF`); enum value alternative left to data-model |
| B1 | folded | folded | data-model: Menu `menu_items.updated_at`, `updated_by` (columns chosen over audit or conflict payload); api-outline: Conventions Optimistic concurrency (`STALE_VERSION` carries `current {...}`); Error catalogue payloads; Menu and stock `/admin/menu-items` and AdminMenuItemRow (`updatedAt`). Columns `updated_at`/`updated_by` left to data-model (chose the `STALE_VERSION` payload option, which needs no column for the conflict banner) |
| B2 | — | folded | api-outline: Menu and stock, `/admin/menu-items` row (list parameters, selects `q`, `limit`, `ids[]`); Conventions Pagination |
| B3 | — | folded | api-outline: Response shapes: AdminMenuItemRow |
| B4 | — | folded | api-outline: Menu and stock, new row `PUT /admin/menu-categories/{id}/items-order` |
| B5 | folded | folded | data-model: `menu_items` notes: soft delete only, no restore; `DELETE` with `rowVersion` and the usage endpoint are API; api-outline: Menu and stock, `/admin/menu-items` row (`DELETE ?rowVersion=` / `If-Match`); new row `GET /admin/menu-items/{id}/usage` |
| B6 | folded | folded | data-model: `menu_items` notes and "Rules that no CHECK can express": last cover and last branch row of a selling item; api-outline: Menu and stock, `/admin/menu-items` row (block removing last cover / last branch); Open items 13 |
| B7 | not folded | not folded | data-model: UI paging detail while dragging; no schema effect; api-outline: Paging detail while dragging; not an API rule (not an issue under 50 items); UI choice |
| B8 | folded | folded | data-model: `menu_items` notes and rules: activation needs `vi` name, `base_price > 0`, cover, one branch row; per-field error codes are API; api-outline: Menu and stock, `/admin/menu-items` row (four checks with `errors[]` fields) |
| B9 | folded | folded | data-model: `item_option_groups` notes and rules list; error codes `MIN_GT_MAX` etc. are API; api-outline: Menu and stock, `/admin/menu-items` row; Field-level codes table (`MIN_GT_MAX`, `DEFAULT_REQUIRED`, `DEFAULT_EXCEEDS_MAX`, `NOT_ENOUGH_ACTIVE`) |
| B10 | — | folded | api-outline: Menu and stock, `/admin/menu-items` row (one `rowVersion` per item); per-group version not added |
| B11 | not folded | not folded | data-model: Copy of a group is browser or API behaviour; the data model already says the editor can copy a group; api-outline: Done in the browser (read the other item and paste); no `option-groups/copy` endpoint added (the gap gives it as an alternative) |
| B12 | not folded | not folded | data-model: Preview is built in the browser; no schema effect; api-outline: Preview is built in the browser from the form; no API |
| B13 | folded | folded | data-model: `menu_item_tags.verified_by`; api-outline: Menu and stock, `/admin/menu-items` row (`verifiedBy` in `GET`). Column `verified_by` left to data-model |
| B14 | folded | folded | data-model: `menu_item_tags` notes (set/clear rules, roles, audited); body shape of `tags[]` is API; api-outline: Menu and stock, `/admin/menu-items` row (`tags: [{ tagId, verified }]`, MANAGER/ADMIN, audited) |
| B15 | folded | folded | data-model: `menu_items` notes (8 per item, API-checked) and finding 14 (fixed or setting is open); api-outline: Menu and stock, `/admin/menu-items` row (8 per item, `TOO_MANY`); Field-level codes; Open items 9 |
| B16 | folded | folded | data-model: `media` notes: 10 MB photo limit validated by the API; status codes `415`, `413`, `duplicate: true` are API; api-outline: Menu and stock, `/admin/uploads/images` row; Error catalogue (`TOO_LARGE` 413, `UNSUPPORTED_TYPE` 415) |
| B17 | not folded | not folded | data-model: Already stated in Retention ("Unreferenced `media` delete 7 days after the last reference is removed"); an immediate clean is a job decision; api-outline: Existing 7-day cleanup rule already applies (recorded in the upload row); an immediate clean is a separate job |
| B18 | folded | — | data-model: `media` notes: `alt_text` stays on `media`, shared by all uses (simplest option); moving it is listed open |
| B19 | folded | folded | data-model: `branch_menu_items` notes: row created on "sold here", deleted on "stop selling"; endpoint is API; api-outline: Menu and stock, new row `PUT, DELETE /admin/branches/{id}/menu-items/{itemId}` |
| B20 | folded | folded | data-model: `audit_logs` notes: `menu.overwrite` (name to confirm); `overwrite: true` flag is API; api-outline: Menu and stock, `/admin/menu-items` row (`overwrite: true`, `menu.overwrite`); Audit actions list; Open items 13 (name) |
| B21 | — | folded | api-outline: Menu and stock, `/admin/menu-items` row (`offered` for every branch, own-branch fields only) |
| B22 | folded | folded | data-model: `branch_menu_items` notes: `CHECK (price_override > 0)`, `CHECK (low_stock_threshold >= 0)`; api-outline: Menu and stock, per-item branch row (field errors `priceOverride`, `lowStockThreshold`); `CHECK`s left to data-model |
| B23 | folded | folded | data-model: `branch_menu_items` notes: tracking start/stop writes `ADJUST` movement and audit row; body is API; api-outline: Menu and stock, `.../stock` row (`trackStock`) |
| B24 | folded | folded | data-model: `tags.row_version`, `amenities.row_version`, RESTRICT references and `IN_USE`; admin endpoints are API; api-outline: Menu and stock, new row `/admin/tags`, `/admin/amenities` (manager for tags, admin for amenities). `row_version` columns left to data-model |
| B25 | folded | folded | data-model: `menu_categories` notes (hard delete when empty, `RESTRICT`); Conventions "Deletion"; api-outline: Menu and stock, new row `DELETE /admin/menu-categories/{id}?rowVersion=` |
| B26 | folded | folded | data-model: `menu_categories` notes: soft-deleted items count (the FK is RESTRICT); problem+json payload is API; api-outline: Error catalogue: Payloads added to existing codes (`IN_USE` `usage {...}`); Open items 13 (soft-deleted items) |
| B27 | — | folded | api-outline: Menu and stock, `/admin/menu-categories` and `/admin/tags`, `/admin/amenities` rows (`itemCount`, `unverifiedCount`, `branchCount`) |
| B28 | — | folded | api-outline: Menu and stock, new row `POST /admin/menu-categories/reorder` |
| B29 | folded | folded | data-model: `menu_categories` notes: hidden category hides its items from customers; api-outline: Public `GET /branches/{id}/menu` row; Menu and stock categories row; Realtime `menu.updated` (existing) |
| B30 | folded | folded | data-model: `tags` notes and rules list: `kind` of a tag with items cannot change; api-outline: Menu and stock, `/admin/tags` row (group change blocked, `IN_USE`) |
| B31 | — | folded | api-outline: Menu and stock, `/admin/menu-categories` and `/admin/tags` rows (`page`, `pageSize`, `q`, `kind`, `total`, stable sort) |
| B32 | folded | folded | data-model: `amenities` notes: `icon` is one key of a fixed list checked by the API; ownership of the list open; api-outline: Menu and stock, `/admin/tags` row (valid icon keys, `VALIDATION_FAILED`); Open items 13 (owner of the list; not added to `/meta/config`) |
| B33 | — | folded | api-outline: Realtime, `menu.availability_changed` row (payload, actor only in staff copy, request key) |
| B34 | — | folded | api-outline: Realtime, `stock.low` row (payload; STAFF do not receive) |
| B35 | folded | folded | data-model: "Derived on read": sold out is derived, no stored flag; api-outline: Menu and stock, `GET, PUT .../menu-items` row (`soldOut` derived) |
| B36 | — | folded | api-outline: Menu and stock, `.../stock` row (delta only, `STOCK_NEGATIVE`); Field-level codes |
| B37 | folded | folded | data-model: "Derived on read": `balanceAfter` by window function; parameters and role are API; api-outline: Menu and stock, `GET .../stock-movements` row (params, `balanceAfter`, hidden from STAFF) |
| B38 | not folded | folded | data-model: UI decision about a multi-branch grid; no schema effect; api-outline: Open items 13 (multi-branch availability grid); no endpoint |
| B39 | folded | folded | data-model: Finding 14: `voucher_menu_items` not created, left open as the brief asks; api-outline: Open items 13 (vouchers limited to items); table `voucher_menu_items` left to data-model |
| C1 | folded | folded | data-model: `branches` notes and rules list: soft delete by `ADMIN`, refused for orders in progress, upcoming reservations, last active branch; endpoint is API; api-outline: Branches, new row `DELETE /admin/branches/{id}?rowVersion=`; Error catalogue payloads (`HAS_ACTIVE_ORDERS`) |
| C2 | folded | folded | data-model: "Derived on read": staff count, rating average, orders today, active orders, today's hours; api-outline: Branches, `/admin/branches` row (row figures); Response shapes AdminBranchRow |
| C3 | folded | folded | data-model: Finding 14 (block or suspend is the owner's decision); api-outline: Open items 14 (staff who lose their last branch) |
| C4 | — | folded | api-outline: Branches, `/admin/branches` row (`page`, `pageSize`, `q`, `status`) |
| C5 | folded | — | data-model: `branches` notes: `location` stays required (simplest option); finding 14 |
| C6 | folded | folded | data-model: `branches` notes (code locked once an order exists) and "Derived on read" (`codeLocked`); error code is API; api-outline: Branches, `/admin/branches` row (`codeLocked`, `LOCKED`); Field-level codes |
| C7 | folded | folded | data-model: Indexes: `wards (province_code)`; the search endpoint is API; api-outline: Branches, new row `GET /admin/wards` (`provinceCode`, `q`, `limit` 20) |
| C8 | folded | folded | data-model: "Derived on read": `activeZoneCount`; the PATCH validation is API (the rule is in `branches` notes, C21); api-outline: Branches, `/admin/branches` row (`activeZoneCount`, `VALIDATION_FAILED` on `acceptsDelivery`); zones row (`LAST_ACTIVE_ZONE`) |
| C9 | folded | folded | data-model: `audit_logs` notes: `branch.location_confirm`; no column added; api-outline: Branches, `/admin/branches` row (`branch.location_confirm`); Audit actions list |
| C10 | folded | folded | data-model: `branches.updated_at`, `updated_by`; api-outline: Conventions Optimistic concurrency (`current { updatedBy, updatedAt }`). Columns left to data-model |
| C11 | folded | folded | data-model: `branch_opening_periods` notes: 00:00 to 23:59 kept, `is_24h` listed as alternative; open in finding 14; api-outline: Branches, hours row (open 24 hours); Open items 14. Check/`is_24h` left to data-model |
| C12 | folded | folded | data-model: `branch_special_hours` notes and Query patterns "Open now": delivery hours intersected with store hours; api-outline: Branches, hours row (effective delivery hours = delivery intersected with store hours) |
| C13 | folded | folded | data-model: `branch_special_hours` notes: `note` is internal; a display field is not added; api-outline: Branches, hours row; Open items 14 (display field and translation) |
| C14 | folded | folded | data-model: `branch_special_hours` notes and rules list: API check (exclusion constraint named as alternative); api-outline: Branches, hours row (special ranges may not overlap, `OVERLAP`); constraint choice left to data-model |
| C15 | folded | folded | data-model: `branch_opening_periods` notes and rules list; codes `OVERLAP` etc. are API; api-outline: Branches, hours row; Field-level codes (`OVERLAP`, `EQUAL_TIMES`, `INVALID_TIME`) |
| C16 | — | folded | api-outline: Branches, hours row (`PUT` body shape, `closesNextDay` derived) |
| C17 | — | folded | api-outline: Branches, hours row (paging of special days, hide after 30 days) |
| C18 | — | folded | api-outline: Branches, delivery-zones row (paths, body, `rowVersion`) |
| C19 | folded | folded | data-model: `delivery_zones` notes and Indexes: partial unique (`branch_id`, `radius_m`) on active rows (the "unique and auto-sort" option); api-outline: Branches, delivery-zones row (`RADIUS_ORDER`); Field-level codes; unique-constraint option left to data-model |
| C20 | folded | — | data-model: `delivery_zones` notes: three CHECKs |
| C21 | folded | folded | data-model: `branches` and `delivery_zones` notes and rules list: last active zone stays while `accepts_delivery`; api-outline: Branches, delivery-zones row (`LAST_ACTIVE_ZONE`); Field-level codes. Chose the field-level code (not a 409 like `LAST_ADMIN`) |
| C22 | folded | folded | data-model: `delivery_zones` notes and rules list: `orders.delivery_zone_id` RESTRICT, `IN_USE`; api-outline: Branches, delivery-zones row (`IN_USE`); Error catalogue payloads. `ON DELETE RESTRICT` left to data-model |
| C23 | folded | folded | data-model: `delivery_zones.row_version`; Conventions; api-outline: Branches, delivery-zones row (`rowVersion` per zone; chose it over using `branches.row_version`). Column left to data-model |
| C24 | — | folded | api-outline: Branches, new row `POST .../delivery-zones/check` |
| C25 | folded | folded | data-model: `audit_logs` notes: `delivery_zone.create/.update/.delete`; api-outline: Branches, delivery-zones row; Audit actions list (`delivery_zone.*`) |
| C26 | — | folded | api-outline: Branches, delivery-zones row; Realtime `menu.updated`/`branch.updated` row |
| C27 | — | folded | api-outline: Branches, delivery-zones row (returns all with `total`); cap per branch in Open items 14 |
| C28 | folded | folded | data-model: `branches.website_url` (chosen over a `branch_contacts` table); api-outline: Branches, `/admin/branches` row (`websiteUrl` in PATCH). Column `branches.website_url` left to data-model |
| C29 | folded | — | data-model: `branches` notes: `cover_media_id` kept equal to position 0 by the API (safer option); dropping it listed open |
| C30 | folded | folded | data-model: `branch_media` notes and Indexes: unique (`branch_id`, `position`) `DEFERRABLE INITIALLY DEFERRED`; api-outline: Branches, `/admin/branches` row (the whole `media` list written in one transaction). Unique constraint left to data-model |
| C31 | — | folded | api-outline: Branches, `/admin/branches` row (body of the photo and contact tab) |
| C32 | folded | folded | data-model: `media.alt_text` CHECK 200; 12 photos per branch (API); upload error codes are API; api-outline: Branches, `/admin/branches` row (12 photos, 200 chars alt, codes); Field-level codes (`LIMIT_REACHED`, `TOO_LONG`); Open items 9 |
| C33 | — | folded | api-outline: Staff session, `/admin/meta/config` row; AdminMetaConfig shape (`brand.hotline`) |
| C34 | folded | folded | data-model: Finding 14 (which tab edits `branches.phone`; stored form stays E.164); api-outline: Open items 14 (phone in two tabs); Branches `/admin/branches` row |
| E1 | — | folded | api-outline: Users and operations, `POST /admin/users` and `PATCH /admin/users/{id}` rows (`displayName`) |
| E2 | — | folded | api-outline: Users and operations, `GET /admin/users` row (staff item shape, `scope`, `branchId`, paging) |
| E3 | folded | folded | data-model: `users.last_login_at`; lifecycle scrub on anonymisation; api-outline: Users and operations, `GET /admin/users` row (`lastLoginAt`). Column `users.last_login_at` left to data-model |
| E4 | folded | not folded | data-model: Conventions (optimistic concurrency): `users` gets no `row_version`, stated as a decision of the brief (not needed); api-outline: Not drawn (two admins rarely edit one person); listed in Open items 16 as a future option, no `rowVersion` added |
| E5 | folded | folded | data-model: Finding 14: whether `LAST_ADMIN` counts MFA is open; api-outline: Open items 16; Users, `PATCH /admin/users/{id}` row |
| E6 | folded | folded | data-model: `users` notes and rules list: a role change revokes all refresh tokens, a branch change does not; api-outline: Users and operations, `PATCH /admin/users/{id}` row (role change revokes sessions, `session.revoked`) |
| E7 | — | folded | api-outline: Users and operations, `reset-password` row (`INVALID_STATE`); Error catalogue |
| E8 | folded | folded | data-model: `audit_logs` notes: `user.create`, `user.role_change`, ... with diffs; api-outline: Audit actions list (`USER_*`) |
| E9 | — | folded | api-outline: Users and operations, `mfa-reset` row; Error catalogue `MFA_NOT_ENABLED` (409) |
| E10 | — | folded | api-outline: Users and operations, `resend-invite` row (`INVALID_STATE`, once per 60 s); Conventions Rate limits; Error catalogue |
| E11 | — | folded | api-outline: Realtime, new `email.failed` row; Open items 16 (alternative `users.invite_error`) |
| E12 | folded | folded | data-model: "Derived on read": `ordersCount`, `lastOrderAt`, `completedOrders`; response shape is API; api-outline: Users and operations, `GET /admin/users` row (customer item shape, full email/phone search, `total`) |
| E13 | folded | folded | data-model: `audit_logs` notes (reveal on entity `USER`) and lifecycle paragraph; endpoint is API; api-outline: Users and operations, new row `POST /admin/users/{id}/reveal-contact`; Open items 10 |
| E14 | — | folded | api-outline: Users and operations, `GET /admin/users` row (`activeAdminsWithMfa`); chose this over `/admin/meta/config` |
| E15 | folded | folded | data-model: `users` notes: wrong password and wrong TOTP code both count in `failed_login_count`; api-outline: Authentication, staff transport (rules list) |
| E16 | not folded | folded | data-model: Rate-limit figures and where the limiter runs are infrastructure (ADR-0003 open item 3); `failed_login_count` and `locked_until` already exist; api-outline: Conventions Rate limits; Open items 16 (figures) |
| E17 | folded | folded | data-model: `audit_logs` notes: login events logged, never secrets, unknown email not logged; api-outline: Authentication, staff transport (login audit events; names are proposals) |
| E18 | folded | folded | data-model: `app_settings.maintenance` note (never blocks `/admin/auth/*`), see L13; api-outline: Conventions Maintenance; Authentication, staff transport (rules list) |
| E19 | — | folded | api-outline: Authentication, staff transport (`CODE_INVALID`) |
| E20 | folded | folded | data-model: `mfa_credentials` notes: ten codes, warning at three left, new set when none are left (needs confirmation); api-outline: Authentication, staff transport (ten codes, warning at three, new set when none left); the "needs confirmation" part remains a proposal |
| F1 | — | folded | api-outline: Dashboard section: `GET /admin/dashboard` (phase 1, staff); Conventions Revenue visibility |
| F2 | — | folded | api-outline: Dashboard row (200 with per-branch `status: ERROR`, retry one branch); `207` alternative in Open items 17 |
| F3 | folded | folded | data-model: Indexes `order_status_events (to_status, created_at)` partial; new Query pattern "Dashboard"; `placed_business_date` named as alternative; api-outline: Dashboard row (window definitions). Partial indexes / `placed_business_date` left to data-model |
| F4 | folded | folded | data-model: Finding 14: replacement of the impossible group is open; api-outline: Dashboard row; Open items 17 (groups to replace "completed but unpaid") |
| F5 | folded | folded | data-model: Query patterns "Reports" and `order_status_events` notes: counter orders left out of accept time; api-outline: Dashboard row (counter orders left out of the average accept time) |
| F6 | — | folded | api-outline: Dashboard row (late threshold from `/admin/meta/config`) |
| F7 | folded | folded | data-model: `branch_menu_items` notes: null threshold never means low; api-outline: Dashboard row (null threshold never low) |
| F8 | — | folded | api-outline: Dashboard row (`openReports` only when phase 2 feature is on) |
| F9 | — | folded | api-outline: Error catalogue: `INTERNAL_ERROR` (500) |
| F10 | — | folded | api-outline: Realtime closing paragraph (no dedicated dashboard event) |
| G1 | folded | folded | data-model: `audit_logs` notes: one catalogue of 21 codes; api-outline: Users and operations, `GET /admin/audit-logs` row (21 codes as a shared catalogue); Audit actions list |
| G2 | folded | folded | data-model: `audit_logs` notes: eight entity types; api-outline: Users and operations, `GET /admin/audit-logs` row (eight `entityType` values) |
| G3 | — | folded | api-outline: Users and operations, `GET /admin/audit-logs` row (params, item shape, paging) |
| G4 | folded | folded | data-model: `audit_logs.entity_label` (stored at write time; users carry the display name, never the email); api-outline: Users and operations, `GET /admin/audit-logs` row (`entityLabel`, `entityExists`); storing the label at write time is a data-model matter |
| G5 | folded | folded | data-model: `audit_logs` notes: manager sees own `branch_id` rows; null-branch rows are admin only; api-outline: Users and operations, `GET /admin/audit-logs` row (manager sees own-branch rows; null-branch rows admin only; writers must set `branch_id`) |
| G6 | folded | — | data-model: Indexes: `audit_logs (created_at DESC, id DESC)` |
| G7 | folded | folded | data-model: `audit_logs` notes: list of missing actions, names to decide or merge; api-outline: Open items 18; Audit actions list |
| G8 | folded | folded | data-model: `audit_logs` notes: sensitive fields stripped before writing; api-outline: Users and operations, `GET /admin/audit-logs` row (server strips sensitive fields; UI formats values) |
| G9 | — | folded | api-outline: Conventions Pagination (`estimatedTotal`); audit-logs row |
| H1 | folded | — | data-model: Indexes: `reviews (branch_id, created_at DESC, id DESC)` no longer partial (existing row rewritten) |
| H2 | folded | — | data-model: Indexes: GIN trigram on `unaccent(email)` and `unaccent(display_name)`, deferred |
| H3 | — | folded | api-outline: Conventions Pagination (selects: `q`, `limit` 20, `ids[]`); Menu and stock `/admin/menu-items` row |
| H4 | — | folded | api-outline: Conventions Pagination (`INVALID_CURSOR`, 400); Field-level codes |
| H5 | — | folded | api-outline: Reviews and reports, `GET /admin/reports` row (`status`, `reason`, `page`, `pageSize`, `total`) |
| I1 | — | folded | api-outline: Users and operations, `PATCH /admin/users/{id}` row (branch change: channel rebuilt, session kept); proposal option chosen over `session.revoked` with a reason |
| I2 | — | folded | api-outline: Realtime, new `presence.changed` row (memory only; kept because the viewing dot is a W12C accepted decision) |
| I3 | — | folded | api-outline: Realtime, `config.changed` row (admin web refetches `GET /admin/meta/config`) |
| I4 | not folded | folded | data-model: Connection-state wording and thresholds are UI; api-outline: Realtime closing paragraph (lost after 30 s / two cycles; `Cập nhật lúc`) |
| I5 | not folded | not folded | data-model: Refetch wording follows api-outline; UI/doc wording only; api-outline: Already as in the outline (refetch each cycle while the board is open); the fix is in frame 22 wording, not the API |
| I6 | — | folded | api-outline: Realtime, `review.status_changed` row (one status event) |
| J1 | folded | folded | data-model: `export_jobs` notes: `VOUCHERS` export is phase 2; the manager's branch scope is API; api-outline: Reports and export, `POST /admin/exports` row (`VOUCHERS`, phase 2, manager own-branch vouchers) |
| J2 | — | folded | api-outline: Reports and export, `POST /admin/exports` row (body shape) |
| J3 | folded | folded | data-model: `export_jobs` notes: chosen columns kept inside `filters`, no `columns` column; api-outline: Reports and export, `POST /admin/exports` row (`columns?`). Column `export_jobs.columns` left to data-model |
| J4 | not folded | not folded | data-model: No progress percentage; no schema effect; api-outline: No progress percentage (statistics file is small); not proposed by the gap |
| J5 | folded | folded | data-model: `export_jobs` notes: `mask_contact` default true, reason required whenever unmasked for every file with phone or address (existing sentence rewritten); api-outline: Reports and export, `POST /admin/exports` row (`maskContact`, `reason` for every file with contact) |
| J6 | — | folded | api-outline: Reports and export, exports row (`TOO_MANY_ROWS`, `RATE_LIMITED`); Conventions Rate limits; Field-level codes |
| J7 | — | folded | api-outline: Error catalogue payloads (`NOT_FOUND` for an expired file); `410` alternative in Open items 19 |
| J8 | not folded | not folded | data-model: Missing `Xuất` buttons are UI; api-outline: UI: missing `Xuất` buttons in frames 08 and 15; the endpoints (`USERS`, `STOCK`) already exist |
| J9 | folded | folded | data-model: `export_jobs` notes: `AUDIT_LOGS` export is phase 2; api-outline: Reports and export, exports row (`AUDIT_LOGS` export is phase 2) |
| J10 | — | folded | api-outline: Reports and export, `GET /admin/reports/revenue` row: phase 1 for the statistics page, shape with `summary`, `yearToDate`, `rows`, `totals`; merged with J101 (see Conflicts) |
| J11 | — | folded | api-outline: Reports and export, revenue row and exports row (`branchIds[]` replaces `branchId?`) |
| J12 | folded | folded | data-model: Receipts and statistics, Query patterns: cancelled/refunded dated by the event's business date; `closed_business_date` alternative open; api-outline: Reports and export, exports row (date of cancel event for cancelled/refunded orders) |
| J13 | — | folded | api-outline: Staff session, `/admin/meta/config` row (`reports.businessDayStartsAt`); AdminMetaConfig; revenue row (`businessDayStartsAt`) |
| J14 | — | folded | api-outline: Reports and export, revenue row (`yearToDate`) |
| J15 | — | folded | api-outline: Conventions Pagination (366 days); revenue row (preview paged at 20) |
| J16 | — | folded | api-outline: Reports and export, revenue row (browser computes dates; server takes no presets) |
| J17 | folded | folded | data-model: `export_jobs` notes: `sheets[]` stored in `filters`; api-outline: Reports and export, exports row (`sheets[]`) |
| J18 | — | folded | api-outline: Reports and export, new row `GET /admin/exports/{id}`; ExportJob shape |
| J19 | — | folded | api-outline: Reports and export, exports row (`EXPORT_FAILED`, name open); Open items 19 |
| J20 | folded | — | data-model: `export_jobs` notes and Retention: `expires_at` = created + 7 days, file deleted at expiry, row purged 7 days later |
| J21 | folded | folded | data-model: Receipts and statistics: `Ăn tại quán` and `Khách tại quầy` in the order sheet; api-outline: Reports and export, exports row (`Ăn tại quán`, counter guest without phone) |
| J101 | — | folded | api-outline: Reports and export, revenue row (rows shape, `branchIds[]`, `closed`); merged with J10 |
| J102 | — | folded | api-outline: Reports and export, revenue row (`compare=previousPeriod`); chose the single-call option |
| J103 | — | folded | api-outline: Reports and export, revenue row (366 days); Conventions Rate limits; Open items 24 (slow-query code, cache). `groupBy=month` not added (W15C decision: no week or month yet) |
| J104 | folded | folded | data-model: Query patterns "Reports": item revenue definition; response shape is API; api-outline: Reports and export, `top-items` row |
| J105 | folded | folded | data-model: Query patterns "Reports": accept and preparation definitions, scheduled and counter orders left out; response shape is API; api-outline: Reports and export, `orders-summary` row |
| J106 | folded | folded | data-model: Orders `orders.cancel_reason_code` (example values; accepted as a proposal in W15C); notes and Query patterns; api-outline: Open items 24 (cancellation reason pick list); column/list left to data-model |
| J107 | folded | folded | data-model: Query patterns "Reports": peak hours by `placed_at` in Vietnam time; shape is API; api-outline: Reports and export, `orders-summary` row (peak hours, `daysInRange`) |
| J108 | not folded | not folded | data-model: Chart palette is a design token gap, not data; api-outline: Design tokens (chart palette in `tokens.json`); not an API item |
| J109 | folded | — | data-model: Orders `DINE_IN` and nullable `customer_id`; Query patterns "Reports" |
| J110 | not folded | not folded | data-model: UI choice (no per-chart download); no schema effect; api-outline: No separate chart download; the table under the chart and the Excel file are the two ways |
| K1 | folded | folded | data-model: `email_suppressions` notes (add/lift by `ADMIN`, audited) and `audit_logs` notes; endpoints are API; api-outline: Users and operations, new row `/admin/email-suppressions`; chose phase 1 with the email screen |
| K2 | folded | not folded | data-model: `email_templates` notes: placeholder proposals per key; api-outline: Template variable table is a frame proposal; no API returns it, data-model stores subject/body only |
| K3 | not folded | — | data-model: No `requested_by` column added (audit log can answer if needed) |
| K4 | folded | folded | data-model: Finding 14: whether a test send is logged is open; api-outline: Users and operations, email row; Open items 20 |
| K5 | — | folded | api-outline: Users and operations, email row (resend rules); Conventions Rate limits |
| K6 | — | folded | api-outline: Users and operations, email row (customers found by full address, masked) |
| K7 | not folded | not folded | data-model: No export of the email log; no schema effect; api-outline: No export of the email log; no `Xuất` button (answer recorded in Open items 19) |
| L1 | folded | folded | data-model: `app_settings.row_version` (per key); Conventions; api-outline: Users and operations, `/admin/app-settings` row (per-key `{ value, rowVersion, ... }`, `PUT { key, value, rowVersion }`); Conventions Optimistic concurrency. `row_version` column left to data-model |
| L2 | — | folded | api-outline: Error catalogue: Field-level codes table (settings codes) |
| L3 | folded | folded | data-model: `app_settings.ordering` proposed defaults 20, 30, 30, 3, 7; api-outline: Open items 21 (proposed defaults 20, 30, 30 min, 3 days, 7 days); values themselves left to data-model/ADR |
| L4 | folded | folded | data-model: `app_settings.ordering.board_thresholds` shape and proposed defaults 5/10 and 15/25; api-outline: Users and operations, `/admin/app-settings` row (`board_thresholds` shape); AdminMetaConfig shape |
| L5 | folded | folded | data-model: `media` notes and `app_settings.brand.logo` (media id, limits); api-outline: Menu and stock, `/admin/uploads/images` row (logo rules); Public `/meta/config` (`logoUrl`) |
| L6 | folded | folded | data-model: `app_settings.brand`: tax code 10 or 13 digits, printed only when shown; api-outline: Users and operations, `/admin/app-settings` row (10 or 13 digits, `INVALID_TAX_CODE`) |
| L7 | folded | folded | data-model: `app_settings.brand.receipt`: title 40, footer 200 characters and 4 lines; `GET .../receipt` is API; api-outline: Users and operations, `/admin/app-settings` row; Orders, `GET .../receipt` row (normalised strings) |
| L8 | folded | folded | data-model: Orders transitions paragraph (system cancel: null actor, note, constant reason, above late threshold) and `ordering` note; counting basis, interval, customer notice open (finding 14); api-outline: Open items 21 (auto-cancel semantics) |
| L9 | — | folded | api-outline: Realtime, `config.changed` row (`keys[]`, version, no values) |
| L10 | folded | folded | data-model: `audit_logs` notes: `settings.change`; api-outline: Users and operations, `/admin/app-settings` row; Audit actions list (`settings.change`) |
| L11 | folded | folded | data-model: `app_settings.brand` note and finding 14; api-outline: Open items 8 (use of `brand.business_address`) |
| L12 | folded | folded | data-model: `app_settings.min_app_version` shape `{ ios, android }`; `UPGRADE_REQUIRED` is API; api-outline: Public `/meta/config` row (`minAppVersion { ios, android }`); Error catalogue payloads (`UPGRADE_REQUIRED` store URL); app-settings row |
| L13 | folded | folded | data-model: `app_settings.maintenance` shape; customer-facing only; api-outline: Public `/meta/config` row (`maintenance` shape); Conventions Maintenance; Open items 21. Chose customer-facing scope (accepted W13B) |
| L14 | folded | folded | data-model: `audit_logs` notes: `payment` change keeps only the last 5 digits; the step-up endpoint and notification email are API; api-outline: Authentication, staff transport (`POST /admin/auth/step-up`, proposal); app-settings row; Open items 21 |
| L15 | folded | folded | data-model: `app_settings` note: security values are server configuration, not keys; api-outline: Users and operations, `/admin/app-settings` row (read-only `security` block) |
| L16 | — | folded | api-outline: Promotions and loyalty, `/admin/settings/loyalty` row (entry point vs storage) |
| L17 | folded | folded | data-model: `app_settings.reports` note and finding 14; api-outline: Open items 21 (moving the business-day start) |
| L18 | — | folded | api-outline: Deferred section closing paragraph (`featureFlags.einvoice` only once enabled); Open items 26. Not removed entirely because Z3 and the shell design keep `features.einvoice`; see Conflicts |
| M1 | folded | folded | data-model: `vouchers` notes and "Derived on read": status derived, not stored; shape is API; api-outline: Promotions and loyalty, `/admin/vouchers` row (params, item shape, derived `status`) |
| M2 | folded | folded | data-model: `voucher_redemptions` notes: reversal reason read from the order; endpoint is API; api-outline: Promotions and loyalty, new row `GET /admin/vouchers/{id}/redemptions` |
| M3 | folded | folded | data-model: `voucher_assignments` notes: unused assignment can be revoked by deleting the row; endpoints are API; api-outline: Promotions and loyalty, `assign` row (`{ userIds[] }`) and new row `.../assignments` |
| M4 | not folded | folded | data-model: No `created_by` added; `audit_logs` already lists voucher edits; api-outline: Promotions and loyalty, vouchers row (edits and assignments audited). `created_by` column left to data-model |
| M5 | folded | folded | data-model: `vouchers` notes: code locked after any redemption row or assignment; api-outline: Promotions and loyalty, vouchers row (code locks; `LOCKED`); Field-level codes |
| M6 | folded | folded | data-model: `vouchers` notes and Conventions "Deletion": never deleted, only switched off; api-outline: Promotions and loyalty, vouchers row (no `DELETE`); Open items 23 |
| M7 | folded | folded | data-model: `vouchers` notes: value-limit CHECKs; api-outline: Promotions and loyalty, vouchers row (value limits) |
| M8 | folded | folded | data-model: `vouchers` notes and "Derived on read": status counts non-reversed rows, not `redeemed_count`; api-outline: Promotions and loyalty, vouchers row (status counts non-reversed redemptions, server time) |
| M9 | not folded | not folded | data-model: Already in the data model ("points are earned on the subtotal after the voucher discount"); the rest is preview wording; api-outline: Wording of the form preview and documents (points are earned after the voucher, already in data-model); no API change |
| M10 | folded | folded | data-model: `vouchers` notes: derived wallet state `USABLE`, `BELOW_MIN`, `EXPIRED`, `USED`; response shape is API; api-outline: Current user `/me/vouchers` row; MyVoucher shape |
| M11 | — | folded | api-outline: Open items 23 (no `voucher.updated` event added); Realtime closing paragraph |
| M12 | folded | folded | data-model: `promotions` notes and "Derived on read": status and link state derived; shape is API; api-outline: Promotions and loyalty, `/admin/promotions` row (params, item shape, `linkState`) |
| M13 | folded | folded | data-model: `promotions.row_version`; Conventions; api-outline: Promotions and loyalty, `/admin/promotions` row (`rowVersion`). Column left to data-model |
| M14 | folded | folded | data-model: `promotions` notes: bulk reorder rewrites `sort_order`, no unique constraint; endpoint is API; api-outline: Promotions and loyalty, new row `PUT /admin/promotions/order` |
| M15 | folded | folded | data-model: `promotions` notes: CHECKs, no FK on `link_target`, API check; api-outline: Promotions and loyalty, `/admin/promotions` row (validation on save); Public `GET /home` row (drop broken button). `CHECK`s left to data-model |
| M16 | folded | folded | data-model: `promotions` notes and `media` notes: ratio, minimum size, 10 MB; api-outline: Menu and stock, `/admin/uploads/images` row (banner image rules); promotions row (alt edited with banner) |
| M17 | folded | folded | data-model: `promotions` notes and finding 14: per-branch banners open; api-outline: Open items 23 (per-branch banners) |
| M18 | folded | folded | data-model: `loyalty_ledger` notes and "Derived on read": `balanceAfter`; endpoint is API; api-outline: Promotions and loyalty, new row `GET /admin/users/{id}/points` |
| M19 | folded | folded | data-model: "Derived on read": `pointsBalance`, `completedOrders`; endpoint shape is API; api-outline: Users and operations, `GET /admin/users` row (`pointsBalance`, `completedOrders`); chose adding to the users list over a new `/admin/loyalty/accounts` |
| M20 | folded | folded | data-model: `loyalty_ledger` and `loyalty_accounts` notes: note 5 to 200, absolute delta at most 10000, account created if absent, one transaction; idempotency key storage open (finding 14); api-outline: Promotions and loyalty, `POST /admin/users/{id}/points` row; Conventions Idempotency |
| M21 | folded | folded | data-model: `loyalty_ledger` notes: the note of `ADJUST` is staff-only (proposed); api-outline: Current user `/me/points` row (note not returned, proposal) |
| M22 | folded | folded | data-model: `app_settings.loyalty` key names; endpoint shape is API; api-outline: Promotions and loyalty, `/admin/settings/loyalty` row (shape) |
| M23 | folded | folded | data-model: `audit_logs` notes: `promotion.*` actions; entity type open (finding 14); api-outline: Audit actions list (`promotion.*`) |
| M24 | — | folded | api-outline: Realtime closing paragraph (no banner or points event); Open items 23 |
| M25 | not folded | folded | data-model: No export of banners or points ledger is drawn; `LOYALTY_LEDGER` not added to `export_jobs.resource`; api-outline: Open items 23 (no export of the points ledger; no `LOYALTY_LEDGER` resource added) |
| N1 | — | folded | api-outline: Deferred section, new row `GET /admin/invoices/{id}` |
| N2 | folded | folded | data-model: E-invoices notes: due time derived, queue lists only invoices of `COMPLETED` orders; response shape and `kind` filter are API; api-outline: Deferred section, `GET /admin/invoices` row (`kind`, items, `counts`, sort) |
| N3 | folded | folded | data-model: `order_invoices` notes: replace is a transaction (`REPLACED`, `replaced_by_id`, new `PENDING`); endpoint is API; api-outline: Deferred section, new row `POST /admin/invoices/{id}/replace` |
| N4 | folded | folded | data-model: `order_invoices` notes: buyer editable while `PENDING` or `FAILED`, also after completion; api-outline: Deferred section, `POST /admin/orders/{id}/invoice` row |
| N5 | — | folded | api-outline: Deferred section, `.../issue` row (`taxLines?`) |
| N6 | — | folded | api-outline: Error catalogue: `INVALID_STATE` (issue on non-completed order); HTTP status of provider codes left open in Open items 25 |
| N7 | folded | folded | data-model: `order_invoices` and `summary_invoices` notes and Rules: unique (`series`, `invoice_number`); api-outline: Deferred section, `.../issue` row (`ALREADY_EXISTS` for series + number). Unique index left to data-model |
| N8 | — | folded | api-outline: Deferred section intro (STAFF may use `POST /admin/orders/{id}/invoice` and see status); Open items 25 |
| N9 | folded | folded | data-model: `order_invoices` and `summary_invoices` notes: due time from `completed_at` or `created_at`; queue only completed orders; api-outline: Deferred section, `GET /admin/invoices` row (due time from `created_at` for summaries; only completed orders listed) |
| N10 | — | not folded | api-outline: Optional `invoice.failed` event not added: the owner accepted "no invoice event for now" (admin-shell-design section 9); recorded in Open items 25 and in the deferred closing paragraph |
| N11 | folded | folded | data-model: E-invoices "Added when enabled": `export_jobs.resource` gains `INVOICES`; lifecycle row for invoice buyer data; api-outline: Deferred section closing paragraph (`INVOICES` export columns) |
| N12 | folded | — | data-model: E-invoices "Added when enabled": `tax.legal_name`; the tax code is read from `brand.tax_code` (my choice of the single source) |
| N13 | not folded | folded | data-model: Tax group field in the item editor is UI; the nullable `tax_group` columns are already designed; api-outline: Deferred section closing paragraph (`taxGroup` on menu items, only when invoices are on); columns left to data-model |
| N14 | not folded | not folded | data-model: Customer-app frame set for invoices; design work, no schema effect; api-outline: Customer-app frames not drawn; belongs to `designs/mobile` |
| N15 | not folded | not folded | data-model: Sidebar item `Hóa đơn` belongs to `03-ia-roles-components.md`; api-outline: Sidebar item for Hóa đơn (UI); the count is covered by `nav-counts` (Z4) |
| P1 | — | folded | api-outline: Reservations (staff), `GET /admin/reservations` row; AdminReservation shape |
| P2 | folded | folded | data-model: Reservations: new transitions table, `decline_reason` 1 to 200; body and `conflicts[]` are API; api-outline: Reservations (staff), `.../transition` row (required fields, `conflicts[]`); Error catalogue payloads |
| P3 | folded | — | data-model: New table `reservation_status_events`; ER diagram; Conventions; Indexes; Retention |
| P4 | folded | folded | data-model: `reservations` notes and `audit_logs` notes: reveal writes an audit row; endpoint is API; api-outline: Reservations (staff), new row `POST /admin/reservations/{id}/reveal-contact` |
| P5 | folded | folded | data-model: `reservation_tables` notes and transitions: tables changeable after confirmation; endpoint is API; api-outline: Reservations (staff), new row `PATCH /admin/reservations/{id}/tables` |
| P6 | folded | folded | data-model: Reservations transitions table: `CONFIRMED` to `CANCELLED` by staff with a reason kept in the event `note` (proposed); api-outline: Reservations (staff), `.../transition` row (`CONFIRMED` -> `CANCELLED` as proposal); Open items 22 |
| P7 | folded | folded | data-model: `reservations.customer_id` nullable; first event by staff; endpoint is API; api-outline: Reservations (staff), new row `POST /admin/reservations` (phase 2 proposal); Open items 22 |
| P8 | — | folded | api-outline: Open items 22: no endpoint added; the admin web derives free tables from the day's calendar (simpler of the two options) |
| P9 | folded | — | data-model: `reservation_tables` notes: capacity is the sum of seats, no joining group (accepted in W14A) |
| P10 | folded | folded | data-model: `restaurant_tables` and `orders` notes and finding 14: not linked, open; api-outline: Open items 22 (link `orders.table_label` and `restaurant_tables`) |
| P11 | folded | folded | data-model: `app_settings.reservations` keys (30, 15, 15, 30); auto-expire open; api-outline: Reservations (staff), `.../transition` row (30 / 15 minute windows as settings); Open items 22 (key names, waiting thresholds, expiry) |
| P12 | folded | — | data-model: `reservations` notes and finding 14: no display code, open |
| P13 | — | folded | api-outline: Realtime, `reservation.requested`/`reservation.status_changed` row (payload) |
| P14 | — | folded | api-outline: Reservations (staff), `GET /admin/reservations` row (empty list, no error); chose empty list over a dedicated code |
| P15 | folded | folded | data-model: `restaurant_tables` notes: `IN_USE` rules for switch-off, seat reduction, delete; RESTRICT; shape of the endpoints is API; api-outline: Branches, `/admin/branches/{id}/tables` row (shape, `IN_USE` with `reservations[]`); Error catalogue payloads |
| P16 | folded | folded | data-model: `restaurant_tables.row_version` (chosen over last writer wins); api-outline: Branches, tables row (`rowVersion` in PATCH, as proposal); Open items 22. Column left to data-model |
| P17 | folded | folded | data-model: `restaurant_tables` notes: natural name order, no `sort_order`; api-outline: Branches, tables row (sorted by name in numeric order); `sort_order` left to data-model |
| P18 | not folded | not folded | data-model: Where the rules are edited and a label change in frame 10 are UI; api-outline: UI/design: rules edited only in frame 24, label change in frame 10. API note only: rules saved by `PATCH /admin/branches/{id}` (Branches row) |
| P19 | folded | — | data-model: `branches`: `reservation_slot_minutes` replaced by `reservation_duration_minutes` and `reservation_slot_step_minutes` (accepted as proposed in W14B) |
| P20 | — | folded | api-outline: Branches, `/admin/branches` and tables rows; Open items 14 (separate rules endpoint not added; accepted the shared `rowVersion`) |
| P21 | folded | folded | data-model: `branches` notes (reservation rule CHECKs) and `restaurant_tables` notes (name, seats, area limits); api-outline: Branches, tables row (value limits) |
| P22 | folded | folded | data-model: `restaurant_tables` notes: `area` is free text with suggestions; api-outline: Branches, tables row (area free text up to 40) |
| P23 | folded | folded | data-model: "Derived on read": `holdingCount`, `seatedNow`; `restaurant_tables` notes; api-outline: Branches, tables row (`holdingCount`) |
| P24 | — | folded | api-outline: Branches, tables row and Realtime `branch.updated` row (used `branch.updated`, no new `tables.changed`) |
| P25 | not folded | not folded | data-model: Sub-items of the Đặt bàn menu are UI; api-outline: Navigation sub-items of the sidebar; UI |
| R1 | folded | folded | data-model: Finding 14 (paper size open); the receipt width 58 or 80 mm already exists in `app_settings.brand.receipt`; api-outline: Open items 8 (paper size of kitchen ticket and receipt); no endpoint change |
| R2 | folded | folded | data-model: Findings 10 and 14: title and threshold stay open; title length 40 is in `app_settings.brand.receipt` (L7); api-outline: Open items 8 (receipt title wording, revenue threshold for e-invoices) |
| R3 | folded | folded | data-model: Finding 14 and Receipts and statistics: the sheet columns stay the design's guess until the accountant reviews them; api-outline: Open items 9 (Excel column layout, accountant); no endpoint change |
| R4 | folded | folded | data-model: Menu `menu_items` (8 photos per item) and Branches `branch_media` (12 per branch), both API-checked; fixed-or-setting is open (finding 14); api-outline: Open items 9; Menu and stock, `/admin/menu-items` row (8 per item, `TOO_MANY`); Branches row (12 per branch, `LIMIT_REACHED`) |
| R5 | — | folded | api-outline: Orders, `GET /admin/orders` row (`customerId`, `branchIds[]`, `source`, `late`, `q` by table label, `from`/`to`, cursor both ways, `estimatedTotal`) |
| R6 | folded | folded | data-model: Personal data lifecycle, new paragraph "Masking and reveals"; whether a reason is required stays open (finding 14); api-outline: Open items 10; Orders, `POST .../reveal-contact` row; Users, `POST /admin/users/{id}/reveal-contact` row |
| V1 | — | folded | api-outline: Reviews and reports, `GET /admin/reviews` row; AdminReview shape |
| V2 | folded | folded | data-model: `reviews` notes: reply delete clears the three columns, CHECK all-null-or-all-set; endpoint is API; api-outline: Reviews and reports, `POST, DELETE .../reply` row (`DELETE` chosen over empty text) |
| V3 | folded | folded | data-model: `reviews.row_version`; Conventions; api-outline: Reviews and reports, `/status` and `/reply` rows (`rowVersion`, `STALE_VERSION`). Column left to data-model |
| V4 | folded | folded | data-model: `reviews` notes and rules list: reply only while `PUBLISHED` (refuse option, proposed); code is API; api-outline: Reviews and reports, `/reply` row; Error catalogue `REVIEW_NOT_PUBLISHED` (409, proposal); Open items 15 |
| V5 | folded | folded | data-model: `reviews` notes: allowed status changes (REMOVED to PUBLISHED proposed, open); api-outline: Reviews and reports, `/status` row (allowed transitions); Open items 15 |
| V6 | — | folded | api-outline: Reviews and reports, `/status` and `/reply` rows (manager and above, STAFF `FORBIDDEN`) |
| V7 | — | folded | api-outline: Reviews and reports, `/status` row (branch `average`, `count` in the result); Realtime `review.status_changed` |
| V8 | folded | folded | data-model: `audit_logs` notes: diff shapes for status change and reply; api-outline: Reviews and reports, `/status` and `/reply` rows (audit diff shapes) |
| V9 | — | folded | api-outline: Realtime, `review.replied` row and `review.status_changed` payload |
| V10 | — | folded | api-outline: Conventions Pagination (366 days, `limit` 20/50/100); Reviews and reports, `GET /admin/reviews` row |
| V11 | folded | folded | data-model: `review_reports` notes: a decision can close the other open reports of the same review; body and result are API; api-outline: Reviews and reports, `/admin/reports/{id}/decision` row (body and result) |
| V12 | — | folded | api-outline: Reviews and reports, `GET /admin/reports` row (params, item shape, `openCount`); chose `page`/`pageSize`/`total` (H5) over cursor, see Conflicts |
| V13 | folded | — | data-model: `review_reports.decision` (chosen over reading it from the audit diff) with CHECK |
| V14 | folded | — | data-model: `review_reports` notes: `IN_REVIEW` kept in the enum, unused; removal open (finding 14) |
| V15 | folded | folded | data-model: `review_reports` notes: update conditioned on `status = 'OPEN'`, no `row_version` (simplest option); api-outline: Reviews and reports, decision row (`409 STALE_VERSION` with who handled it); Error catalogue payloads |
| V16 | folded | — | data-model: `review_reports` notes and Indexes (`(status, created_at)`, `(review_id)`): join to `reviews`; copied `branch_id` listed as alternative |
| V17 | folded | folded | data-model: `review_reports.resolution_note` at most 500 (CHECK); api-outline: Reviews and reports, decision row (note 1 to 500); Field-level codes (`TOO_LONG`) |
| V18 | folded | folded | data-model: `audit_logs` notes: `report.decision` and its diff; entity type is open (finding 14); api-outline: Reviews and reports, decision row; Audit actions list (`report.decision`) |
| V19 | — | folded | api-outline: Realtime, `report.created`/`report.resolved` row (payload) |
| V20 | folded | folded | data-model: `review_reports` notes and rules list: report only on a `PUBLISHED` review (the frame's proposal); code is API; api-outline: Public/customer `POST /reports` row; Error catalogue `REVIEW_NOT_PUBLISHED`; Open items 15 |
| V21 | — | folded | api-outline: Reviews and reports, `GET, POST /admin/reports` row (manager and above) |
| V22 | not folded | not folded | data-model: Vietnamese labels for report reasons and statuses are UI wording; api-outline: New labels for frame 00 (report reasons and statuses); UI wording |
| V23 | not folded | not folded | data-model: Sample-data/frame alignment issue in W09A; no schema effect; api-outline: Mismatch between mock-up boards (sample counts); design clean-up, no API effect |
| Z1 | — | folded | api-outline: Staff session, `/admin/meta/config` row; Response shapes AdminMetaConfig |
| Z2 | — | folded | api-outline: Staff session, `/admin/meta/config` row (`permissions[]`); Open items 26 (final key list) |
| Z3 | folded | folded | data-model: `app_settings.feature_flags` keys; api-outline: Staff session, `/admin/meta/config` row (`features`); AdminMetaConfig shape; admin `features` only, public `featureFlags` unchanged |
| Z4 | folded | folded | data-model: New Query pattern "Sidebar counts"; endpoint is API; api-outline: Staff session, new row `GET /admin/nav-counts`; NavCounts shape |
| Z5 | — | folded | api-outline: Conventions Branch scoping (`branchIds[]` everywhere) |
| Z6 | not folded | folded | data-model: Selection lives in the URL and `localStorage`; decided not stored on the server; api-outline: Conventions Branch scoping (selection kept in browser, nothing on server) |
| Z7 | — | folded | api-outline: Staff session, `/admin/meta/config` row (refetch after `FORBIDDEN`, rebuild menu, sign out on `user.suspended`/`session.revoked`) |
| Z8 | not folded | not folded | data-model: Design-only labels on the sidebar; api-outline: Design-only labels (`GĐ1`..`Chưa bật`); not shown in the product |
| Z9 | — | folded | api-outline: Authentication, staff transport (single-flight refresh rule) |
| A41 | — | folded | api-outline: `GET /admin/orders` (`createdBy=me`) and the `order.status_changed` row (`createdBy` in the staff copy); `orders.created_by` already in data-model (A2) |
| A42 | folded | — | data-model: `app_settings.ordering` (`ready_unserved_warn_minutes`, `ready_unserved_late_minutes`); api-outline: keys live in the data model |
| A43 | not folded | folded | data-model: no `alerts` table, by decision; api-outline: `GET /admin/orders` row (alerts recomputed from `createdBy=me`; nothing stored) |
| P26 | folded | folded | data-model: `reservations` (`contact_phone_last4`, indexed); api-outline: `GET /admin/reservations` (`q` semantics, range, 8 rows) |
| P27 | folded | folded | data-model: `reservations` edit rule, `audit_logs` (`reservation.edit`, entity `RESERVATION`); api-outline: new `PATCH /admin/reservations/{id}` row, event `reservation.updated` |
| P28 | folded | folded | data-model: `reservations` (`source`, `created_by`, nullable `customer_id`); api-outline: `POST /admin/reservations` row |
