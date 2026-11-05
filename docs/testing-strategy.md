# Testing strategy

Status: **draft for review** (2026-10-27, revised for [ADR-0009](adr/0009-owner-business-pivot.md): restaurant business app). Expands the one-line testing row of [ADR-0001](adr/0001-tech-stack.md) (Jest or Vitest for unit tests, Playwright for admin end-to-end, Maestro for mobile end-to-end). Applies to the API, the admin web, the mobile app and the tools. No test code exists yet.

## Working rules

1. **The owner runs tests.** Test runs, especially end-to-end, can spike CPU and RAM on the owner's machine. Implementers write the tests and the commands, the owner runs them and pastes the output, and failures are diagnosed from that output. No script in the repo launches the full suite implicitly.
2. **CI runs everything** on GitHub's runners ([scaffold-plan.md](scaffold-plan.md) section 8); that does not use the owner's machine.
3. **Throttle by default.** Runner commands in `package.json` use limited workers (for example a worker cap for the unit runner and `--concurrency=2` for Turborepo) and never default to watch mode.
4. **Tests ship with the slice** they cover (scaffold plan, section 9), not afterwards.
5. **Honest reporting:** a slice is done when its exit criteria hold and the owner's run output shows it, not when the code compiles.

## Levels

| Level | Tool | Scope | Where |
|---|---|---|---|
| Unit | Jest or Vitest (one runner for the repo, chosen at scaffolding) | Pure logic: parsers, mappers, guards' decision logic, the open-now calculation, rating arithmetic, code hashing | Next to the code |
| API integration | Same runner + a real PostgreSQL with PostGIS in a container | Controllers through HTTP, real SQL, real constraints; the ports bound to fakes | `apps/api` |
| Contract | `openapi:check` | The OpenAPI snapshot is unchanged or the change is intentional and non-breaking | CI |
| Admin end-to-end | Playwright | Critical admin flows against `dev` services | `apps/admin` |
| Mobile end-to-end | Maestro | Critical user flows on a `demo` build (ADR-0004) | `apps/mobile` |
| Accessibility | Manual pass on real devices and the Angular build, plus automated checks in Playwright | The unverified claims in both design briefs | Slice 8 |

Database-specific behaviour (constraints, partial indexes, `geography` queries, the immutable `unaccent` wrapper) is tested against a real PostgreSQL, never against an in-memory substitute.

## Must-have API tests, by area

Auth and sessions (ADR-0003, ADR-0008 #1, #6):
- Refresh rotation; reuse of a used token revokes the family; re-presentation within the 10-second grace window returns the same successor; concurrent refresh does not revoke.
- Expired and revoked access tokens; role change visible after the access-token TTL; sensitive admin endpoints re-read the role.
- Account takeover cases: social sign-in links only on (`provider`, `subject`); auto-link only when both emails are verified.
- 6-digit code: correct code succeeds once; wrong code increments `attempts`; the code is dead after 5 attempts; expired code; issuing a new code expires the old one; generic responses for unknown emails; per-account and per-IP throttling; the "another email" path.
- Staff invitation (48 hours) and reset link (30 minutes): single use, hashed, expiry, session revocation on reset; staff password length 12.
- Lockout and the identical response for unknown email, wrong password and locked account.
- Deny by default: every route without `@Public()` returns 401 without a token (generated from the route list).

Authorization and ownership:
- A user cannot read or change another user's favorites, history, reviews, sessions or reports; the acting user always comes from the token.
- `STAFF` cannot do `ADMIN` actions; `SELF_CHANGE` and `LAST_ADMIN` guards.

Branches, menu and search:
- A branch offers only the items that have a `branch_menu_items` row; effective price is the override or the base price; an inactive item or option never appears.
- Making an item active needs a Vietnamese name and a cover photo; a price change and an availability change are audited.
- Diacritic-insensitive menu search ("bo" finds "bò"); tag filters; dietary and allergen claims are labelled unverified until `verified_at` is set.
- Open-now for a branch: periods crossing midnight, the previous day's session, special hours overriding weekly periods, `DELIVERY` hours falling back to `STORE`.
- `rowVersion`: a stale `PATCH` returns `409 STALE_VERSION`; an explicit overwrite is audited.
- Hours, zone, table and `CHECK` constraints (opening-period shape, option group min and max, E.164 phones, `names ? 'vi'`).

Reviews and reports:
- Only the customer of a `COMPLETED` order can review it, once (`ORDER_NOT_REVIEWABLE`, `REVIEW_EXISTS`); branch counters change in the same transaction; the nightly reconcile repairs a manual drift.
- Hidden or removed reviews stay readable in `GET /me/reviews`, are not editable and are absent from public lists; an owner reply is public and audited.
- `review_reports`: duplicate open report returns `DUPLICATE_REPORT`; details length 500.
- `audit_logs` is append-only for the application role.

Realtime and operations:
- Every write path that clients should see writes its outbox event in the same transaction (a test enumerates the write paths and the event table of api-outline).
- Guests receive only public events; a user receives only their own `user.suspended`; no event carries personal data or record content.
- Export respects the active filters, caps rows, requires a `reason` for `USERS`/`AUDIT_LOGS` and writes an audit row; expired files are purged.
- Email log never contains a code, token or link; bounce and complaint callbacks update status and suppression.
- Production guard: the API refuses to boot with `APP_ENV=prod` and an emulator or fixture adapter.

## Must-have tests for the restaurant business (ADR-0009)

Orders are money; these are the tests that matter most.

Order creation and validation:
- Server recomputes every price from the database; a client-sent total that differs returns `PRICE_CHANGED` with a fresh quote and creates nothing.
- Closed branch, past the order cutoff, a service that is off, outside delivery hours: `BRANCH_CLOSED`.
- Unavailable item or stock below the requested quantity: `ITEM_UNAVAILABLE` and nothing is decremented; two customers ordering the last item at once (race): exactly one succeeds, stock never goes negative.
- Option rules (min and max per group, inactive options): `OPTION_INVALID`.
- Delivery: address inside the smallest matching ring, fee and minimum from that ring, `OUT_OF_ZONE`, `BELOW_MIN_ORDER`, free-over rule.
- **Idempotency:** the same `Idempotency-Key` returns the same order; a retry after a timeout never creates a second order or a second stock decrement.
- Order and its first status event, outbox event, ledger and redemption rows are written in one transaction; a failure midway leaves nothing behind.
- Snapshots: after changing a menu item's name or price, an old order still shows the old values.

Status machine and branch scoping:
- Every allowed transition succeeds for the right actor; every other transition returns `INVALID_TRANSITION`; final states cannot change.
- Two staff acting on the same order: the second gets `STALE_VERSION`.
- Cancel and reject before `PREPARING` restore stock, reverse the voucher and reverse points, exactly once; a cancel from `PREPARING` onward restores stock only when staff choose to, and still reverses the voucher and points.
- `COMPLETED` needs `PAID`: completing an unpaid order without `confirmPayment` returns `PAYMENT_NOT_CONFIRMED`; completing with it confirms payment in the same transaction; `REFUNDED` is accepted only on a cancelled or rejected paid order.
- Order arithmetic: `discount_total = voucher_discount + points_discount`, `total = subtotal - discount_total + delivery_fee`, `subtotal` equals the sum of line totals; points are earned only on completion and on the subtotal after the voucher.
- `order_number` is `{branch code}-{yyMMdd}-{seq}` by Vietnam date; two orders placed at once in one branch never share a number; the sequence restarts each day.
- **Receipt:** the receipt data equals the order snapshots (a later price or menu edit does not change a reprint); a delivery receipt writes the contact-reveal audit row, a pickup receipt shows only the first name; a user of another branch gets `404`.
- **Statistics export (`REVENUE`):** only `COMPLETED` orders count; cancelled and rejected orders appear only in the cancellation sheet; the daily total equals the sum of the order rows; cash plus transfer equals the total; `business_date` follows the cutoff (an order at 00:30 with a 04:00 cutoff lands on the previous day); refunds are listed, not netted; a `MANAGER` gets only their branches; contact columns are masked by default; the year-to-date sheet matches the sum of the daily sheet; the file opens with Vietnamese text intact.
- **MFA recovery:** a recovery code works once; an `ADMIN` can reset another user's MFA but not their own (`SELF_CHANGE`); a reset deletes the credential, revokes sessions, writes the audit row and queues the notice; the last-admin guard still holds; resetting a `STAFF` user (no MFA) is a no-op with a clear error.
- **Business day:** with a `04:00` cutoff an order completed at 00:30 gets the previous `business_date`, one completed at 04:30 the same day; changing the cutoff does not change existing orders.
- Delivery orders need a courier name to go `OUT_FOR_DELIVERY`; pickup orders reject courier fields.
- Customer cancel works only while `PLACED`; then `ORDER_NOT_CANCELLABLE`. Staff cancel works from every non-final status and needs a reason.
- **Pause switch:** a `STAFF` user can flip a branch only between `ACTIVE` and `TEMPORARILY_CLOSED` (not `CLOSED`), the change is audited and emits `branch.updated`, new orders get `BRANCH_CLOSED`, orders in progress continue.
- **Scheduled orders:** `requested_for` must be inside opening hours and between the lead time and the horizon of `ordering`; otherwise `BRANCH_CLOSED` or `VALIDATION_FAILED`. `free_over` and `min_order` compare with the subtotal before discounts. A delivery address without a pin is rejected; `delivery_note` is copied from the address and null for pickup.
- **Auto-cancel job** (when enabled): a `PLACED` order older than the limit becomes `CANCELLED` by `SYSTEM` with stock, voucher and points reversed once and an event sent; with the setting off it never runs.
- **Reconciliation jobs:** a drift between `stock_qty` and the sum of `stock_movements`, between `loyalty_accounts` and the ledger, or in the branch rating counters is detected and repaired or reported; running a job twice changes nothing.
- **Reviews:** hiding or removing a review updates the branch counters in the same transaction; a review outside `review_window_days` returns `ORDER_NOT_REVIEWABLE`.
- **Staff accounts:** an `INVITED` user cannot sign in; resending an invitation expires the old link; a `SUSPENDED` user's sessions end; `STAFF` and `MANAGER` need a `staff_branches` row.
- **Branch scoping, enumerated:** for every staff and manager endpoint, a user of branch A gets `404` for branch B's orders, reservations, stock, reports and exports; `ADMIN` sees all; customers see only their own. The test is generated from the route list so a new endpoint cannot skip it.
- Staff cannot read customer contact details without an audit row; lists and exports mask phone and address by default.

Vouchers, points and loyalty (phase 2):
- Per-customer and total usage limits under concurrent orders; a reversed redemption frees a use.
- Points cannot go negative; an order cannot earn or redeem twice (unique ledger rows); cancel reverses; manual adjustment needs a note and writes an audit row.
- Code guessing is throttled and every failure returns the same `VOUCHER_INVALID`.

Reservations (phase 2):
- Slot capacity from tables and existing confirmed reservations; the last slot booked by two customers at once: one wins (`SLOT_UNAVAILABLE`); a confirmation re-checks capacity; hours, lead time and horizon limits.

Reports (charts, phase 3; the Excel export is tested above):
- Revenue counts only `COMPLETED` orders; cancelled and rejected are excluded; the day is `orders.business_date`, so the cutoff hour decides which day an order at 00:30 falls on; a manager sees only their branches.

Deletion and privacy:
- `DELETE /me` is refused with an active order or an upcoming reservation (`HAS_ACTIVE_ORDERS`); otherwise amounts and items stay, contact fields are scrubbed as the data model says, and the result is one transaction.

Realtime for the board:
- A new order reaches only the staff of its branch within the latency target; a reconnecting board refetches and shows an order missed while offline.

## Deferred tests: e-invoices (written when the feature is enabled)

A named invoice exists only when buyer details were given (mode `ON_REQUEST`) or one per completed order (`PER_ORDER`); with `DAILY_SUMMARY` each completed order is covered by exactly one summary of its branch and `business_date` (`orders.summary_invoice_id` set, `order_count` and `total` equal the covered orders, cancelled and rejected orders excluded, an order on its own invoice is never also in a summary, an order completed after the cutoff falls into the next day); cancelling or rejecting turns a `PENDING` invoice into `CANCELLED`; an invoice can be issued only for a `COMPLETED` order and only once (idempotent by the invoice id, a repeated call returns the same result); the `InvoicePort` contract is tested against the `fixture` adapter and the same cases against each provider's sandbox; a provider refusal sets `FAILED` and a retry works; a company without a valid tax code returns `INVOICE_INFO_INVALID`; a `STAFF` user cannot issue; branch scoping applies; an issued invoice cannot be edited, only cancelled or replaced; account deletion keeps invoices intact; the production guard refuses the `fixture` adapter.

## Tools and data

- **Local and end-to-end stack:** the services come from the Docker repository (`compose.yaml` for dependencies, `compose.test.yaml` for a clean database on every end-to-end run, seeded with the synthetic data of the data plan). The owner runs it and shares the output; CI runs it on GitHub's runners.
- **`seed`:** the validators of `seed business` (integer VND prices, hours shape, E.164 phones, Vietnamese name required, option group rules) with good and bad input files; the `verify` acceptance checks of the data plan; idempotency (a second run changes nothing); `seed demo` refuses to run with `APP_ENV=prod`. (The VER.01 migration and the open-data import tools were dropped, ADR-0009.)
- **Seed:** the `provinces`/`wards` loader is re-runnable and updates in place (the official service already changed 25 units under unchanged codes).

## Admin end-to-end (Playwright), first set

Sign-in and refresh; create a branch and place its pin; build a menu item with options and make it available at a branch; a new customer order appears on the live board and is taken through accepted, preparing, ready and completed; a stale transition shows the conflict message; mark an item sold out; create staff with a branch and set the password from the invitation link; a branch-A user cannot see branch B's order; export respects filters.

## Mobile end-to-end (Maestro), first set

Browse branches and the menu as a guest; adding to the cart is allowed, checkout sends a guest to sign-in and returns; register with consent unticked (button disabled) then ticked; verify email with a code; add a phone number; place a pickup order and a delivery order; see status change when staff move the order; cancel while `PLACED`; order again; review a completed order; location denied shows the branch list without distance; delete the account (refused while an order is active); forced-update and maintenance screens from `/meta/config`; an item marked sold out on the web is unavailable on the device (realtime).

## Not covered yet

Load and performance tests (traffic is unknown, ADR-0001 open item 1); a lunch-rush burst (orders per minute, board refresh, realtime fan-out) should be measured on `demo` against the single instance (ADR-0004, ADR-0009 risk 4); security testing beyond the cases above (dependency audit in CI is proposed, not designed); visual regression; device matrix for mobile.
