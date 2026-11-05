# ADR-0009: VER.02 becomes the app of the owner's own restaurant business

- **Status:** **Accepted** by the project owner on 2026-10-27. The direction and four scope answers were given first (section "Owner decisions"). The owner then replied "accept all" to the proposals in this ADR, so the following are **Accepted as a batch**: the phasing, the role model, the working assumptions `WA1` to `WA11`, TOTP for `MANAGER` and `ADMIN`, the account-deletion handling (keep order amounts and items, scrub contact data, legal review pending), no push notifications in the first release, and a single server in phase 1 with the safeguards of risk 4. **Not settled by that reply** (the owner gave no information): the restaurant's real name, a number for the recovery expectation (how long an outage or data loss is tolerable), delivery fee and zone values, loyalty rates, the real expected volumes, and the real data. Each accepted row can be reopened on its own.
- **Date:** 2026-10-27
- **Supersedes in part:** [ADR-0002](0002-unified-place-model.md) (single `Place` for third-party venues), [ADR-0008](0008-open-items-resolution.md) #13 to #20 (open-data import, provenance, destinations), and the product framing of every document ("food-venue discovery app").
- **Keeps:** [ADR-0001](0001-tech-stack.md), [ADR-0003](0003-authentication.md) (with the revisit below), [ADR-0004](0004-aws-hosting.md), [ADR-0005](0005-geocoding.md) (reduced), [ADR-0007](0007-realtime-sync.md) (now central), the design tokens and brand.

## Context

Until now VER.02 was a rebuild of VER.01 as a directory of third-party food venues (anyone's restaurant), with staff curating the catalog. The owner's judgement on 2026-10-27: that is not realistic, because no restaurant would hand its listing to a stranger's app and the product has no business purpose. VER.02 should instead be **the app of the owner's own restaurant**, keeping the VER.01 features (browse the places, menu items, favorites, history, reviews, nearby, admin management) and adding what a business needs to operate and sell.

Caveat on the VER.01 mapping below: VER.01 source is not in this workspace. I know its features only from what the existing documents say about it (ADR-0001, ADR-0002, migration plan), not from its code. If the mapping must be exact, the VER.01 path is needed.

## Owner decisions (2026-10-27)

| Topic | Decision |
|---|---|
| Business model | **One brand, several branches.** Keeps the VER.01 shape (restaurant brand → branches). Each branch has its own hours, menu availability and staff. |
| Customer features on mobile | Menu with prices; **pickup and delivery orders**; **table reservation**; **loyalty points, promotions and vouchers**. Plus what VER.01 had (browse, favorites, history, reviews). |
| Payment | **No payment inside the app.** Cash or bank transfer, handled outside the app and confirmed by staff. No payment gateway, no card data. |
| Restaurant operations (admin web) | **Receive and process orders; manage menu and stock; manage tables and reservations; revenue reports.** In addition to catalog and moderation already designed. |

## What this changes

### Product framing

| Before | After |
|---|---|
| Directory of venues from anywhere | One brand with N branches. The app does not discover other restaurants |
| Staff curate third-party catalog | Staff run their own restaurant: menu, orders, tables, promotions |
| Users browse and review | Customers browse, order, reserve, earn points, then review what they actually bought |
| Admin = catalog editor + moderator | Admin web = operations console (orders board first) with catalog, reports and staff management |

### Removed or shrunk (no longer needed)

- **Open-data place import** (ADR-0008 #13 to #19): Overture/OSM import, `place_sources`, `ward_boundaries`, confidence thresholds, the "nguồn mở, chưa xác minh" label and the three mockup edits made for it today. These have no purpose for one restaurant. `docs/data-sources.md` keeps its value only for `provinces` and `wards` (delivery addresses).
- **`destinations`** (already deferred), **`brands` as a catalog table** (one brand: it becomes configuration of the business), bulk **geocoding** (a handful of branch addresses are placed by hand with a pin; the geocoder remains useful for customer delivery addresses, to be decided).
- **Moderating strangers:** reviews are limited to customers with a completed order, so spam-style moderation shrinks. `reports` can be reduced to "report a review"; "report wrong place information" goes away because the owner's own staff maintain the data.
- **VER.01 data migration:** the 289 migrated rows are other people's venues. They are useful only as sample and dev data. The image-rights blocker disappears for the restaurant's own content; it still applies to anything copied from VER.01. The migration plan shrinks to a seed for the owner's real branches and menu, plus optional dev fixtures.
- **Capacity concern** from ADR-0004 (86,000 to 313,000 imported rows) disappears.

### Kept as is

Authentication and tokens, account lifecycle, consent, audit log, export, system email, realtime, design tokens and brand, AWS tiers and the port design, the OpenAPI contract workflow, the scaffold and test strategy documents (with new test areas below).

### Added

1. **Menu:** categories, items (name, description, photo, base price in VND), option groups (size, toppings), per-branch availability and optional stock count, translations (Vietnamese first).
2. **Orders:** cart (kept on the device, validated by the server when the order is placed), order with items snapshot (name and price copied so later price changes do not rewrite history), type `PICKUP` or `DELIVERY`, branch, requested time, notes, delivery address, status flow, status history, cancellation rules, order number.
3. **Delivery:** address book per customer, delivery zones per branch (radius or polygon with PostGIS), delivery fee and minimum order, estimated time. The restaurant delivers with its own staff or a third party outside the app (no shipper tracking in this scope).
4. **Reservations:** tables per branch (name, seats), reservation requests (date, time, party size, contact), statuses (`PENDING`, `CONFIRMED`, `DECLINED`, `CANCELLED`, `SEATED`, `NO_SHOW`), opening hours and capacity rules.
5. **Loyalty and promotions:** points earned on completed orders (append-only ledger, never an editable balance), redemption, vouchers (code, percentage or fixed amount, minimum order, validity, usage limits, per-customer limit), promotion banners.
6. **Revenue reports** (admin): revenue per day, branch, item and order type, best sellers, order counts, cancellations. Reads orders; no new source of truth.
7. **Staff operations console:** live orders board with sound or badge, order detail with status actions, reservation calendar, menu and stock screens, voucher and points screens.
8. **Staff roles scoped by branch** (below).

### Role model (proposal)

| Role | Can |
|---|---|
| `CUSTOMER` (today's `USER`) | Order, reserve, earn points, review own purchases |
| `STAFF` | At their branch(es): process orders and reservations, mark items sold out |
| `MANAGER` | Staff rights plus menu, hours, delivery zones, vouchers and reports for their branch(es) |
| `ADMIN` (owner) | Everything, including staff accounts, all branches, brand settings, exports |

Authorization becomes branch-scoped: a user's staff roles are attached to branches (a `staff_branches` link), and every order, reservation and report query is filtered by the branches the caller may see. The server enforces it, as before.

### Data model sketch (proposal, not yet in data-model.md)

`branches` (replaces `places`: address, location, hours, `accepts_pickup`, `accepts_delivery`, `accepts_reservations`), `menu_categories`, `menu_items` and translations, `option_groups` and `options`, `branch_menu_items` (availability, price override, stock), `orders`, `order_items` (snapshot), `order_item_options`, `order_status_events`, `customer_addresses`, `delivery_zones`, `restaurant_tables`, `reservations`, `vouchers`, `voucher_redemptions`, `loyalty_ledger`, `staff_branches`; existing `reviews` gain `order_id`/`order_item_id` and a "verified purchase" meaning; existing `favorites` can target branches and menu items; `view_history` can be kept or dropped (open question). Money stays integer VND. Orders and ledger rows are append-only in spirit: corrections are new rows or status events, never edits.

## Risks and conflicts this introduces

1. **The staff MFA exception in ADR-0003 must be revisited.** ADR-0003 accepted "no MFA for staff and admin" and wrote: "Revisit this if staff accounts grow or the app starts holding data beyond the public catalog." That condition is now met: the system holds customers' names, phone numbers, delivery addresses and order history, and staff handle them daily. This is a blocking design question, not a nice-to-have. Options: TOTP for `MANAGER` and `ADMIN` (proposed minimum), or keep the exception and record the new accepted risk explicitly.
2. **Account deletion versus order and tax records.** The deletion design anonymises a user but keeps reviews. Orders are business and possibly tax records that may have to be kept for a legal period. What may be scrubbed (name, phone, address) and what must stay (amounts, dates, items) needs a legal and accounting answer. I did not research Vietnamese retention or e-invoice rules, so I cannot say what applies to a restaurant of this size.
3. **Order notifications.** ADR-0007 has realtime only while the app is open and push notifications out of scope. A customer waiting for "your order is ready" and staff hearing about a new order both need more than that. Staff can use the web console with a live board; for customers the options are push notifications (a new dependency, a consent question) or accepting that status shows only when the app is open. Needs an owner decision.
4. **Availability and loss of orders.** ADR-0004 accepted a single EC2 instance with no Multi-AZ. For a development demo that was fine; for a restaurant taking real orders, an outage during lunch costs money. It remains acceptable only if the owner says so, with a stated recovery expectation. A restore-tested backup becomes mandatory, and "orders must never be silently lost" becomes a requirement (idempotent order creation, an order is saved before anything else happens).
5. **Order correctness is new risk:** double submission, price changing between cart and submit, an item that sold out, a branch that closed. Needs server-side validation, idempotency keys, and tests (testing-strategy gets a new "orders" area).
6. **Vouchers and points are abuse targets:** race conditions on redemption, code guessing, per-customer limits, double earning. Needs transactional redemption and rate limiting.
7. **Cash and transfer reconcile by hand:** with no payment in the app, "paid" is a staff action. Revenue reports are only as honest as that process. A transfer confirmation workflow and an audit trail are needed.
8. **Tax and invoices:** answered by the owner on 2026-10-28 (`WA17`): small family household business, printed receipt only, Excel statistics for the books, no e-invoice. The risk that remains is the revenue threshold: sources say a household above 1 billion VND a year must use e-invoices (Decree 254/2026/ND-CP) and that thresholds changed in 2026. The accountant confirms the position, and the Excel report shows year-to-date revenue so the owner can watch it.
9. **Product name:** "Kitchen Daylight" was chosen for a generic app. If the app is the owner's restaurant, the restaurant's real name and brand may replace it. The trademark question is still open.
10. **Customer data scope grows** (phone, addresses). The data-minimisation rules and retention periods must be extended; the legal review item in earlier ADRs gets bigger.

## Proposed phasing (for the owner to confirm; all four feature areas are in scope, only the order is open)

| Phase | Content | Why first |
|---|---|---|
| 1 | Branches and hours; menu with options and availability; pickup and delivery orders (no payment); staff orders board with realtime; order history; accounts and consent; reviews after a completed order | The minimum that lets the restaurant sell. Everything else depends on orders |
| 2 | Table reservations and the tables screen; vouchers and promotions; loyalty points | Both build on customers and orders |
| 3 | Revenue reports and exports of orders; refinements | Needs a body of real orders to be useful |

If the owner wants revenue reports earlier (for example to demonstrate the project), a small daily-revenue view can move into phase 1 because it only reads orders.

## Impact on the documents (status 2026-10-27, updated 2026-10-28)

**2026-10-28:** the data model was reviewed against the restaurant use case and revised (see its top note). The owner then decided: keep refunds and "completed needs paid" (`WA12`), **no e-invoice: printed receipt and Excel statistics** (`WA17`), the business day has a cutoff (`WA14`), stock at placement (`WA15`), `ordering` defaults accepted (`WA16`). `data-model.md`, `api-outline.md`, `testing-strategy.md`, `scaffold-plan.md` and the two design rework files in `docs/tmp` follow these.

**Done:** [data-model.md](../data-model.md) v5, [api-outline.md](../api-outline.md) v3, [migration-plan.md](../migration-plan.md) (now a data plan), the status notes on ADR-0001 to ADR-0008, [scaffold-plan.md](../scaffold-plan.md), [testing-strategy.md](../testing-strategy.md), the docs README, and a "superseded in part" banner on the UI documents and the two design briefs. **Not done:** the UI flows and wireframes in `docs/ui/mobile.md` and `admin.md`, and the HTML frames in `designs/` (new frames are needed for menu, cart, checkout, orders, reservations, vouchers and the staff orders board). The table below is the original impact list.

| Document | Change needed |
|---|---|
| `README.md`, `ui/README.md` | Product framing, screen inventory (new screens below) |
| `data-model.md` (v4) | v5: replace catalog tables as sketched; drop import tables; add orders, menu, reservations, loyalty, roles; revisit retention and deletion |
| `api-outline.md` (v2) | v3: new endpoint groups (menu, orders, addresses, reservations, vouchers, points, reports); branch-scoped authorization; new error codes (`BRANCH_CLOSED`, `ITEM_UNAVAILABLE`, `PRICE_CHANGED`, `VOUCHER_INVALID`, and so on) |
| `migration-plan.md` (v3) | Shrink to seed of the owner's branches and menu plus dev fixtures |
| `data-sources.md` | Mostly obsolete; keep the administrative-unit part |
| ADR-0002, ADR-0005, ADR-0008 | Mark parts superseded; ADR-0003 gets the MFA decision and the deletion rules |
| `designs/mobile` | Home becomes the restaurant's home (menu highlights, branch picker, promotions); new frames: menu, item with options, cart, checkout, order tracking, my orders, reservation, vouchers and points. The "nearby" map becomes "find a branch" |
| `designs/web` | Orders board, order detail, menu and stock, tables and reservations, vouchers and points, branch settings, revenue reports. Existing frames for places, brands, catalog and moderation shrink |
| `scaffold-plan.md`, `testing-strategy.md` | New modules (menu, orders, delivery, reservations, loyalty, reports) and new must-have tests (order validation, idempotency, branch scoping, voucher and points races) |

New or changed screens, as a first inventory: **mobile** (branch picker, menu, item detail with options, cart, checkout with delivery or pickup, order tracking, order history, reservation form and list, vouchers, points); **admin** (live orders board, order detail, menu and stock, tables and reservations calendar, vouchers and loyalty setup, branch settings, revenue reports).

## Working assumptions (accepted as a batch, 2026-10-27)

The owner confirmed the four scope answers and said VER.01 does not need to be mapped exactly ("V2 is basically a rebuild"; this answers question 9 below). The other questions were not answered individually; the owner accepted these defaults as a batch. Each can be changed independently; the documents mark them as `WA#`.

| # | Assumption | Question it stands in for |
|---|---|---|
| WA1 | The working name stays **Kitchen Daylight**; the real restaurant name goes in `app_settings.brand` and replaces it everywhere once chosen | 1 |
| WA2 | Delivery is done by the restaurant's own staff. Each branch defines concentric zones by straight-line distance with a fee, a minimum order and an ETA; pickup-only is the same app with delivery turned off | 2 |
| WA3 | In the first release customers see order and reservation status **in the app only** (realtime while open, refetch on resume); no push, no SMS, no order emails. Push is a separate decision (a new dependency and a consent question) | 3 |
| WA4 | **TOTP for `MANAGER` and `ADMIN` is required** (accepted 2026-10-27). `mfa_credentials` is built with the staff auth slice; `STAFF` stay on password. Lost-device recovery: see `WA20` | 4 |
| WA5 | Scale: at most about 5 branches, 30 staff and 300 orders a day; a single server remains acceptable if the owner accepts a stated recovery expectation | 5 |
| WA6 | Reviews: one per completed order, with a public owner reply; no item-level ratings | 6 |
| WA7 | Loyalty: points earned per VND spent and redeemable as a VND discount, both rates in settings; vouchers are public codes or assigned to customers; one voucher per order that never covers the delivery fee | 7 |
| WA8 | Reservations are free, no deposit (a deposit means payment, which is out of scope) | 8 |
| WA9 | VER.01 is not mapped. The VER.01 pipeline and the open-data import are dropped; the data plan is a seed of the owner's real data | 9 |
| WA10 | An account with a verified email is needed to order; a phone number is required at the first order and is not verified in the first release. Staff-entered phone orders are phase 2 | not asked |
| WA11 | `view_history` is dropped (data minimisation); "order again" replaces it. Favorites are dishes | not asked |
| WA12 | A cancelled or rejected order that was already paid is marked `REFUNDED` by staff after they return the money by hand; an order can be `COMPLETED` only when `PAID` (staff confirm the money in the same action). Stock restores automatically only when the order is cancelled before `PREPARING` (accepted 2026-10-28) | review |
| WA13 | ~~VAT invoices are required.~~ **Superseded by `WA17`** (owner, 2026-10-28, after the model had briefly included invoices) | superseded |
| WA14 | The business day has a cutoff hour (`app_settings.reports.business_day_starts_at`, proposed default `04:00`); revenue reports group by `orders.business_date` | review |
| WA15 | Stock is taken when an order is placed (so two customers cannot take the last portion); abuse is limited by rate limiting, the phone check and the reject action | review |
| WA16 | The proposed `app_settings.ordering` values are the defaults: board lateness thresholds 5/10 minutes to accept and 15/25 to finish, refetch every 15 seconds, call hint after 10 minutes, auto-cancel of unconfirmed orders off. The owner can change them in Settings | review |
| WA17 | **No e-invoice.** The business is a small family household business: a **printed receipt** per order is enough, daily summary invoices are rejected because they make the books hard to check, and the owner gives the accountant **statistical reports exported to Excel** (`REVENUE` export: by day, by item, order detail, cancellations and refunds, year to date). Tax follows the general formula outside the app; the app holds no tax rates. **Condition:** secondary sources say a household above 1 billion VND a year must use e-invoices (Decree 254/2026/ND-CP) and the thresholds changed in 2026; the position holds only below the threshold that applies, and the accountant confirms it. Adding e-invoices later is an `InvoicePort` and two tables, not a redesign | owner decision, accountant to confirm the condition |
| WA18 | ~~Tax configuration (method, groups, dated schedules).~~ **Withdrawn** with `WA17`: no tax settings, no `tax_group` on items | withdrawn |
| WA19 | ~~Invoices kept 10 years.~~ **Withdrawn** with `WA17`; the retention of orders and receipts stays an open item | withdrawn |
| WA20 | **Owner MFA recovery:** recovery codes on paper; at least two active admins with MFA; an admin can reset another user's MFA (audited, notice email, never self); last resort is an engineer-run server task after in-person identity proof; no email or SMS bypass | proposal |
| WA21 | ~~E-invoice provider criteria.~~ **Withdrawn** with `WA17`. If e-invoices become mandatory later, choose a provider then (a public API with a sandbox, valid for a household business, annual price, data export, and the provider the accountant already uses) | withdrawn |
| WA22 | **E-invoices are designed now and deferred.** Current revenue is below the threshold that applies to a household business (owner, 2026-10-28). The `InvoicePort` interface, the `manual` and `fixture` adapters, the tables `order_invoices` and `summary_invoices`, their endpoints and tests are specified in the data model, API outline, scaffold plan and testing strategy under "deferred", but not built or shown in phase 1. Enabling them is a feature flag, a migration, the `tax` settings and one provider adapter. Provider choice is made then (criteria: valid for a household business, public API with a sandbox, annual price, data export, and the provider the accountant already uses). The default invoice mode when enabled is `PER_ORDER`; `DAILY_SUMMARY` stays an option for the accountant | owner decision |

## Open questions for the owner

1. Restaurant name and brand: keep "Kitchen Daylight" or use the real name?
2. Delivery: own staff, third party, or pickup only at first? Delivery zones by radius or by drawn area? Is there a fee and a minimum order?
3. Order notifications to customers: push notifications (and the consent and dependency that brings), or in-app only?
4. Staff MFA: TOTP for `MANAGER` and `ADMIN`, or keep the exception with the new risk written down?
5. How many branches, how many staff and how many orders per day do you expect? This sets whether a single server is acceptable.
6. Reviews: only after a completed order (proposed), and may a customer review the restaurant as well as a dish?
7. Loyalty: how are points earned and spent (a rate per VND, redeem as a discount or free items)? Do vouchers come as public codes or are they issued to customers?
8. Reservations: free booking or a deposit? A deposit means payment, which was ruled out.
9. ~~Does VER.01's source need to be re-read for the mapping?~~ **Answered 2026-10-27: no, V2 is a rebuild.** Still open: whether any VER.01 text or photo is the restaurant's own and reusable.
10. Order of phases (above), and whether a revenue view should come in phase 1.
