# Kitchen Daylight admin web: design brief (VER.02, the owner's restaurant console)

Status: **draft for review** (2026-10-30; first written 2026-10-29, re-run on 2026-10-30 after phases 2 and 3 and the deferred e-invoice frame were drawn). This brief describes the **31 frames** of [mockups/](mockups/index.html) that were drawn or reworked for [ADR-0009](../../docs/adr/0009-owner-business-pivot.md): the operations console of the owner's own restaurant (a live orders board first, then menu and stock, branches, reviews, staff, Excel statistics for the books, and later reservations, vouchers and charts). It follows the tokens and style in [docs/ui/style-direction.md](../../docs/ui/style-direction.md), the schema in [docs/data-model.md](../../docs/data-model.md) (v5, revised 2026-10-28) and the API in [docs/api-outline.md](../../docs/api-outline.md) (v3). The mobile frames are separate ([designs/mobile](../mobile/brief.md)).

The first version of this brief described a catalog editor of other businesses' listings. That version and its 21 frames were archived on 2026-10-28 (W00) in [designs/archive/directory-version/](../archive/directory-version/) (`web-brief.md`, `web/mockups/`). Nothing in this brief refers to them except where a row says so.

The folder is self-contained so it can be copied into the code repository:

```
designs/web/
  brief.md                this file
  mockups/
    index.html            frame index (open this first)
    00 ... 30-*.html      one page per screen (static HTML, no server or build)
    admin.css             shared components
    tokens.css            copy of docs/ui/tokens/tokens.css (do not edit here)
```

Open `mockups/index.html` in any current browser. Every page has a "Sáng / tối" switch (the tokens carry both modes). Page text, captions and the `Dữ liệu` tables at the bottom of each frame are Vietnamese, as in the rest of the interface; identifiers (`data-bind` values, tables, columns, endpoints, error codes) stay English; this brief is English, as in the rest of `docs/`. The logo files are in `designs/brand/`.

The 19 files of the old directory version that used to sit in `mockups/` next to the new frames were moved (not deleted) on 2026-10-30, with the owner's confirmation, to [designs/archive/directory-version/web/replaced/](../archive/directory-version/web/replaced/); byte-identical copies of them are also in `../archive/directory-version/web/mockups/`.

## How to read a frame

- **Boards.** A frame holds one board per screen, dialog, variant or state, each with a one-sentence Vietnamese caption. The main board shows the screen inside the app shell; the others show dialogs, states (loading, empty, error, validation, read-only), role variants and the 1024 px layout.
- **`data-bind`.** Key elements carry a `data-bind` attribute naming the table and column (or endpoint) they read or write, for example `orders.table_label`. A value ending in `(khoảng trống)` means the column or endpoint **does not exist yet** in data model v5 or API v3: the frame draws the closest honest version and the gap is in the table "API and data gaps found" below. It is documentation for implementers, not behaviour.
- **`Dữ liệu` table** at the bottom of each frame: UI element, `table.column` or endpoint, rule (constraint, derivation, who may do it). Every table has a `Quyền` row (who sees or does this) and an `Lỗi` row (error codes and the board where each is drawn). Each frame also ends with its own gap table ("Khoảng trống của mô hình dữ liệu và API"); this brief collects them all.
- **Sample data** comes from `docs/tmp/web-design/02-sample-data.md` (fictional: Kitchen Daylight, branches `BT` Bến Thành and `COL` Cầu Ông Lãnh, 7 staff, 11 active orders at **12:05:41 on 27/10/2026**). Where a frame needed more people, orders or numbers, it extends the same pattern and the invented data is listed per frame in "Sample data added by the frames". Food photos are placeholders and maps are drawings, not a map library.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Visual language | Calm and dense. Ocean-blue buttons, teal for open / verified / success, violet for warnings, red only for errors and destructive actions. No glass, no heavy motion. Product name **Kitchen Daylight** (working name, `WA1`), "KD" monogram in [../brand/](../brand/) | style-direction.md, "Admin web style" |
| Tokens | Used as-is from `tokens.css` (read only); admin type scale (14 px base, 24 / 20 / 16 headings). New components live in `admin.css` under `/* Operations components, 2026-10-28 */`, tokens only | One source for admin and mobile |
| Layout | Sidebar 248 px, top bar 56 px, content padding 24 px. Below 1100 px the sidebar becomes a 72 px icon rail. **Touch screens:** the orders board, the availability screen and the counter-order screen are tablet screens (landscape, 1024 to 1366 px) with **targets of at least 48 px**; frame 30 is drawn at **phone width (360 to 430 px)** with its own shell (top bar, bottom tab bar). Every other frame is desktop and tablet with controls of at least 36 px | Tablet at the counter and in the kitchen, phone at the table (2026-10-28) |
| Roles | `STAFF`, `MANAGER`, `ADMIN` with branch scoping. One shell; a control a role cannot use is **not rendered** (not greyed), except one that is allowed in general but blocked by state, which is greyed with its reason (`Chưa chọn chi nhánh`, `Món đã hết`). A **page** a role cannot use shows `Bạn không có quyền xem trang này`; a record **outside the user's branches** shows `Không tìm thấy` (API `404`, nothing leaks). The server stays the authority | ADR-0003, ADR-0009 |
| Second factor | TOTP is required to sign in as `MANAGER` or `ADMIN`; `STAFF` use a password only. Lost-device recovery is **proposed** (`WA20`): ten recovery codes on paper, at least two active admins with MFA, an admin can reset another user's MFA (audited, notice email `MFA_RESET_NOTICE`, never on oneself), an engineer-run task as the last resort, no email or SMS bypass | ADR-0009 risk 1 |
| Revenue | Hidden from `STAFF`, not only the export: dashboard revenue, the 7-day table, any sum over orders, the statistics page and every export are for `MANAGER` and `ADMIN`. `STAFF` still see each order's own total and payment state because they collect the money | Accepted 2026-10-28 |
| Customer data | Masked by default in lists, tickets and exports (`0901 *** 567`, `h***@example.com`, street hidden). Revealing writes an `audit_logs` row and the screen says `Đã ghi nhật ký`. Whether a reason is required is open | Privacy; ADR-0008 #34 |
| Order status | **No optimistic UI** for status changes, cancel, refund or pause: the card moves only after the server answers. A `409 STALE_VERSION` reloads the order and says who just did it (neutral wording, not an error) | Two people work the same board |
| Board | **First in, first out:** every column is sorted oldest first; a new order appears at the **bottom** of `Mới` with a static ring, a toast, a sound and a `Có N đơn mới ↓` button when it is off-screen. The board's "now" is 12:05:41 (lunch rush). Time in status comes from the status events | API returns the oldest first; the earlier draft said "top" |
| Lists | `page` and `pageSize` (default 20, max 50) in the URL for lists with a total; **cursor paging, a mandatory date range and an estimated count** for lists that grow without bound (orders, audit log, reviews); filters survive an error; active filters are removable chips; sticky header and pager | Frame 18 |
| Realtime | "Signal, then fetch": events trigger a refetch, the board also refetches every 15 s while open and when the tab returns; the connection dot reads `Đang kết nối`, `Đang thử lại`, `Mất kết nối` (no data for 30 s) with `Cập nhật lúc` = last data received; lists never reorder under the reader (a `Tải lại danh sách` bar) | Frame 19, ADR-0007 |
| Forms | Field-level errors from `errors[]`, save disabled while submitting, unsaved-changes guard, `STALE_VERSION` banner with `Xem thay đổi`, `Tải lại`, `Ghi đè` | Admin states |
| Destructive actions | Outlined red button, confirmation that states the consequence with real numbers (branches and open orders using an item, orders in progress at a branch); a typed code for deleting a branch; every refusal explains itself (`IN_USE` with a count and a filtered link) | No silent data loss |
| Money, dates | Integer VND with dots (`188.000đ`); dates `dd/MM/yyyy`; times 24-hour; durations `12 phút`; business day starts at a configurable hour (default 04:00, setting) | Vietnamese conventions |
| Status is never colour alone | Every pill and chip carries text, and most an icon or a dot shape | Accessibility |
| Cursor | Every clickable element shows `cursor: pointer`, every disabled one `not-allowed`; a new clickable class is added to the list at the end of `admin.css` | Added 2026-10-28 |

### Decisions of the review accepted on 2026-10-28 ("accept all")

1. **The board is first-in-first-out** (oldest first, a new order at the bottom of `Mới`). The earlier draft said "at the top", which contradicted the API.
2. **The board's "now" is 12:05:41** (lunch rush). The earlier draft used 09:41, before the Bến Thành branch opens at 10:00.
3. **Captions and spec tables are Vietnamese**, as in the existing frames (the earlier draft said English, which would have made new and old frames inconsistent).
4. **The Excel statistics page (`27-reports`) is phase 1;** the charts of the same page are phase 3.
5. **Settings has eight sections:** brand and receipt, ordering, payment, business day, maintenance and version, features, loyalty (phase 2), security. A ninth section, `Thuế và hóa đơn`, exists only while e-invoices are switched on; it is drawn in frame 28 (not in frame 22) and Admin only.

### Added the same day after the first foundations review (accepted, "accept all")

6. **Counter orders and dine-in** are phase 1. Six points: `DINE_IN` in `orders.type`; `orders.source` and `orders.created_by`; nullable `orders.customer_id` (or a placeholder customer per branch); `POST /admin/orders` moves up from phase 2; staff screens get the bank details and bank code through `GET /admin/meta/config`; no split payment. The kitchen starts at once, also while a transfer is unconfirmed; a person confirms every transfer (there is no bank connection). The schema and API parts are still **not in** the documents and are gaps below.
7. **No expense, cost or profit data exists** in the data model, so no "thu chi" screen is drawn. If the owner wants expenses it is a new feature (data model, API, screens).
8. **Table service on the phone** (frame 30): staff take orders at the table on the phone layout of the admin web, not in the customer app (the Expo app stays customer-only; the staff login, cookie transport and TOTP are unchanged). A dine-in order has an optional table label (`B1` to `B6` chips or typed). A customer who orders again at the same table gets the **new items added to the open order** (`Gọi thêm`, numbered rounds, one payment per table). Rules the design added to make that safe and that **still need the owner's confirmation:** items can be added only while the order is unpaid and not final (`ORDER_NOT_EDITABLE` otherwise); adding to a `READY` dine-in order sends it back to `PREPARING`; the kitchen ticket of a round prints only that round's lines under `LƯỢT 2`.
9. **Printing from a phone is open:** the browser print dialog of a phone does not reach a thermal printer; a network or cloud printer or a print server is needed.
10. **W01C decisions:** order cards, tickets and receipts show the customer's given name with the masked phone; printed previews (`.ticket`, `.receipt`) are always drawn light on a neutral background, also in dark mode; `.pos .mtile .cart .bankbox` belong to the counter order and `.pshell .pnav .bsheet` to the phone frame; the note flag uses the flag icon, an unverified allergen a violet pill, an unpaid transfer a warning chip with an icon. **Still open:** the paper size of the kitchen ticket and the receipt (A6 or an 80 mm roll).

### Decisions taken while drawing (accepted as proposals unless a row says "needs confirmation")

| Topic | Decision | Source |
|---|---|---|
| Board details | No time thresholds for `Đã nhận`, `Sẵn sàng`, `Đang giao`; column label `Mới` on the board (frame 00 still shows `MỚI`, to be aligned); pausing several branches asks for each branch; the `⋯` menu on a card stays. Thresholds are placeholders: `Mới` warning 5 / late 10 minutes, `Đang chuẩn bị` warning 15 / late 25 | W03C, accepted 2026-10-28 |
| Realtime | Connection is lost after 30 s without data; `Cập nhật lúc` is the last data received; fallback refetch every 15 s while the board is open (as in api-outline; frame 22 words it differently, see deviations); the "viewing" dot is in-memory only; toast wording as drawn | W12C, accepted 2026-10-29 |
| Audit log | 21 action codes, 8 entity types, 24 months kept, mandatory date range of at most 366 days | W12A, accepted 2026-10-29 |
| Big lists | Pages for lists with a total, cursors for orders, audit and reviews, server-side searchable selects asking for 20 matches | W12B, accepted 2026-10-29 |
| Exports | Nine file types (a tenth, `INVOICES`, only when e-invoices are on, N11), `REVENUE` (the Excel statistics) first; Excel or CSV UTF-8 with BOM (not verified against Vietnamese Excel); files kept 7 days; contact masked by default and a reason required to unmask | W12D, accepted 2026-10-29 |
| System email | Five templates (`STAFF_INVITE` link 48 h, `STAFF_PASSWORD_RESET` link 30 min, `VERIFY_EMAIL_CODE` and `PASSWORD_RESET_CODE` 6-digit code 10 min with no link, `MFA_RESET_NOTICE`); **order and reservation emails are not sent in v1** (in-app status only, `WA3`); customer addresses masked in the send log; resend only for staff mail in `FAILED`, once per 60 s | W12E, accepted 2026-10-29 |
| Login | `ACCOUNT_SUSPENDED` shows only after a correct password; a wrong TOTP code counts toward `failed_login_count`; maintenance never blocks staff login; recovery: ten codes, warning at three left, a new set is mandatory when none are left, tick box `Tôi đã lưu các mã này` | W02A, W02B (needs confirmation) |

### Decisions of phases 2, 3 and the deferred frame (accepted 2026-10-30)

Decisions the owner accepted for the commands below (from the notes of `docs/tmp/web-design/STATUS.md`). "Accepted as proposed" means the owner approved the command and took the frame's proposals as drawn.

- **W09B (reviews, reports tab; approved 29/10/2026), accepted as proposed on every point the frame decided itself and on every open question:** the queue is newest first; Staff do not see the Reports tab; **Ẩn đánh giá** on an already hidden review only closes the report; the switch for other reports on the same review also applies to **Bỏ qua**; the note is at most 500 characters; the extended 11:35 sample is used. The W09A deviations (the report and tab counts of the Bến Thành Manager, the locked tab of Staff) are not fixed yet and wait for a separate decision.
- **W14A (reservations calendar; approved 30/10/2026), accepted as proposed on every point and open question:** every role handles reservations; the calendar shows one branch; Đã đến opens 30 minutes before and Không đến 15 minutes after the reserved time; Hoàn tất and Không đến free the table at once; joining tables only adds up the seats; the decline reason is at most 200 characters; showing the phone number needs no reason; the request queue is oldest on top; the calendar can show past days read-only and the list filter is limited to 31 days.
- **W14B (tables and reservation rules; approved 30/10/2026):** the owner did not rule on the frame's own choices and open questions separately, so they stand as accepted as proposed: rules are edited only in frame 24 (frame 10 would only show them); only Manager and Admin open the page and Staff get `FORBIDDEN`; tables can be added and rules edited even when the branch has not turned reservations on; Tắt is blocked while `CONFIRMED` or `SEATED` reservations are unfinished (there is no move-to-another-table step because the API lacks one), and reducing seats is checked the same way; Xóa only for a table that is switched off and never used; area is free text with suggestions; `IN_USE` is reused for switching off, reducing seats and deleting; the proposed value limits stand.
- **W14C (vouchers; approved 30/10/2026), accepted as proposed on every point and open question:** the code locks after the first redemption; a Manager edits only vouchers of their own branch and only views all-branch vouchers; vouchers are not deleted, only switched off; Staff cannot open the page; the status is derived, not stored in a column; value limits (code 4–20, title ≤ 60, fixed discount ≥ 1.000đ, uses ≥ 1); a voucher does not reduce the delivery fee. Also drawn and accepted with it: `INVALID_STATE` reused when two people switch off at once, and default start 00:00 and end 23:59.
- **W14D (banners and points; approved 30/10/2026):** the owner did not rule on the frame's own choices and open questions separately, so they stand as accepted as proposed; two questions still wait for the owner when the W16 clean-up runs: the sample balance 320 against order `BT-261026-0107`, and removing `MAINTENANCE` from the admin screens (maintenance blocks only the customer app, W13B; frames 25, 14, 15, 22 and 27 still draw it).
- **W15C (statistics charts; approved 30/10/2026), accepted as proposed on every point and open question:** three tabs inside the same Thống kê page; one-colour charts in `--color-primary` with a grey context for the previous period; comparison with the previous period is optional (off by default, same weekday, days not yet ended left out) and a Manager may use it; grouping by branch is for Admin only; 366-day limit; the peak-hours grid sums the orders; the 8-colour chart palette is added to `tokens.json` in the brief (a token gap); no drill-down and no grouping by week or month yet; normalising the cancellation reason into a pick list is a proposal for the brief.
- **W17 (e-invoices, deferred; approved 30/10/2026), accepted as proposed on every point and open question:** a Hóa đơn sidebar item (Manager, Admin); a three-level age chip, with `Sắp quá hạn` from 80% of the deadline; the queue lists only invoices of completed orders; Staff only see the status; with manual entry the Manager re-enters the tax lines; replace = cancel the old invoice and create a new one in one transaction; buyer address and email only in the detail; the guest sees `Đang xử lý` when an invoice has failed; the customer-app screens are drawn with admin tokens until the customer app frame set exists. The API and data gaps move into this brief (W16B); every tax rate is still a sample number pending the accountant.

- **Orders board follow-up (frame 02, requested by the owner 2026-10-30):** a search field in the column count bar (filters the loaded orders on the device by order number, given name, last three phone digits, table label and item name; all words must match; not diacritic-sensitive; collapses to a 48 px icon below 1100 px; older orders are found in the order history, which needs `q` on `GET /admin/orders`, gap R5), and a soft ring pulse (1.8 s) around late order cards (`.ocard.late`), paused on hover and focus and **off under `prefers-reduced-motion`**, never the only signal. This is a deliberate exception to the earlier rule "the new-order ring is static, not pulsing": new cards stay static, only late cards move. Open: whether staff need a switch to turn the pulse off on a device.

- **Phone table service follow-up (frame 30, requested by the owner 2026-10-30):** (1) workspace: top bar 49 px with the screen title and the branch code, tab bar 56 px, search as an icon next to the category chips, compact menu rows, both bars hide while scrolling down and return on the first move up, the tab bar is hidden while entering an order (measured on 390 x 844: 4 menu rows visible before, 9 after, 11 while scrolling); (2) alerts: bell with unread count, tab badge turning to "!", toasts (information 5 s, needs action stays), a slim banner for tables needing action, a notification sheet; derived from open orders and realtime events, not stored; device settings in `localStorage`; no push while the app is closed. Proposals of mine to confirm: the "ready not served" thresholds (5 and 10 minutes), alerts to the order creator first and to the manager of the branch for late orders, vibration and keep-awake switches.

- **Reservation search (frame 23, requested by the owner 2026-10-30):** the calendar and the list get one **Tìm đặt bàn** field so staff can check whether a guest who walks in has a reservation: name, last three phone digits (the digits that stay visible) or the reservation code, results from yesterday to 14 days ahead with the action that fits (`Đã đến` inside the 30 minute window, `Xác nhận` for pending, `Xem`), other-day matches in their own group, "no result" with a way to a counter order (frame 29), and a short check-in confirmation. The earlier decision that the list cannot search by phone is reversed (P26). Open (question 84): whether an admin on "all branches" should search every branch by default; P26 proposes yes.

- **Editing and adding reservations for guests (frame 23, requested by the owner 2026-10-30):** `Sửa đặt bàn` in the detail panel (time, duration, party size, tables with the same capacity check, guest name, phone after an audited reveal, note, **required reason**, a before/after summary, an option to tell the guest in the app); only for `PENDING` or `CONFIRMED`; the status does not change. **My proposal to confirm:** editing is for `MANAGER` and `ADMIN` only; `STAFF` still confirm, decline, assign tables, seat, and may add a reservation by phone or at the counter (`Thêm đặt bàn`). Errors drawn: `VALIDATION_FAILED`, `SLOT_UNAVAILABLE`, `STALE_VERSION`, `INVALID_STATE`, `FORBIDDEN`, `RATE_LIMITED`. This narrows the earlier W14A rule "every role handles reservations the same way" (P27, P28).

## Frame index

Numbers and file names are fixed by `docs/tmp/web-design/03-ia-roles-components.md` section 3. **31 frames are planned and all 31 exist** (frame 28 is deferred and marked `Chưa bật`). Phase: 1 = first release, 2 = reservations, vouchers, loyalty, audit viewer, 3 = charts.

| Frame | Screen | Phase | Main tables | State |
|---|---|---|---|---|
| 00 Foundations | Tokens, shell, role-aware sidebars, role matrix, enum label map, data-masking rules, components (`.ocard .elapsed .totals .matrix .ticket .receipt .mfa .ringmap .sheet .cal`), spec | 1 | n/a | drawn (27) |
| 01 Login | Staff login, second factor (TOTP or recovery code), MFA setup, ten recovery codes, lost device, forgot password, set password from an invitation, lockout, session expired | 1 | `users`, `mfa_credentials`, `email_tokens`, `refresh_tokens`, `audit_logs` | drawn (13) |
| 02 Orders board | Live board (tablet): columns, cards, timers, action rules and dialogs (courier, payment, cancel, reject, failed delivery, pause), new orders, busy board, list view, several branches, freshness and failure states | 1 | `orders`, `order_items`, `order_item_options`, `order_status_events`, `branches`, `audit_logs` | drawn (38 boards) |
| 03 Order detail | 520 px side panel and full page, reveal contact, payment, refund, timeline, ten variants (pickup, scheduled, unpaid transfer, completed, cancelled by customer or staff, rejected, dine-in), dialogs and errors, kitchen ticket, customer receipt (58 and 80 mm) | 1 | `orders`, `order_items`, `order_item_options`, `order_status_events`, `delivery_zones`, `menu_item_tags`, `reviews`, `audit_logs` | drawn (37) |
| 04 Orders list | Order history: filters, mandatory date range, quick filters, cursor paging both ways, row menu, export, role variants | 1 | `orders`, `order_items`, `order_status_events`, `branches`, `export_jobs`, `audit_logs` | drawn (15) |
| 05 Menu items | Item list grouped by category, filters, create, row menu, drag to reorder, export | 1 | `menu_items`, `menu_item_translations`, `menu_categories`, `menu_item_tags`, `tags`, `branch_menu_items`, `menu_item_media`, `export_jobs`, `audit_logs` | drawn (11) |
| 06 Item editor | Five tabs (basics, options, tags, photos, branches), selling rules, conflict, dialogs | 1 | `menu_items`, `menu_item_translations`, `item_option_groups`, `item_options`, `tags`, `menu_item_tags`, `menu_item_media`, `media`, `branch_menu_items`, `stock_movements`, `audit_logs` | drawn (34) |
| 07 Categories and tags | Menu categories, tags (dietary, allergen, label), branch amenities | 1 | `menu_categories`, `tags`, `menu_item_tags`, `amenities`, `branch_amenities` | drawn (13) |
| 08 Availability and stock | Kitchen tablet: big sold-out switches, stock stepper, restock and adjust dialogs, offline | 1 (history 2) | `branch_menu_items`, `menu_items`, `menu_item_translations`, `menu_categories`, `stock_movements`, `audit_logs` | drawn (11) |
| 09 Branches | Branch list, pause switch, create and delete | 1 | `branches`, `staff_branches`, `branch_opening_periods`, `orders` | drawn (7) |
| 10 Branch editor | Info and address tabs, map pin, confirmation of the location | 1 | `branches`, `provinces`, `wards`, `delivery_zones`, `audit_logs` | drawn (10) |
| 11 Branch hours | Store and delivery hours, special days, copy dialog | 1 | `branch_opening_periods`, `branch_special_hours`, `branches` | drawn (12) |
| 12 Branch delivery | Delivery rings (zones), ring map drawing, address check tool | 1 | `delivery_zones`, `branches`, `audit_logs` | drawn (13) |
| 13 Branch media and contacts | Photos, amenities, contact | 1 | `branches`, `branch_media`, `media`, `branch_amenities`, `amenities` | drawn (14) |
| 14 Reviews | Reviews tab (Admin, Manager and Staff views, filters with a mandatory date range, long text, reply, hide, remove and restore dialogs, states, conflicts, 1024 px) and the reports tab (two-pane queue of reports about reviews, duplicate reports, apply-to-other-reports switch, hide, remove and dismiss dialogs with a required note, processed reports read-only, queue states, Manager and Staff variants, `report.created` and `report.resolved`, submit errors, 1024 px) | 1 (reports tab 2) | `reviews`, `review_reports`, `branches`, `orders`, `users`, `staff_branches`, `audit_logs` | drawn (25) |
| 15 Users | Staff tab (create, edit, suspend, reset password, MFA reset, resend invitation, guards), customers tab (masked contact) | 1 | `users`, `staff_branches`, `mfa_credentials`, `refresh_tokens`, `orders`, `audit_logs` | drawn (25) |
| 16 Dashboard | Today's operations: six cards, 7 days, branch comparison, needs-attention groups, three roles | 1 | `orders`, `order_status_events`, `branch_menu_items`, `menu_item_tags`, `review_reports`, `app_settings` | drawn (9) |
| 17 Audit log | Read-only append-only log, before / after diff, 21 action codes, filters | 2 (rows written from 1) | `audit_logs`, `users`, `branches`, `export_jobs` | drawn (14) |
| 18 Data scale | Patterns for big lists: paging, cursors, estimated counts, server-side selects, states | 1 | every list | drawn (6) |
| 19 Realtime | Connection states, new order, two people on one order, refetch rules, event matrix | 1 | `outbox_events`, `row_version` | drawn (7) |
| 20 Export | Export button and dialog, nine file types, export states, "Tệp đã xuất" screen | 1 | `export_jobs`, `orders`, `menu_items`, `reviews`, `users`, `audit_logs` | drawn (9) |
| 21 Email | Send log (seven statuses), bounce handling, five templates, Gmail-style editor, previews, test send, masked recipients | 1 | `email_messages`, `email_templates`, `email_suppressions`, `email_tokens`, `audit_logs` | drawn (10) |
| 22 Settings | Eight sections, `STALE_VERSION`, audit | 1 (section 7 is 2) | `app_settings`, `audit_logs`, `media`, `orders`, `users` | drawn (30) |
| 23 Reservations | Day calendar by table (tables × hours, status blocks, unassigned row, waiting queue), detail panel by status, reveal phone in three steps, confirm with table choice and capacity check, joined tables, decline with a required reason, arrived / completed / no-show dialogs, alternative paged list with filters, search for check-in (name, last three digits, code), edit a reservation for the guest (Manager, Admin) with a before and after summary and required reason, add a reservation by phone or at the counter, who may do what, realtime events, states, Admin at "Tất cả chi nhánh", Manager of a branch without reservations, Staff, errors, 1024 px | 2 | `reservations`, `reservation_status_events`, `reservation_tables`, `restaurant_tables`, `staff_branches`, `audit_logs` | drawn (28) |
| 24 Tables | Tables and reservation rules: table list (seats, area, status, held reservations, edit, switch off, delete) with filters and paging, the four `reservation_*` rules with preview, add and edit table dialogs, reducing seats blocked, switching off (result, undo, blocked while reservations remain), deleting an unused table or one with history, states, Manager of a branch without reservations, Staff denied, errors, 1024 px | 2 | `restaurant_tables`, `branches`, `reservation_tables`, `reservations`, `audit_logs` | drawn (12) |
| 25 Vouchers | Voucher list (code, discount, minimum order, validity, branch, audience, use bar, derived status and switch, edit, assign), redemptions panel, voucher editor (locked code after use, in-app card preview, worked example), create / percentage / assigned variants, assign-to-customers dialog, save validation, duplicate code and conflicts, switch-off dialog with undo, customer-app voucher cards, Manager and Staff variants, states, errors, 1024 px | 2 | `vouchers`, `voucher_redemptions`, `voucher_assignments`, `orders`, `audit_logs` | drawn (14) |
| 26 Promotions and loyalty | Home banners (list with order, 2:1 images, link and validity, switch; phone-frame preview; editor and create; four link types and target picker; validation; image upload; delete, toggle, reorder; errors; list states; how guests see them) and loyalty points (Admin only: current rates read-only with customer search, ledger of a customer, manual adjustment dialog, validation and server errors, result with toast and audit log, ledger states, Manager and Staff denied), 1024 px | 2 | `promotions`, `media`, `loyalty_accounts`, `loyalty_ledger`, `app_settings`, `audit_logs` | drawn (20) |
| 27 Reports | Excel statistics (filters, cards, preview, export dialog, five sheet previews; phase 1) and charts (three tabs `Doanh thu`, `Món bán chạy`, `Tổng quan đơn`: revenue by day, previous-period comparison, grouping by branch, order type and payment, Manager view, best sellers, order summary, peak-hours grid, tooltip and keyboard, states, errors, print and high-contrast patterns, 1024 px; phase 3) | 1 (charts 3) | `orders`, `order_items`, `order_status_events`, `branches`, `export_jobs`, `audit_logs`, `app_settings` | drawn (32) |
| 28 Invoices | E-invoices, every board marked `Chưa bật`: queues (to issue by manual entry or provider, issued, failed, cancelled and replaced), record-number dialog, issue through a provider, invoice detail (issued, pending, failed, cancelled, replaced), cancel and replace dialogs, daily summary invoice with merged orders, e-invoice block in order detail, buyer information dialog, Settings section 9, states, errors, Manager and Staff variants, 1024 px, two customer-app screens (checkout, order tracking) | deferred | `order_invoices`, `summary_invoices`, `orders`, `app_settings`, `audit_logs` | drawn (26) |
| 29 Counter order | Tablet: menu grid, cart, table label, cash or bank transfer (`.bankbox`), add to an open order, errors | 1 (accepted; API still lists it as 2) | `orders`, `order_items`, `order_item_options`, `order_status_events`, `branch_menu_items`, `menu_item_tags`, `audit_logs`, `app_settings` | drawn (17) |
| 30 Table order, phone | 360 to 430 px: open tables, order at the table, add items, pay, errors | 1 (accepted) | `orders`, `order_items`, `order_item_options`, `order_status_events`, `branch_menu_items`, `audit_logs`, `app_settings` | drawn (17) |

Phase 2 and 3 and the deferred frame were drawn after the first version of this brief (W09B, W14A to W14D, W15C, W17); `index.html`, this brief and the UI docs were re-run after them on 2026-10-30.

## Screen to data summary

Derived from the `Dữ liệu` tables of the frames. "Gap" marks a column or endpoint that does not exist yet.

| Screen | Reads | Writes |
|---|---|---|
| Login (01) | `users`, `mfa_credentials` | `users.failed_login_count`, `locked_until`; `refresh_tokens`; `mfa_credentials` (setup, `last_used_step`, recovery hashes); `email_tokens` (set password); `audit_logs` |
| Orders board (02), detail (03) | `orders`, `order_items`, `order_item_options`, `order_status_events`, `branches`, `delivery_zones`, `app_settings` (thresholds via `/admin/meta/config`) | `orders.status`, `payment_status`, courier; `order_status_events`; `stock_movements` (restore on cancel); `branches.status` (pause); `audit_logs` (payment, cancel, refund, reveal) |
| Orders list (04) | `orders` with cursor and estimated count | `export_jobs` |
| Counter order (29), phone (30) | `branch_menu_items`, `menu_items`, options, tags, `app_settings.payment`, open dine-in orders | `orders` (`DINE_IN` or `PICKUP`, source, creator, table label: gaps), `order_items` (round: gap), `order_status_events`, stock, payment confirmation, `audit_logs` |
| Menu (05 to 08) | `menu_items`, translations, categories, tags, options, `menu_item_media`, `branch_menu_items`, `stock_movements` | the same, plus `media`, `audit_logs`; availability switches write `branch_menu_items.is_available` |
| Branches (09 to 13) | `branches`, `branch_opening_periods`, `branch_special_hours`, `delivery_zones`, `branch_media`, `branch_amenities`, `staff_branches`, `wards` | the same, `audit_logs` |
| Reviews (14) | `reviews`, `orders`, `branches`, `users` | `reviews.status`, `reply_*`, branch rating, `audit_logs` |
| Users (15) | `users`, `staff_branches`, `mfa_credentials`, `orders` (counts) | `users`, `staff_branches`, `email_tokens`, `refresh_tokens`, `mfa_credentials` (MFA reset), `audit_logs` |
| Dashboard (16) | `orders`, `order_status_events`, `branch_menu_items`, tags, `app_settings` (all through one gap endpoint) | nothing |
| Audit log (17) | `audit_logs`, `users`, `branches` | `export_jobs` |
| Export (20), statistics (27) | `export_jobs`; `orders`, `order_items` for the sheets | `export_jobs`, `audit_logs` |
| Email (21) | `email_messages`, `email_templates`, `email_suppressions` | `email_templates` (new version per save), `email_tokens` (resend), `audit_logs` |
| Settings (22) | `app_settings` (`brand`, `ordering`, `payment`, `business_day`, `maintenance`, `min_app_version`, `featureFlags`, `loyalty`), `media`, `users` | `app_settings` per key, `media`, `audit_logs` |

## Role matrix

From `03-ia-roles-components.md` section 2, drawn in frame 00 (board `Quyền theo vai trò`); every frame's spec table has a `Quyền` row.

| Capability | STAFF | MANAGER | ADMIN |
|---|---|---|---|
| Orders board, order detail, transitions, payment confirmation, printing, history (own branches) | yes | yes | yes (all) |
| Create an order at the counter (dine-in or take-away; one branch chosen per order) | yes | yes | yes (all) |
| Mark an item sold out or available (own branches) | yes | yes | yes |
| Menu items, categories, tags, prices, stock adjustments, per-branch price override | no | yes (overrides and stock for own branches; shared menu content yes) | yes |
| Branch settings, hours, zones, tables | no | yes (own) | yes, plus create and delete branches |
| Pause orders (`POST /admin/branches/{id}/pause`) | yes | yes | yes |
| Reviews: read, hide, remove, reply | read | yes (own branches) | yes |
| Reservations: calendar, search, confirm, decline, assign tables, `Đã đến`, `Không đến`, add one by phone or at the counter (phase 2) | yes | yes | yes |
| Reservations: **edit** time, party size, contact or note of an existing one (P27; proposal to confirm) | **no** | yes (own branch) | yes |
| Tables and reservation rules (frame 24) | no | yes (own branch) | yes |
| Vouchers, banners (phase 2) | no | yes | yes; loyalty rates and manual points: admin only |
| **See revenue figures** (dashboard revenue, 7-day table, any sum over a period) | **no** | yes (own branches) | yes (all, plus branch comparison) |
| Statistics page and **every export** (own branches) | **no** (no `Báo cáo`, no `Tệp đã xuất`, no `Xuất` button) | yes | yes (all, plus users and audit) |
| Users, settings, email templates, audit (all) | no | no (audit of own branches: yes, phase 2) | yes |

`FORBIDDEN` on `/admin/reports/*` and `/admin/exports*` for `STAFF`. A role change while a page is open: the next request returns `FORBIDDEN` and the page shows the denied-access page instead of an error toast.

## Where the design had to deviate from, or fill a gap in, the documents

The frames were checked against data model v5, API v3 and the ADRs. These are the points where documents disagree with each other or with a frame, or where the design chose a reading. Each is resolved in the frames as noted and needs the owner's confirmation or a document fix. (The long list of missing columns and endpoints is in the next section.)

| # | Finding | What the frames do | Needs |
|---|---|---|---|
| D1 | The earlier board draft put a new order at the **top** of `Mới`, but the API returns the oldest first. | First in, first out; a new order appears at the bottom with a ring, a toast and a `Có N đơn mới ↓` button (decision 1). | None (accepted) |
| D2 | `orders.type` has no dine-in value, but the owner wants to serve at the premises and at the counter. | `DINE_IN` (`i-utensils`, no address, no courier, `READY` then `Đã phục vụ`) is drawn everywhere orders are listed; label and source chip marked "proposed" in frame 00. | Add to data model (gaps A1 to A9) |
| D3 | `POST /admin/orders` is phase 2 in api-outline, but staff take orders at the counter in phase 1. | Frame 29 draws it as phase 1. | Move it up in api-outline |
| D4 | The earlier role matrix let `STAFF` see revenue figures. | Revenue and every sum are hidden from `STAFF` (statistics, exports, dashboard cards, 7-day table). | None (accepted); the API must refuse too |
| D5 | api-outline says maintenance mode blocks API calls, and frames 14, 15, 22 and 27 drew `MAINTENANCE` for admin calls, but an admin must be able to sign in to switch maintenance off. | Frame 01 and the settings frame state that maintenance blocks **customer-facing** paths only and never `/admin/auth/*`. The `MAINTENANCE` state is kept only as "the server is under technical maintenance". | Confirm (gap L13) |
| D6 | Frame 22 words `ordering.board_refetch_seconds` as "only used when realtime is lost", but api-outline and ADR-0007 refetch every cycle while the board is open. | Frame 19 follows api-outline (15 s, while open). | Fix the wording in frame 22 |
| D7 | ADR-0007 still points to "frame 18" for realtime; the frame is now 19. | None. | Fix the ADR reference |
| D8 | `api-outline.md` names `featureFlags.einvoice`, which contradicted `WA17` (no e-invoices in v1). | Resolved on 2026-10-30 with Z3: the key stays, **off by default and absent from the Settings screen** until e-invoices are enabled; `GET /admin/meta/config` returns `features.einvoice = false`. The settings frame draws four feature flags. | None (resolved; see L18) |
| D9 | The dashboard command asks for a group "completed but unpaid", but `CHECK (status <> COMPLETED OR payment_status = PAID)` makes it impossible. | Drawn as asked (it can only catch bad data); better groups are proposed. | Choose (gap F4) |
| D10 | Frame 00 spells the first board column `MỚI`; frame 02 spells it `Mới`. | Frame 02 uses `Mới`. | Align frame 00 |
| D11 | The phone field exists in the branch info tab (frame 10: accepts a national number) and in the contacts tab (frame 13: rejects it). | Both drawn as specified. | Choose one place and one rule (gap C34) |
| D12 | The first login command listed eight recovery codes at setup but ten at the lost-device step. | Ten, from data model and `WA20`. | Confirm |
| D13 | `LAST_ADMIN` counts active admins; `WA20` wants at least two active admins **with MFA**. | The users frame shows a banner "nên có hai quản trị viên" and leaves the counting rule open. | Choose (gap E5) |
| D14 | The users frame (15) invents a second admin (`Lê Khoa`); the sample data has only one. | Used only to draw the guards and the banner. | Keep or remove |
| D15 | Frames 08 (availability) and 15 (users) have no `Xuất` button, while the export frame says lists export. | Not changed (out of scope of the commands that drew them). | Add them in a later pass (gap J8) |
| D16 | Sample revenue is inconsistent: a branch day is about 4.4 to 5.7 million VND, but year to date is 412.650.000đ. | Numbers kept as in the sample data. | Owner to supply real numbers |
| D17 | The first email frame resend limit was 5 minutes; frame 15 proposes 60 seconds per user. | The email frame follows frame 15. | Confirm (gap E10) |
| D18 | The hex colour `#8CC2FF` is hard-coded in `.toast a` and in the frame-bar toggle, and `#06101C` in three scrims (see Token gaps). | Left as inherited. | Add tokens |

## Owner's pending decisions (collected)

The decisions below were made inside frames "as a proposal"; nothing blocks the next step but each needs a yes:

- Counter orders: hold the kitchen until a transfer is confirmed (now: the kitchen starts at once); counter orders when the branch is paused or past its order cutoff; table number on every dine-in order; phone orders for delivery; automatic kitchen-ticket printing.
- Table service: the three added rules of decision 8; whether a waiter may confirm a bank transfer on a phone or only the counter.
- Login: the five confirmations of W02A and W02B (see "Decisions taken while drawing").

## API and data gaps found

Collected from the gap table at the bottom of every frame (`Khoảng trống của mô hình dữ liệu và API`) and from the reports of every command (W01A to W17). **On 2026-10-30 the rows with a data or API effect (almost all of them, including A41 to A43 and P26 to P28 after the owner's review of this brief) were folded into `data-model.md` and `api-outline.md` as proposals, tagged `(brief ID)` in those files; the table of where each ID went, and which were left out on purpose, is in [gaps-coverage.md](gaps-coverage.md)**; the frames draw the closest honest version and the owner or the engineers decide. Rows that appear in two frames are merged and list both. IDs are stable: `R` required items, `A` orders and payments, `B` menu and stock, `C` branches, `V` reviews, `E` users and login, `F` dashboard, `G` audit log, `H` big lists, `I` realtime, `J` exports and statistics, `K` email, `L` settings, `Z` app shell, `P` reservations and tables, `M` vouchers, banners and loyalty, `N` e-invoices, `S` sample data invented by the frames; `V11` to `V23` continue the reviews rows for the reports tab and `J101` to `J110` continue the statistics rows for the charts.

### R. Items the brief must carry (listed by the commands)

| ID | Frames | Item | Missing today | Proposal and who decides |
|---|---|---|---|---|
| R1 | 00, 03, 22 | Receipt layout and paper width | The paper size of the kitchen ticket and the receipt is undecided (A6 or an 80 mm roll). Frame 03 draws the receipt at 58 and 80 mm and the kitchen ticket at 280 px; frame 22 lets the owner choose 58 or 80 mm. | Owner chooses with the printer in hand; the `.ticket` and `.receipt` classes carry both widths. |
| R2 | 03, 22 | Receipt title wording | The title `HÓA ĐƠN BÁN HÀNG` (set in settings, up to 40 characters) may be read as an invoice. The revenue threshold above which an e-invoice is required is not known. | Accountant confirms the title and the threshold; e-invoices stay deferred (`WA17`, frame 28). |
| R3 | 27, 20 | Excel sheet layout the accountant wants | Frame 27 draws five sheets: `Theo ngày` (always included), `Theo món`, `Chi tiết đơn` (masked and unmasked), `Đơn hủy và hoàn tiền`, `Tổng năm`. Columns, totals row and the year-to-date rule are the design's guess. | Accountant reviews the five previews and names the columns; then fix the column list in `export_jobs.filters`. |
| R4 | 06, 13 | Item photo limit | No limit exists in the data model or API. Frame 06 draws **8 photos per item** (error `TOO_MANY`); frame 13 draws **12 per branch**. | Owner confirms the numbers and whether they are fixed or in `app_settings` (see B15, C32). |
| R5 | 04, 15 | `GET /admin/orders` filters for a customer | The outline has no `customerId`, `source`, `late`, `q` by table label, `branchIds[]`, `from` and `to`, cursor both ways or an estimated count. | `customerId` (so `Xem đơn` on the users screen opens the right history), plus the parameters in A2, A5, A29 to A34. |
| R6 | 03, 15, 21 | May staff reveal customer contact without a reason? | No reveal endpoint exists. Frames 03, 15 and 21 draw `Hiện và ghi nhật ký` **without a reason** (an `audit_logs` row, a toast `Đã ghi nhật ký`, a re-mask button). Exports ask for a reason when contact is unmasked. | Owner decides whether a reason is required on screen too (gaps A16, E13). |

### A. Orders, payment and printing

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| A1 | 00, 02, 03, 04, 27, 29 | `orders.type` | Data model v5 has only `PICKUP` and `DELIVERY`. | Add `DINE_IN` (shaped like `PICKUP`: no delivery fields). |
| A2 | 04, 29 | Order source and creator | No `orders.source` and `orders.created_by`; the list cannot filter by source. | Add `source` (`APP`, `COUNTER`, `PHONE`) and `created_by` (null for a customer's own order); add `source` to the list filter. |
| A3 | 29 | `orders.customer_id` | Not nullable; a counter order may have no customer. | Allow null (shown as `Khách tại quầy`), or one placeholder customer per branch. |
| A4 | 29 | `POST /admin/orders` | Phase 2 in api-outline. | Phase 1; body `{ branchId, type: DINE_IN or PICKUP, items[], customer?, note?, tableLabel?, paymentMethod, idempotencyKey }`; creates the order at `ACCEPTED` with the first event written by the staff member. |
| A5 | 04, 30 | Table label | No `orders.table_label` (optional, up to about 20 characters); the list cannot search it. | Add the column (phase 2: from `restaurant_tables`); let `q` match it (trigram or prefix index). |
| A6 | 30 | Rounds | No `order_items.round_no`. | Integer column; round 1 at creation. |
| A7 | 30, 03 | Add items to an open order | No `POST /admin/orders/{id}/items`. | Phase 1: `{ items[], rowVersion }`; creates a round, deducts stock, recomputes totals, sends a `READY` dine-in order back to `PREPARING`. |
| A8 | 30, 03 | Error for a paid or final order | No code. | `ORDER_NOT_EDITABLE` (409) in the error catalogue. |
| A9 | 30, 02 | Transitions for dine-in | The table has no `READY` to `PREPARING` (added round) and no `READY` to `COMPLETED` labelled `Đã phục vụ`. | Add both, `DINE_IN` only. |
| A10 | 30, 19, 03 | `order.updated` payload | Covers payment, expected time and note only. | Carry an `itemsAdded` flag (round N) so other devices reload lines and totals. |
| A11 | 29 | `/payment` idempotency | Resending a confirmation after a network error may fail instead of returning the current state. | Confirming an order already `PAID` with the same method returns the order and writes no second audit row. |
| A12 | 29 | Split payment | One method per order. | Deferred; if needed an `order_payments` table. |
| A13 | 22, 29 | Bank details for staff | Staff cannot read `app-settings`; `app_settings.payment` has no bank code for the QR; `/admin/meta/config` returns no transfer details. | Add `payment.bank_code` (6 digits) and `payment.qr_media_id`; staff read details through `/admin/meta/config`; a customer sees them only on an unpaid transfer order (`GET /orders/{id}` with `payment { bank, account, holder, qrUrl }`), never in the public `/meta/config`. |
| A14 | 29, 30 | Printing | No way to print the kitchen ticket automatically when an order is created (the browser needs a dialog); a phone cannot reach a thermal printer. | Network printer, cloud print or print server; undecided. |
| A15 | 30 | Confirming a transfer on a phone | Unclear whether a waiter may. | Allow with an audit row, or only at the counter; the owner decides. |
| A16 | 03 | Reveal phone and address of an order | api-outline says reading contact is audited and `AdminOrder` masks the phone "until revealed", but no command reveals. | `POST /admin/orders/{id}/reveal-contact` returns `{ phone, addressLine }` and writes `audit_logs` (`order.contact_reveal`); `GET /admin/orders/{id}` always returns the masked version. |
| A17 | 03 | Allergen and diet warnings on order lines | Tags are not captured on the order. | Accept reading current tags, or snapshot tags into `order_items` (jsonb). |
| A18 | 03, 02, 27 | Refund who, when, how much | Only `audit_logs` records who marked `REFUNDED` and when; no amount. | `orders.refunded_at` and `refunded_by`; amount defaults to `total` (no partial refunds). |
| A19 | 03 | Note flag | The card reads `orders.customer_note`; item notes live in `order_items.note`. | The flag merges both; confirm. |
| A20 | 03 | Review inside order detail | `AdminOrder` has no review. | Add `review { rating, body?, status, replyText? }`, or `GET /admin/reviews?orderId=`. |
| A21 | 03 | Cancel from `PREPARING`: restore stock? | The `restoreStock` choice is not stored on the order (only a `stock_movements` row if chosen). | Word the detail as "restored only if chosen", or add a flag to the cancel event. |
| A22 | 03 | Reprinting a receipt after settings changed | Title, footer, branch address, hotline and tax code come from current settings, not a snapshot. | Snapshot the receipt settings into the order at completion (jsonb), or fix the sentence "reprint always matches" in the data model. |
| A23 | 03, 22 | Legal address and tax code on the receipt | `app_settings.brand` has them, but the sample data has no values; the drawn receipt uses the branch address and a fake code `0300000000`; `brand.business_address` has no stated use. | Owner supplies them; decide where the legal address is used (email, legal page, receipt next to the tax code). |
| A24 | 02 | Time in current status (card timers) | `AdminOrder` has no "since" value; timers must come from `order_status_events`. | Add `statusSince` (or `lastEventAt`) to `AdminOrder` so the board does not load events. |
| A25 | 02 | Pausing | `POST /admin/branches/{id}/pause` is per branch, and its body has no reason; with several branches selected the board asks each branch. | Accept one call per branch; add an optional `reason` if the owner wants one. |
| A26 | 02 | Reason for rejecting | Only `order_status_events.note` and `orders.cancel_reason` hold it; the customer should see it. | Confirm both columns are filled. |
| A27 | 02 | Transition idempotency | `POST /admin/orders/{id}/transition` has no `Idempotency-Key`; a retry after a lost answer returns `409` and, when the previous actor was the same person, the screen shows no toast. | Add the header, or return the current order when the transition is already applied by the same user. |
| A28 | 02, 19 | Board needs every active order | `pageSize` is at most 50; counters need all active orders. | `view=board` without paging, or load several pages; the fallback refetch uses the same call. |
| A29 | 02, R5 | Several branches | `GET /admin/orders?branchId=` takes one id. | `branchIds[]`. |
| A30 | 04 | Late orders | No `late` filter; lateness is computed in the browser from `ordering.board_thresholds`, which breaks cursor paging. | `late=true` evaluated by the server for `PLACED` and `PREPARING`; rows carry `isLate` and minutes. |
| A31 | 04 | Two-way cursor paging | Only `cursor`, `limit`, `nextCursor` are outlined, for no admin list; no backward cursor. | `cursor`, `limit` (max 50), `nextCursor`, `prevCursor`; or the browser keeps a stack of cursors (lost when a link is opened mid-way). |
| A32 | 04, 18 | Estimated count | No total with a cursor. | `estimatedTotal { value, capped }` (cap 1.000) from `EXPLAIN` or a bounded count, for every cursor list. |
| A33 | 04 | List row shape | `AdminOrder` carries heavy `lines[]` and no last actor. | `AdminOrderSummary`: `itemCount`, `portionCount`, `tableLabel`, `source`, `isLate`, `lastEvent { at, actor { displayName } or null, kind }`, no `lines[]`. |
| A34 | 04 | Date range | "Mandatory date range" has no maximum and no error code; `business_date` exists only for completed orders. | 92 days (setting, provisional); `VALIDATION_FAILED` with `errors[].code` `RANGE_TOO_WIDE` or `RANGE_INVALID`; filter on `placed_at` in Vietnam time. |
| A35 | 04, 20 | Export orders | `POST /admin/exports` is described only for `REVENUE { from, to, branchId? }`. | `resource: ORDERS` with the list's own filters, `format`, `maskContact`, `reason`; `STAFF` get `FORBIDDEN` (see J2). |
| A36 | 18 | Search by last four digits or order-number suffix | Existing indexes match whole values or prefixes only. | `customer_phone_last4` column (indexed) and a suffix search on `order_number` by branch and day; or drop suffix search. |
| A37 | 15 | Orders of one customer | No `customerId` on `GET /admin/orders`. | Add it. |
| A38 | 18 | Indexes for cursors | `(branch_id, placed_at)` has no `id` tie-break; nothing for a customer's history. | `(branch_id, placed_at DESC, id DESC)` and `(customer_id, placed_at DESC, id DESC)`. |
| A39 | 22 | Orders waiting for a transfer (settings confirm dialog) | No small count. | Use `total` of `GET /admin/orders?paymentMethod=BANK_TRANSFER&paymentStatus=UNPAID&status=active&pageSize=1`; no new endpoint. This works because a request with `status=active` (or `view=board`) returns an **exact** `total`, unlike the history list, which has only `estimatedTotal` (A32; rule in api-outline). |
| A40 | 27 | Who cancelled a rejected order | `cancelled_by` has only `CUSTOMER`, `STAFF`, `SYSTEM`. | Treat `REJECTED` as `STAFF`, or add a value. |
| A41 | 30 | Alerts for "my tables" | `GET /admin/orders` cannot be filtered by creator, and `orders.created_by` is only proposed (A2). The phone alerts go to the person who typed the order. | Add `createdBy=me` to `GET /admin/orders`; carry `createdBy` (user id, no personal data) in the staff-audience payload of `order.status_changed`, so the browser can decide locally whether an event concerns the user. |
| A42 | 30 | Thresholds for "ready but not served" | `ordering.board_thresholds` has accept and ready warn and late only. The phone alert "table ready, not served" needs its own two numbers. | Add `ready_unserved_warn_minutes` (proposal 5) and `ready_unserved_late_minutes` (proposal 10) to `app_settings.ordering`, editable in settings; the 10 minute "transfer not found" threshold of the counter order is the same kind of key. |
| A43 | 30 | Where alerts come from | Staff phone alerts (toast, bell, tab badge, banner) are derived from the open orders and realtime events; nothing is stored. Push notifications while the app is closed are out of the first release (ADR-0009). | No `alerts` table or endpoint. After a reconnect or a reopen the browser recomputes from `GET /admin/orders` (`createdBy=me`, `view=board`). Revisit Web Push only if the owner asks (it needs an installed web app on iOS). Device settings (sound, vibration, keep awake, late alerts for "mine" or "the branch") live in `localStorage`, not on the server. |

### B. Menu, options, tags and stock

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| B1 | 05, 06 | Who changed an item and when | `menu_items` has no `updated_at` or `updated_by` (only `row_version`, `deleted_at`); the list's `Cập nhật` column and the conflict banner need them. | Add both columns (touched by any content edit: translations, tags, options, photos), or read from `audit_logs`, or let `STALE_VERSION` carry `current { rowVersion, updatedBy { id, name }, updatedAt }` (same need as C10 and L1). |
| B2 | 05, 18 | `GET /admin/menu-items` parameters | Outline lists only the verbs. | `q`, `categoryId`, `tagId[]`, `isActive`, `branchId` (or `none`), `missingCover`, `tagVerified`, `sort`, `page`, `pageSize`; for selects `q` (existing trigram index), `limit` max 20 and `ids[]` to rebuild chips of chosen items. |
| B3 | 05 | List row shape | None defined. | `AdminMenuItemRow { id, name, category, basePrice, cover?, tags[{ id, name, kind, verifiedAt }], isActive, optionGroupCount, tracksStock, branches[{ branchId, code, isAvailable, left? }], sortOrder, updatedAt, rowVersion }`; `branches[].isAvailable` only for the caller's branches. |
| B4 | 05 | Reordering items | Only `sort_order` per item. | `PUT /admin/menu-categories/{id}/items-order { itemIds[] }` in one transaction (consider the category's `rowVersion`). |
| B5 | 05, 06 | Deleting an item | `DELETE` takes no `rowVersion` and gives the dialog no numbers. | `DELETE /admin/menu-items/{id}?rowVersion=` (`If-Match`) returning `STALE_VERSION`; `GET /admin/menu-items/{id}/usage` returns `{ branches[], activeOrders[], stock }`. No restore in the app. |
| B6 | 05, 06 | Cover photo of a selling item | Unclear whether the last cover may be removed while the item sells; the `Thiếu ảnh` filter then only matches stopped items. | Block removing the last cover of a selling item (or switch it to stopped); also block dropping the last branch of a selling item. |
| B7 | 05 | Category cut between pages | A category can straddle two pages while dragging. | When sorted by menu order, cut pages at category boundaries or disable dragging for the cut category; not an issue under 50 items. |
| B8 | 06 | Rules to switch an item on | The outline names only the Vietnamese name and the cover. | The server checks four things when `isActive: true` (name `vi`, `basePrice` > 0, a cover, sold at one branch at least) and returns `VALIDATION_FAILED` with `errors[]` per field (`name.vi`, `basePrice`, `cover`, `branches`). |
| B9 | 06 | Option group rules | The data model has only `CHECK (0 <= min_select <= max_select)` and non-negative surcharge. | API also checks a default exists when exactly one is required, defaults do not exceed `max_select`, enough active options for `min_select`, and a `vi` name. Codes: `MIN_GT_MAX`, `DEFAULT_REQUIRED`, `DEFAULT_EXCEEDS_MAX`, `NOT_ENOUGH_ACTIVE`. |
| B10 | 06 | One request for a whole item | `PATCH /admin/menu-items` carries translations, tags, options, photos and price. | Keep one `rowVersion` per item; consider one per option group if two people edit two tabs. |
| B11 | 06 | Copy a group from another item | The data model mentions it; no endpoint. | Do it in the browser (read the other item and paste into the form) or `POST /admin/menu-items/{id}/option-groups/copy`. |
| B12 | 06 | Preview | Uses unsaved data. | Built in the browser from the form; no API. Must match the customer app's item sheet (mobile frame not drawn yet). |
| B13 | 06 | Who verified a tag | `menu_item_tags` has only `verified_at`; the screen shows `by <name> · <date time>`. | Add `verified_by` (to `users`), or read it from `audit_logs` (`entity_type = menu_item_tag`); `verifiedBy { id, name }` in `GET /admin/menu-items/{id}`. |
| B14 | 06 | Sending verification in the PATCH | Shape of `tags[]` not outlined. | `tags: [{ tagId, verified }]`; the server keeps `verified_at` when unchanged, sets `now()` on false to true, null on true to false; only `MANAGER` and `ADMIN`; each change audited. |
| B15 | 06, R4 | Photo limit per item | None. | 8 per item, checked on save (`VALIDATION_FAILED { field: "media", code: "TOO_MANY" }`); fixed or in `app_settings`? |
| B16 | 06, 13 | Upload errors of `POST /admin/uploads/images` | Outline says "validated, resized, blurhash" only. | Wrong type `415` `UNSUPPORTED_TYPE`; over 10 MB `413` `TOO_LARGE`; same content returns `200` with the existing `media` row (`duplicate: true`) instead of `201`. Add to the error catalogue. |
| B17 | 06 | Uploaded but never saved | Unreferenced media is cleaned after 7 days. | Same rule applies; an immediate clean needs its own job. |
| B18 | 06 | Shared `alt_text` | `media.alt_text` is on `media`; the same photo (by `sha256`) can attach to several items. | Accept that editing it changes every item, or move `alt_text` to `menu_item_media`. |
| B19 | 06, 08 | One branch row of an item | Outline has `GET, PUT /admin/branches/{id}/menu-items` for the whole list. | `PUT /admin/branches/{id}/menu-items/{itemId}` `{ isAvailable, priceOverride, lowStockThreshold, rowVersion }` (staff may send only `isAvailable`; price and stock `MANAGER`); creates the row when absent (sold at this branch); `DELETE` same path removes it; stock changes go through `/stock`; `404` for a branch outside the role. |
| B20 | 06 | Overwrite on conflict | Every `PATCH` is audited, but an overwrite is not marked. | Send again with the latest `rowVersion` and `overwrite: true`; the server logs `menu.overwrite` with the replaced values (action name to confirm). |
| B21 | 06 | A manager and other branches' rows | Not said whether a manager's item fetch returns other branches. | Return `offered` for every branch but `isAvailable`, `priceOverride`, `stockQty`, `rowVersion` only for the manager's own. |
| B22 | 06 | Branch row constraints | Only `CHECK (stock_qty >= 0)`. | Add `CHECK (price_override > 0)` and `CHECK (low_stock_threshold >= 0)`; field errors `priceOverride`, `lowStockThreshold`. |
| B23 | 06 | Start and stop tracking stock | `POST .../stock` takes only a delta. | `{ trackStock: true, qty, note }` and `{ trackStock: false }`, each writing `stock_movements` (`ADJUST`) and `audit_logs`. |
| B24 | 07 | Admin API for tags and amenities | Only public `GET /tags`, `GET /amenities`; admin has `/admin/menu-categories` (GET, POST, PATCH). | `/admin/tags` and `/admin/amenities` (GET, POST, PATCH, DELETE; manager, amenities admin), each record with `rowVersion` (the tables have no `row_version` column yet). |
| B25 | 07 | Deleting a category | No `DELETE`; no soft delete. | `DELETE /admin/menu-categories/{id}?rowVersion=`, hard delete when empty; `IN_USE` (409) with `{ count, sample[{ id, name }] }`. |
| B26 | 07 | Content of `IN_USE` | The code exists, its payload does not. | problem+json with `usage { count, sample[], filter }` so the dialog shows the count, a few names and a filtered link without another call; say whether soft-deleted items count. |
| B27 | 07 | Counts for the three tables | None. | Return `itemCount`, `unverifiedCount`, `branchCount` per row (whole restaurant). |
| B28 | 07 | Reordering categories | Only per-category `PATCH`. | `POST /admin/menu-categories/reorder { ids[], rowVersions }` in one transaction. |
| B29 | 07 | Hiding a category | `is_active` exists; its effect is not stated. | A hidden category's items are not shown to customers (`GET /branches/{id}/menu` skips them) and `menu.updated` fires. |
| B30 | 07 | Changing a tag's group | Not stated. | Block when the tag has items (`IN_USE`). |
| B31 | 07 | Paging the three lists | No parameters for categories; `/admin/tags` and `/admin/amenities` do not exist. | `page`, `pageSize` (20, max 50), `q` (accent-insensitive), `kind` (tags), return `total`; stable sort (group, unaccented name, `id`). |
| B32 | 07 | Icon set | `amenities.icon` is free text. | List the valid keys (`wifi`, `car`, `snow`, `tree`, `door`, `child`, `wheelchair`, `box`) in `GET /meta/config` or a shared doc; unknown key gives `VALIDATION_FAILED`. Who owns the list is open. |
| B33 | 08 | `menu.availability_changed` event | Public audience, payload undefined, no actor. | Payload `{ branchId, itemId, isAvailable, soldOut, stockQty?, rowVersion }`; the actor's name only in the branch staff copy, never to customers; a request key so the device that changed it skips the toast. |
| B34 | 08 | `stock.low` event | Name and audience only. | Payload `{ branchId, itemId, left, threshold }`, sent once when stock falls through the threshold; `STAFF` do not receive it (drawn so). |
| B35 | 08 | Stock 0 | Only `CHECK (stock_qty >= 0)`. | `soldOut = !is_available OR stock_qty = 0` (no stored flag); restocking brings the item back; storing a flag would need a re-enable rule. |
| B36 | 08 | `POST .../stock` | No `STOCK_NEGATIVE`, no word on `rowVersion`. | Delta only (safe to add up, no `rowVersion`); a result below 0 is `VALIDATION_FAILED { field: "delta", code: "STOCK_NEGATIVE" }`; returns the new stock. |
| B37 | 08 | Stock history | `stock_movements` has no balance after; `GET .../stock-movements` is phase 2 without parameters. | Parameters `itemId`, `reason`, `cursor`, `limit`; each row `balanceAfter` (window function) and the person or `order_number`; hidden from `STAFF`. |
| B38 | 08 | Multi-branch availability grid | Frame 00 draws a `.matrix` for several branches; frame 08 shows one branch at a time. | Owner decides: drop the multi-column variant or build it later. |
| B39 | 18 | Voucher limited to some items | `vouchers.applies_to` allows only `ALL`, `PICKUP`, `DELIVERY`; no link voucher to item. | If wanted: `voucher_menu_items (voucher_id, menu_item_id)`, checked when discounts are computed, shown in frame 25 (open question). |

### C. Branches, hours, delivery and media

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| C1 | 09 | Deleting a branch | Outline lists GET, POST, PATCH only. | `DELETE /admin/branches/{id}?rowVersion=`, admin, soft; refused with `HAS_ACTIVE_ORDERS` (code already exists for account deletion) when orders in progress or upcoming reservations exist, and when it is the last active branch. |
| C2 | 09 | Row figures | Not outlined. | `GET /admin/branches` returns `staffCount`, `ratingAverage`, `reviewCount`, `ordersToday`, `activeOrders`, `todayHours` (special days applied). |
| C3 | 09 | Staff who lose their last branch | Managers and staff need at least one `staff_branches` row. | Block, or set the person `SUSPENDED` with a notice; the dialog warns, the owner decides. |
| C4 | 09 | Paging | No parameters. | `page`, `pageSize`, `q`, `status`; `total`; sort by `sort_order` then name. |
| C5 | 10 | Draft branch without a location | `branches.location` is `NOT NULL`. | Allow null while `status = CLOSED` with `CHECK (status = 'CLOSED' OR location IS NOT NULL)`; otherwise a new branch can only be created after the pin is placed (the add dialog must collect address and location). |
| C6 | 10 | Locking the branch code | The model says the code never changes once an order exists, not who blocks it. | API refuses with `VALIDATION_FAILED { field: "code", code: "LOCKED" }`; `GET` returns `codeLocked`. |
| C7 | 10, 18 | Ward search | No search endpoint; `GET /wards` has only `provinceCode`. | `GET /admin/wards?provinceCode=&q=&limit=20`, accent-insensitive, 20 results; index `wards (province_code)` is enough (HCMC 168 wards, 3.321 nationwide on 21/10/2026). |
| C8 | 10 | Delivery needs an active zone | Checked "when switching on" only. | `GET` returns `activeZoneCount`; `PATCH` returns `VALIDATION_FAILED` on `acceptsDelivery`; also block turning off the last zone (C21). |
| C9 | 10 | Confirming the pin | Only `location`, no "confirmed". | Treat as a UI step: send `location` only when pressed; write `audit_logs` (`branch.location_confirm`, old and new coordinates). No column. |
| C10 | 10 | Who changed a branch | No `updated_at` or `updated_by` on `branches`. | Two columns, or `STALE_VERSION` returns `current { updatedBy, updatedAt }` (see B1). |
| C11 | 11 | Open 24 hours | `CHECK (open_time <> close_time)` blocks 00:00 to 00:00. | Draw 00:00 to 23:59 (leaves one minute if the next day also opens) or add `is_24h` and relax the check. |
| C12 | 11 | Special days and delivery | Not said whether a store special day closes delivery that has its own hours. | Effective delivery hours = delivery hours (week or special) intersected with effective store hours; store closed means delivery closed. |
| C13 | 11 | Special-day note | `note` exists; who sees it is not stated. | Drawn as internal. Showing it in the app (for example "Nghỉ Tết") needs a display field and a translation. |
| C14 | 11 | Overlapping special ranges | No constraint. | Exclusion constraint (`EXCLUDE USING gist` on `daterange(starts_on, ends_on, '[]')` per `branch_id`, `service`) or an API check. |
| C15 | 11 | Overlapping shifts and past midnight | Not outlined. | `PUT .../hours` checks overlap within a day and into the next day; `errors[]` codes `OVERLAP`, `EQUAL_TIMES`, `INVALID_TIME`. |
| C16 | 11 | Shape of `PUT .../hours` | Only "weekly periods per service and special days". | `{ rowVersion, periods[{ service, dayOfWeek, openTime, closeTime }], special[{ startsOn, endsOn, service, isClosed, openTime?, closeTime?, note? }] }`; `closesNextDay` derived by the server. |
| C17 | 11 | Paging special days | Not outlined. | `GET .../hours` pages special days (`page`, `pageSize`), default from today onward; past days hide after 30 days. |
| C18 | 12 | Paths and bodies of delivery zones | "GET, POST, PATCH, DELETE .../delivery-zones" only. | `GET` lists; `POST` and `PATCH .../{zoneId}` take `{ name, radiusM, fee, minOrder, freeOver?, etaMinutes, isActive, rowVersion }`; `DELETE .../{zoneId}`. |
| C19 | 12 | Radius order and duplicates | Only `radius_m > 0`, `fee >= 0`. | New ring larger than the outermost; an edit stays between neighbours (`RADIUS_ORDER`); or unique `(branch_id, radius_m)` and auto-sort. |
| C20 | 12 | Missing checks | No `min_order >= 0`, `free_over > min_order`, `eta_minutes > 0`. | Add the three `CHECK`s (or check in the API and test). |
| C21 | 12 | Last active zone | Checked when delivery is switched on, not when a zone is turned off or deleted. | Refuse while `accepts_delivery` (`VALIDATION_FAILED` `LAST_ACTIVE_ZONE`, or a 409 like `LAST_ADMIN`). |
| C22 | 12 | Deleting a zone that has orders | `orders.delivery_zone_id` is nullable with no `ON DELETE` rule. | `RESTRICT` and `IN_USE` (409); "stop using" is `is_active = false`. |
| C23 | 12 | Concurrent edits | `delivery_zones` has no `row_version`. | Add it or use `branches.row_version`. |
| C24 | 12 | Address check tool | Only the customer quote (`POST /orders/quote`), which needs a basket and a customer login. | `POST /admin/branches/{id}/delivery-zones/check` returns `{ distanceM, zone?, outOfZone }`, stores no coordinates; typing an address needs `/admin/geocode` (phase 2). |
| C25 | 12 | Zone changes in the log | `audit_logs` does not list zones. | Write `delivery_zone.create`, `.update`, `.delete` with old and new diff. |
| C26 | 12 | Realtime | `branch.updated` does not say it includes zones. | Fire it when a zone changes so customer apps refetch their quote. |
| C27 | 12 | Zone count | Not outlined. | Return all (a few rows) with `total`, or cap zones per branch (for example 10). |
| C28 | 13 | Contact link of a branch | Only `phone`; no website column. | `branches.website_url` (https, max 255) or a `branch_contacts` table if the owner wants more kinds; frame 13 draws one optional website link. |
| C29 | 13 | Cover photo in two places | `branches.cover_media_id` and `branch_media.position = 0`. | Keep only `position = 0` (drop `cover_media_id`) or keep both in sync in the API. |
| C30 | 13 | Photo order | No unique `(branch_id, position)`. | The API writes the whole list in one transaction; if a unique constraint is added, `DEFERRABLE INITIALLY DEFERRED`. |
| C31 | 13 | `PATCH /admin/branches/{id}` body for this tab | Outline says "amenities, gallery". | `{ rowVersion, media: [{ mediaId, position }], amenityIds: [], phone, websiteUrl? }`; `media` and `amenityIds` replace the whole list. |
| C32 | 13, R4 | Photo limits and error codes | No count limit, no `alt_text` length, no upload codes. | 12 photos, 200 characters; `errors[].code`: `UNSUPPORTED_TYPE`, `TOO_LARGE`, `LIMIT_REACHED`, `TOO_LONG`. |
| C33 | 13 | Hotline for a manager | `app_settings` is admin-read. | `GET /admin/meta/config` returns `brand.hotline`. |
| C34 | 10, 13 | Phone in two tabs | The phone field is in the info tab (accepts a national number, frame 10) and in this tab (rejects it, frame 13). | Pick one screen to edit it on and one rule for both frames (open question). |

### V. Reviews

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| V1 | 14 | `GET /admin/reviews` | Only "own branches, cursor paging". | Parameters `branchIds[]`, `rating[]`, `status`, `replied`, `from`, `to` (mandatory), `cursor`, `limit`; each item `{ id, branch { id, code }, order { id, orderNumber }, author { displayName }, rating, body, status, reply { text, at, byName }, createdAt, rowVersion }` and `summary { byBranch[{ branchId, average, count }], unreplied, matched }`. |
| V2 | 14 | Deleting a reply | Only `POST .../reply { text }`. | `DELETE /admin/reviews/{id}/reply` (clears `reply_text`, `replied_by`, `replied_at`, audited) or empty text means delete. |
| V3 | 14 | Concurrent edits | `reviews` has no `row_version`; `/status` and `/reply` take none. | Add `reviews.row_version`, send `rowVersion` in both bodies, `409 STALE_VERSION` with the current record. |
| V4 | 14 | Replying to a review that is no longer shown | Not stated. | Refuse with a code (for example `REVIEW_NOT_PUBLISHED`, 409) and draw the button disabled with its reason; or allow and show only on restore. |
| V5 | 14 | Allowed status changes | Only target values listed. | `PUBLISHED` to `HIDDEN` or `REMOVED`; `HIDDEN` to `PUBLISHED` or `REMOVED`; `REMOVED` to `PUBLISHED` (proposed; open question); the same status again is `409` or a no-op. |
| V6 | 14 | Role for `/status` | The role table says staff read only; the API names no role for `/status`. | `manager` and above for `/status` and `/reply`; `STAFF` get `FORBIDDEN`. |
| V7 | 14 | Rating before and after (dialog) | Computed in the browser from the current numbers. | Return the branch `average` and `count` in the result of `/status` (and in the event). |
| V8 | 14 | Audit diff | Shape not stated. | Status: `{ status: { from, to }, note }`; reply (post, edit, delete): `{ replyText: { from, to } }`, audited (today only status changes are certain to be). |
| V9 | 14, 19 | Events for replies | Only `review.created`, `review.status_changed`. | Add `review.replied` (post, edit, delete); `review.status_changed` carries `reviewId`, `status`, `branchId`, actor, `average`, `count`. Keep one status event (not `review.hidden` and `review.removed`). |
| V10 | 14 | Range and size | Not stated. | At most 366 days; `limit` 20, 50 or 100, default 20. |

### E. Users, staff and login

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| E1 | 15 | Display name | `POST` body names `role`, `branchIds[]`; `PATCH` names `role`, `status`, `branchIds[]`. | Add `displayName` to both (the column `users.display_name` exists). |
| E2 | 15 | `GET /admin/users` shape | Only the filters `q`, `role`, `status`. | Add `scope=staff` (or `roles[]`), `branchId`, `page`, `pageSize`; each item `{ id, displayName, email, role, status, branches[{ id, code }], mfa { required, enabled, enabledAt }, lastLoginAt }`. |
| E3 | 15 | Last sign-in | No column. | `users.last_login_at` (set on a successful login), or read from `audit_logs`. |
| E4 | 15 | Concurrent edits | `users` has no `row_version`. | Not drawn (two admins rarely edit one person); add `row_version` and `STALE_VERSION` if needed. |
| E5 | 15 | Definition of `LAST_ADMIN` | Counts `role = ADMIN AND status = ACTIVE`; `WA20` wants at least two admins with MFA. | Decide whether the count includes MFA; the banner `nên có hai quản trị viên` is drawn. |
| E6 | 15 | Role change and sessions | The outline says ending sessions emits `user.suspended` or `session.revoked`. | A role change always revokes all `refresh_tokens` of the person and emits `session.revoked`; a branch change does not (see I1). |
| E7 | 15 | Resetting the password of an invited account | Not stated. | Refuse with `INVALID_STATE` (409) and point to resend invitation, or treat as resend. |
| E8 | 15 | Audit action names for users | Not listed. | `user.create`, `user.role_change`, `user.branch_change`, `user.disable`, `user.enable`, `user.password_reset_send`, each with a before and after diff (see G7 for the 21-code vocabulary). |
| E9 | 15 | MFA reset on someone without MFA | No code. | `409 MFA_NOT_ENABLED` (staff, or a manager or admin who never enrolled). |
| E10 | 15, 21 | Resend invitation | Outline says only "for status `INVITED`". | `409 INVALID_STATE` when no longer invited; rate limit (proposed once per 60 s per person) as `RATE_LIMITED`. |
| E11 | 15, 21 | Email failure reaches the screen | Mail goes through a queue, so the failure is known after the click; nothing tells the page. | Event `email.failed` (recipient, template, `reason`) to the admin viewing the page, or `users.invite_error`; the email log (frame 21) holds the detail. |
| E12 | 15 | Customers in `GET /admin/users` | "Customers appear with masked contact"; no order count, last order or total. | `role=CUSTOMER` rows `{ id, displayName, emailMasked, phoneMasked, status, ordersCount, lastOrderAt }`; search by full email or phone; `total` for the count chip. |
| E13 | 15, 21, R6 | Reveal a customer's contact | No endpoint (frame 03 has none for orders either). | `POST /admin/users/{id}/reveal-contact` writes `audit_logs` (`order.contact_reveal`, entity USER) then returns phone and email in full; lists stay masked; also used by the email log. |
| E14 | 15, 22 | Number of admins with MFA | No endpoint returns it. | Return `activeAdminsWithMfa` in `GET /admin/users` (or `/admin/meta/config`), or `mfaEnabled` per person so the banner is computed in the browser. |
| E15 | 01 | Wrong code counts as a failed login | Not stated. | A wrong password and a wrong TOTP code both add to `users.failed_login_count`; the lock message hides the unlock time, the attempts left and whether password or code caused it. |
| E16 | 01 | Rate-limit figures | Numbers not chosen (ADR-0003 open item 3). | In-process limiter on `/admin/auth/*` plus a per-account counter in Postgres; before more than one API instance runs, move the limit to AWS WAF or Redis. |
| E17 | 01 | Login audit events | Event names not listed. | Log login success and failure, second-step request, code success and failure, temporary lock, password set, logout, refresh-token reuse; never a password, code, token or TOTP secret; an unknown email typed is not logged. Names are proposals. |
| E18 | 01, 22 | Maintenance and staff login | See D5. | Maintenance never blocks `/admin/auth/*`; no `MAINTENANCE` state in the login frame. |
| E19 | 01 | Expired invitation or reset link | No code. | Proposed `CODE_INVALID` (same as a wrong code). |
| E20 | 01 | Recovery codes | The login command said eight, the data model and `WA20` say ten. | Ten single-use codes, warning at three left, a new set required when none are left (needs confirmation). |

### F. Dashboard

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| F1 | 16 | Endpoint | None; `/admin/reports/*` is phase 3 and `FORBIDDEN` for `STAFF`; `orders-summary` is not enough. | `GET /admin/dashboard?branchIds[]=` (staff, phase 1) returns `{ businessDate, window { from, to }, generatedAt, branches[{ branchId, code, status: OK or ERROR, error?, today { total, byStatus{}, completed, cancelled, rejected, cancelledBy{}, avgAcceptSeconds, revenue? }, attention { waiting[], lowStock[], soldOut[], unpaidCompleted, openReports?, unverifiedTags? } }], last7Days[{ businessDate, branchId, orders, revenue }] }`. For `STAFF` omit `revenue`, `last7Days`, `openReports`, `unverifiedTags` entirely (not null). |
| F2 | 16 | Partial failure | The catalogue has one code for a whole request. | Return `200` with `branches[].status = ERROR` and a code for the failing branch (or `207`); allow `branchIds[]=COL` to retry one. |
| F3 | 16 | Windows for "today", cancelled, rejected | `orders.business_date` is set only at `COMPLETED`; in-progress, cancelled and rejected orders have it null. | Use the definitions in the frame's table (in progress = current status; cancelled or rejected = terminal event inside the window); needs partial indexes on `order_status_events (to_status, created_at)` for `CANCELLED`, `REJECTED`, `ACCEPTED` (today only `(order_id, created_at)`); or add `orders.placed_business_date`. |
| F4 | 16 | "Completed but unpaid" | Impossible because of `CHECK (status <> COMPLETED OR payment_status = PAID)`. | Keep it as asked (catches bad data) or replace by useful groups: "ready or out for delivery but unpaid", "transfer not confirmed", "needs refund". Nothing else was drawn. |
| F5 | 16 | Average time to accept | A counter order's first event is `ACCEPTED`, not `PLACED`. | Exclude counter orders from the average; document it in the endpoint. |
| F6 | 16 | "Waiting more than 10 minutes" threshold | `ordering.board_thresholds` is a placeholder (warn 5, late 10). | The screen uses the late threshold and takes the number from `/admin/meta/config`; confirm the warn threshold is not used. |
| F7 | 16 | Low stock with no threshold | `low_stock_threshold` is nullable. | A null threshold never means "low" (only "sold out" at 0). |
| F8 | 16 | Review-report group in phase 1 | `review_reports` and `/admin/reports` are phase 2. | Hide the group until the feature is on; the API returns `openReports` only when it is. |
| F9 | 16 | Server errors | No stable code for a generic 5xx. | Add `INTERNAL_ERROR` (500) so the screen can tell "server error" from "network lost". |
| F10 | 16 | Realtime for the dashboard | No dedicated event. | None; existing events trigger a refetch with a few seconds' debounce at the client; `stock.low` reaches branch managers only, so `STAFF` rely on `menu.availability_changed` and the refetch cycle. |

### G. Audit log

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| G1 | 17 | Action names | `audit_logs.action` is not listed (the model names only what must be logged). | Adopt the 21 codes of board 4 as the catalogue, shared between server and UI, with Vietnamese labels kept by the UI. **Naming convention (decided 2026-10-30, follows frame 17): lower case `group.verb`, an underscore only inside the verb** (`user.role_change`, `order.contact_reveal`, `settings.change`); every action named in other rows follows it (`user.disable`, `user.enable`, `menu.overwrite`, `branch.location_confirm`, `report.decision`, `delivery_zone.create`, `reservation.edit`, `promotion.create`). |
| G2 | 17 | Entity types | Not listed. | Eight values drawn in frame 17: `ORDER`, `MENU_ITEM`, `VOUCHER`, `USER`, `REVIEW`, `BRANCH`, `APP_SETTINGS`, `EXPORT_JOB`. Four more are needed by later rows and are proposals (frame 17's filter has to list them): `RESERVATION` (P27), `PROMOTION` (M23), `REVIEW_REPORT` (V18), `DELIVERY_ZONE` (C25). |
| G3 | 17 | `GET /admin/audit-logs` | Only "cursor paging; manager sees their branches". | Parameters `branchIds[]`, `actorId`, `entityType`, `actions[]`, `from`, `to` (mandatory), `cursor`, `limit`; each item `{ id, createdAt, actor { id, displayName, role } or null, action, entityType, entityId, entityLabel, branch { id, code } or null, diff }`; returns `nextCursor`. |
| G4 | 17 | Readable object name | A row has only `entity_type` and `entity_id`. | Server returns `entityLabel` (order number, item name, email) and `entityExists`; store the label at write time so the row stays readable after deletion. |
| G5 | 17 | Managers and rows with no branch | "Manager sees their branches". | A manager sees only rows whose `branch_id` is theirs; null-branch rows are admin only. Branch-specific prices, stock, sold out, pause, reviews, order contact reveals and single-branch exports must be written with `branch_id`. |
| G6 | 17, 18 | Index | Present: `(entity_type, entity_id, created_at)`, `(branch_id, created_at DESC)`, `(actor_user_id, created_at)`. | Add `(created_at DESC, id DESC)` for date-range-only queries. |
| G7 | 17 | Actions missing from the code list | Actions the UI offers have no code. | Restore review (`review.restore`), re-enable account (`user.enable`), resend password or invitation, mark `REFUNDED` (now merged into `order.payment_confirm`), reject order (now merged into `order.cancel`), create and delete branch, change bank account. Decide names or merge. |
| G8 | 17 | Value formatting | The server stores the raw `diff`. | UI keeps a per-field formatter table (money, yes/no, on/off, code, duration, date time); the server needs a list of sensitive fields (password, code, token, account number, contact) stripped before writing. |
| G9 | 17 | Count | No count endpoint. | Return `estimatedTotal` (approximate, from table statistics) for the chip "about N". |

### H. Big lists, indexes and search

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| H1 | 18 | Reviews list index | `(branch_id, created_at DESC)` covers `PUBLISHED` rows only; the admin list also needs `HIDDEN` and `REMOVED`. | Unconditional `(branch_id, created_at DESC, id DESC)` or drop the `PUBLISHED` condition. |
| H2 | 18 | Customer search by email or name | `users.email` has only the unique constraint (no middle-of-string search), the name has no index, and no index is listed for `users`. | GIN trigram on `unaccent(email)` and `unaccent(display_name)` once the customers tab is big. |
| H3 | 18 | Item search for selects | See B2. | `q`, `limit`, `ids[]`. |
| H4 | 18 | Bad cursor | No error code. | `VALIDATION_FAILED` with `errors[].code = INVALID_CURSOR` (400); the UI returns to page 1. |
| H5 | 18 | Review-report queue | Outline lists only the list and decisions. | `status`, `reason`, `page`, `pageSize`, `total` (phase 2). |

### I. Realtime

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| I1 | 19 | Changing a person's branches | Not stated. | The person's channel (rooms by branch) must be rebuilt, or the server sends `session.revoked` with a reason; frame 15 says a branch change does not end the session. |
| I2 | 19 | Presence ("being viewed") | No event in api-outline. | Add `presence.changed` (memory only, audience: people with the same record open) or drop the dot in board 3. |
| I3 | 19 | `config.changed` on the admin web | Public audience, content undefined. | Admin web only refetches `GET /admin/meta/config` (maintenance blocks customers only, decided in W13B). |
| I4 | 19 | Connection state | Frame 00 describes a dot per channel. | Lost after two cycles with no data; `Cập nhật lúc` is the last data received (event or refetch). |
| I5 | 19, 22 | Refetch wording | See D6. | Follow api-outline: refetch each cycle while the board is open. |
| I6 | 19 | Review event names | api-outline uses `review.status_changed`; the old frame used `review.hidden` and `review.removed`. | Keep `review.status_changed` (one event; the state is in the reloaded data). |

### J. Exports and statistics

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| J1 | 20 | `VOUCHERS` | In `export_jobs.resource`, not in the outline's `POST /admin/exports`. | Add to the file types (phase 2); a manager exports only vouchers with their own `branch_id`. |
| J2 | 20 | Shape of `POST /admin/exports` | Only `{ resource: REVENUE, from, to, branchId? }`. | `{ resource, format, filters, columns?, maskContact, reason? }`; `filters` are the list's own parameters. |
| J3 | 20 | Chosen columns | `export_jobs` has no column for them. | `columns jsonb` (or inside `filters`) so "Tạo lại" repeats the same columns. |
| J4 | 20, 27 | Progress while generating | Only `status` and `row_count` at the end. | The UI shows no percentage. Add `progress` or a progress event if wanted (the statistics file is small, so not proposed). |
| J5 | 20, 27 | Reason to unmask | The model requires a reason only for `USERS`, `AUDIT_LOGS`, `ORDERS` with contact. | Apply to every file with a phone or address (`RESERVATIONS`, `REVENUE`); `maskContact` (default true) and `reason` (required when false), `VALIDATION_FAILED` otherwise; write `audit_logs` with the filters and reason. |
| J6 | 20 | Too many rows, too many jobs | No codes. | `VALIDATION_FAILED` `TOO_MANY_ROWS`; `RATE_LIMITED` for more than two concurrent jobs. |
| J7 | 20 | Downloading an expired file | No code. | `404 NOT_FOUND` (file deleted) or `410`; the UI offers `Tạo lại`. |
| J8 | 20 | Missing `Xuất` buttons | Frames 15 (users) and 08 (stock) have none. | Add next to the page title (users: admin only); not changed in those frames. |
| J9 | 20 | Audit export phase | The audit screen is phase 2; `AUDIT_LOGS` is in the enum. | The audit `Xuất` button is phase 2 with reservations and vouchers. |
| J10 | 27 | Read API for cards and preview | Phase 1 has only `POST /admin/exports`; `GET /admin/reports/revenue` is phase 3. | Move one read endpoint to phase 1: `GET /admin/reports/revenue?from&to&branchIds[]&page&pageSize` returns `{ businessDayStartsAt, summary { orders, subtotal, discounts, deliveryFees, total, cash, transfer, cancelled, needsRefundCount, needsRefundAmount }, yearToDate { from, to, total }, rows[], totals }`, using the same query as the Excel file. |
| J11 | 27 | Several branches | The outline has `branchId?` (one). | `branchIds[]` (default: all the caller's branches) for both the GET and `POST /admin/exports`. |
| J12 | 27 | Date of a cancelled or refunded order | `business_date` is set at completion only. | The business date of the cancel event (from `order_status_events`), or add `orders.closed_business_date`; the cancel-and-refund sheet needs the same rule. |
| J13 | 27 | Business-day start for managers | `app_settings` is admin-read. | `GET /admin/meta/config` returns `reports.businessDayStartsAt` so the rule line is right. |
| J14 | 27 | Year-to-date revenue | Only in the `Tổng năm` sheet. | Return it in the same endpoint (01/01 to the last ended business day, for the chosen branches). |
| J15 | 27 | Range and preview size | Not stated. | At most 366 days; preview paged at 20 rows (up to 366 times the number of branches); the full file is Excel. |
| J16 | 27 | "This week" and time zone | Not stated. | The browser computes dates in Vietnam time (week starts Monday) and sends `from`, `to`; the server takes no preset names. |
| J17 | 27 | Choosing sheets | Body has no sheet list. | `sheets[]` (`DAILY`, `ITEMS`, `ORDERS`, `CANCELLATIONS`, `YEAR`; default all; `DAILY` always) stored in `export_jobs.filters`. |
| J18 | 27 | Reading one export | Only `GET /admin/exports/{id}/download`. | `GET /admin/exports/{id}` returns `{ id, status, resource, filters, rowCount, bytes, errorCode, createdAt, finishedAt, expiresAt }` for the dialog and for a late `export.ready`. |
| J19 | 27 | Failure code | `export_jobs.error_code` exists; no list. | One code (for example `EXPORT_FAILED`) or a few; the screen says only "Không tạo được tệp" and the time. |
| J20 | 27 | File lifetime | `expires_at` plus "delete 7 days after `expires_at`" can read as 14 days. | `expires_at = created + 7 days`, file deleted right after, so "kept 7 days" is true. |
| J21 | 27 | Dine-in in the files | `orders.type` has no `DINE_IN` (A1). | Order-detail sheet shows `Ăn tại quán`; a counter order without a customer shows `Khách tại quầy` and no phone. |

### K. System email

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| K1 | 21 | Suppression list | `email_suppressions` exists; no screen or API to list, add (`MANUAL`) or lift an address. | `GET/POST/DELETE /admin/email-suppressions`; today the only way out is to correct the account email. |
| K2 | 21 | Variables of each template | No document describes them; the data model stores only `subject`, `body_html`, `body_text`. | The variable table in frame 21's spec is a proposal (for example `displayName`, `invitedBy`, `role`, `appName`, `expiresIn`, `actionUrl`, `code`, `actorName`, `resetAt`); required placeholders are the link or the code. |
| K3 | 21 | Who requested a message | `email_messages` has no requester. | The log does not show "by whom"; read it from `audit_logs` if needed, or add `requested_by`. |
| K4 | 21 | Test send | Not stated whether it is logged. | Open question: does a test send write an `email_messages` row? |
| K5 | 21 | Resend rules | See E10. | Resend only staff mail in `FAILED`, once per 60 s per recipient, disabled while suppressed. |
| K6 | 21 | Searching the log by customer address | Addresses are masked. | Customers must be searched by the full address (so the search box is not a way to probe addresses). |
| K7 | 21 | Export of the email log | No export file type. | None; the screen has no `Xuất` button. |

### L. Settings

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| L1 | 22 | `PUT /admin/app-settings` and conflicts | `app_settings` has `key`, `value`, `updated_by`, `updated_at` and no `row_version`, although every editable record carries one. | Add `row_version` per key; `GET` returns `{ brand: { value, rowVersion, updatedBy, updatedAt }, ordering: {...} }`; `PUT { key, value, rowVersion }` one key at a time (or `PUT /admin/app-settings/{key}`); `409 STALE_VERSION` carries the current value, editor and time for `Xem thay đổi`. |
| L2 | 22 | Per-field error codes | Only the `errors[] { field, code, message }` shape. | `REQUIRED`, `TOO_LONG`, `OUT_OF_RANGE`, `INVALID_PHONE`, `INVALID_EMAIL`, `INVALID_TAX_CODE`, `MUST_BE_LESS_THAN_LATE`, `MUST_EXCEED_ACCEPT_LATE`; `field` is the full path (`ordering.board_thresholds.accept.warn`). |
| L3 | 22 | Defaults of five `ordering` keys | `WA16` fixes the board clock thresholds, refetch, call hint and auto-cancel off; nothing gives the maximum quantity, basket lines, earliest and latest scheduled time, review window. | Proposed 20, 30 lines, 30 minutes, 3 days, 7 days; owner confirms, then write into the data model and ADR (`WA16`). |
| L4 | 22 | `board_thresholds` shape | Only described in words. | `{ accept: { warn, late }, ready: { warn, late } }`; `ready` means "preparing until ready", shown as `Đang chuẩn bị`. |
| L5 | 22 | Logo upload | `POST /admin/uploads/images` exists for branch photos; nothing about logos. | Same path; PNG, JPEG, WebP, at most 2 MB, at least 256 px, no SVG; `brand.logo` stores the file id and `/meta/config` returns `logoUrl`. |
| L6 | 22 | Tax code rule | `brand.tax_code` is "optional tax code". | 10 or 13 digits, digits only (13 = dependent unit); printed only when `show_tax_code` is true and a code exists. |
| L7 | 22 | Receipt text lengths | Not stated. | Title at most 40 characters; message at most 200 characters and 4 lines; `GET /admin/orders/{id}/receipt` returns the normalised strings. |
| L8 | 22 | Auto-cancel semantics | Only `auto_cancel_unaccepted_minutes` and `cancelled_by = SYSTEM`. | Decide: counted from `placed_at` or from the scheduled time; the job interval; how the customer is told (email, push); the `cancel_reason` constant ("Quán không xác nhận kịp"); the event row has `actor_user_id` null and a `note`; it must exceed the late threshold. |
| L9 | 22 | Content of `config.changed` | Public event, no payload stated. | Carry `keys[]` (for example `maintenance`, `minAppVersion`, `featureFlags`) and a version, never values or the editor; the customer app refetches the relevant part and shows the maintenance or update screen; the settings page reloads the changed section. |
| L10 | 22 | Audit of settings | Not listed. | `action = settings.change`, `entity_type = app_settings`, `entity_id` = key, before and after diff (secret values removed). |
| L11 | 22 | `brand.business_address` | In the model, but the receipt uses the branch address. | Decide where it is used (email, legal page) or put it on the receipt next to the tax code if the accountant asks. |
| L12 | 22 | Minimum app version per OS | `GET /meta/config` returns one `minAppVersion`. | `minAppVersion { ios, android }` (x.y.z); the server compares with `X-App-Version`; `UPGRADE_REQUIRED` carries the store URL. |
| L13 | 22, 01 | Shape and scope of `maintenance` | Only "maintenance". | `maintenance { enabled, message, expectedBackAt, since }`, blocking customer-facing paths only; if so remove the `MAINTENANCE` state from admin screens (or rename it "server under technical maintenance"). See D5. |
| L14 | 22 | Re-authentication for a sensitive change | No step-up. | `POST /admin/auth/step-up { code }` returns a short-lived token sent with the `PUT` of the `payment` key; audit the last 5 digits and email the other admins. If the owner declines, drop the code field of the confirm dialog. |
| L15 | 22 | Read-only security section | Token lifetime, sessions and password rules are server config and ADR, not an API. | Read-only block `security { totpRequiredRoles, staffPasswordMinLength, accessTokenMinutes, sessionIdleDays, sessionAbsoluteDays, inviteHours, resetMinutes }` in `GET /admin/app-settings` (not accepted by `PUT`). Token lifetime is still ADR-0003 open item 3. |
| L16 | 22 | Loyalty in two places | The API has `/admin/settings/loyalty` (phase 2) and `app_settings` has a `loyalty` key. | Keep `/admin/settings/loyalty` as the entry and `app_settings.loyalty` as the storage; the Settings page calls the entry for section 7. |
| L17 | 22 | Moving the business-day start later | The model says `business_date` is written once at completion. | The dashboard's "today" window is recomputed from the current cut and may move back a day (warning in board 18); or allow the change only with no orders in progress (open question). |
| L18 | 22 | `featureFlags.einvoice` in api-outline | The key was named against `WA17`. | Keep it, **false by default**: `features.einvoice` in `GET /admin/meta/config` (Z3) and `featureFlags.einvoice` in `/admin/app-settings` only once e-invoices are enabled. Settings (frame 22) draws no such flag (D8). |

### Z. App shell: sidebar, branch switcher, counts, access (frames 00 and every shell)

The proposed solution for these rows is written in [docs/admin-shell-design.md](../../docs/admin-shell-design.md); its five open points were decided on 2026-10-30 (permission keys rather than roles, a separate `nav-counts` endpoint, no invoice event for now, selection not synced between devices, working names for keys and flags). Its rows were folded into `data-model.md` and `api-outline.md` on 2026-10-30 as proposals (see [gaps-coverage.md](gaps-coverage.md)).

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| Z1 | 00, all | Shape of `GET /admin/meta/config` | The outline lists the content ("the caller's role and branches, thresholds, feature flags") but not the response shape. | `{ user { id, displayName, role, mfaEnabled }, branches[{ id, code, name, status }], permissions[], features{}, ordering { boardThresholds, boardRefetchSeconds }, brand { hotline, receipt { paperWidth } }, reports { businessDayStartsAt }, maintenance, navCountsRefetchSeconds }`; refetched after `config.changed` and after any `FORBIDDEN`. |
| Z2 | 00, all | Capability list for the menu and the route guards | The role matrix exists only in `03-ia-roles-components.md` and frame 00; the client would have to repeat it. | `permissions[]` computed by the server from role and feature flags (for example `orders.read`, `menu.write`, `reports.read`, `invoices.manage`); each menu item and route names the key it needs. Owner or engineers fix the key list. |
| Z3 | 00, 23, 25, 26, 27, 28 | Feature flags for sidebar items | `featureFlags` has `ordering`, `delivery`, `reservations`, `loyalty`; nothing for vouchers, banners, charts or `einvoice` (named only in the deferred section). | Add `vouchers`, `promotions`, `charts` and `einvoice` to `features`; an item whose flag is off is not rendered. |
| Z4 | 00, 02, 14, 28 | Counts next to `Đơn hàng`, `Đánh giá`, `Hóa đơn` | No endpoint returns them; only the event `order.placed` says "count in the sidebar" (and A28, F8 mention counters). | `GET /admin/nav-counts?branchIds[]=` returns `{ generatedAt, newOrders, openReports?, overdueInvoices? }` (three indexed counts, no row data); `openReports` omitted for `STAFF` and when phase 2 is off; refetch on the realtime events (debounced) and on a timer as the fallback. |
| Z5 | 00, 02 | Branch switcher with several branches | Endpoints take `branchId?` (one id). | `branchIds[]` on every list and count endpoint (merges A29, V1, R5, F1); an id outside the caller's branches is `404`; no parameter means all the caller's branches. |
| Z6 | 00 | Where the branch selection lives | Not stated. | The URL query (`?b=BT,COL`) per page and `localStorage` for the default; nothing stored on the server; ids not in `meta.branches` are dropped at start-up. Not synced between devices (decided 2026-10-30). |
| Z7 | 00 | Access changing under an open page | Frame 00 draws the behaviour (denied page, no error toast); the API contract is only `FORBIDDEN`, `user.suspended`, `session.revoked`, `config.changed`. | On `FORBIDDEN` refetch `meta/config`; if `permissions` changed rebuild the menu and show the denied page for the current route; `user.suspended` and `session.revoked` sign out at once. |
| Z8 | 00, 28 | Design-only labels on the sidebar | The frames show `GĐ1`, `GĐ2`, `GĐ3`, `Admin`, `Chưa bật` next to items. | These are design notes; the product shows none of them. Add the `Hóa đơn` item (N15) to `03-ia-roles-components.md` when e-invoices are enabled. |
| Z9 | 00, 01 | Silent token refresh in the admin web | ADR-0003 and the outline fix the cookie transport but not the concurrency rule. | One refresh at a time (all waiting requests share it); a failed refresh returns to login and keeps the unsent form in memory; a `TOKEN_EXPIRED` is retried once. |

### Phase 2, 3 and deferred frames (added 2026-10-30)

Collected from the gap table at the bottom of frames 14 (second spec, W09B), 23 to 28 (W14A to W14D, W15C part B, W17). In each source table the last row "Dữ liệu minh họa của em" (the invented data) is not a gap; it is listed under "Added sample data" below. As above, these rows were folded into `data-model.md` and `api-outline.md` on 2026-10-30 as proposals (see [gaps-coverage.md](gaps-coverage.md)). In code spans, a vertical bar between alternatives is written "or" so the tables stay valid.

#### V (continued). Reviews, reports tab (frame 14, W09B)

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| V11 | 14 | Body and result of `POST /admin/reports/{id}/decision` | Only "decision with a required note" is outlined. | Body `{ decision: DISMISS or HIDE or REMOVE, note (1–500), applyToSameTarget (default true) }`; returns `{ report, closedIds[], review { id, status }, branch { average, count } }` so the dialog, the score card and the notice are always right. |
| V12 | 14 | Parameters and shape of `GET /admin/reports` | Only "Reported reviews" is outlined. | Add `status` (`OPEN` by default, `CLOSED` = ACTIONED + DISMISSED, `ALL`), `reason`, `branchIds[]`, `cursor`, `limit`. Each item returns `{ id, reason, details, status, createdAt, reporter { displayName }, review { id, status, rating, body, author { displayName }, branch { code }, order { orderNumber }, createdAt }, sameReviewOpenCount, decision?, resolvedBy?, resolvedAt?, resolutionNote? }`, and `openCount` for the number on the tab. |
| V13 | 14 | The chosen decision is not stored | `review_reports` has only `status` (`ACTIONED` / `DISMISSED`); Hide or Remove can only be inferred from the review's current status, and that status can change. | Add the column `review_reports.decision` (`DISMISS`, `HIDE` or `REMOVE`; empty until handled), or read it from `audit_logs.diff`. |
| V14 | 14 | `IN_REVIEW` | Still in the enum of `review_reports.status`. | Remove it from the enum (no screen exists to open one), or keep it unused. The interface never sets or filters this value. |
| V15 | 14 | Conflict when two people handle a report at the same time | `review_reports` has no `row_version`; the decision takes no `rowVersion`. | A `WHERE status = OPEN` condition in the update statement; if no row changes, `409 STALE_VERSION` with who handled it and when; or add `row_version` as in the other tables. |
| V16 | 14 | Branch of a report | `review_reports` has no `branch_id`. | Filtering by branch must join `reviews`; needs an index `(status, created_at)` and a fast join through `review_id`, or add a copied `branch_id` to scan by scope and so that `report.created` carries a `branchId`. |
| V17 | 14 | Length of the resolution note | No limit stated for `resolution_note`. | At most 500 characters (proposed, equal to `details`). |
| V18 | 14 | Audit entry of a report | `audit_logs` does not list a report action. | Add `report.decision` (`entity_type = review_report`) with `diff { decision, note, reviewStatus { from, to }, appliedTo[] }`. |
| V19 | 14 | Events `report.created`, `report.resolved` | Named, with no payload; audience "Managers". | Carry `reportId`, `reviewId`, `branchId`, `status`, `openCount` and (for resolved) the actor, the decision and `closedIds[]`; carry no customer text (no personal data, as in `outbox_events`). |
| V20 | 14 | Reporting a review that is no longer shown | `POST /reports` does not say. | Refuse when the review is already Hidden or Removed (an old customer page may still show it), or accept it and queue it as usual; the frame proposes refusing with a code (for example `REVIEW_NOT_PUBLISHED`) so the queue does not fill with pointless reports. |
| V21 | 14 | Role for `/admin/reports*` | The role table only says "Reviews: read, hide, remove, reply". | State `manager` and above for both endpoints; `STAFF` get `FORBIDDEN` (and their sidebar has no count). |
| V22 | 14 | New labels for frame 00 | The label table has review statuses but no report reasons and no report statuses. | Add Spam · Xúc phạm · Sai thông tin · Khác and Mở · Đã xử lý · Đã bỏ qua, one pill per value. |
| V23 | 14 | Not aligned in W09A (not fixed in this command) | Board 2 draws 1 report in the sidebar and 3 on the Reviews tab for the Bến Thành manager, although the only open report belongs to COL; board 3 draws a locked Reports tab for Staff. | Fix in the W09A review round if the owner agrees: Bến Thành 0 reports, Reviews tab 2; Staff have no Reports tab. |

#### P. Reservations and tables (frames 23, 24)

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| P1 | 23 | Parameters and shape of `GET /admin/reservations` | Only "calendar by branchId, date range, status" is outlined. | Add `q`, `cursor`, `limit`; each item returns `{ id, reservedAt, durationMinutes, partySize, status, contactName, contactPhone (masked), note, declineReason?, tables[ { id, name, seats } ], customer { id, displayName }?, createdAt, rowVersion }` and `counts { byStatus }` for the title and the sidebar. |
| P2 | 23 | Body of `POST /admin/reservations/{id}/transition` | Has `to`, `tableIds?`, `declineReason?`, `rowVersion`. | State the transition table; `tableIds` required when `CONFIRMED`; `declineReason` required (1 to 200) when `DECLINED`; return the new reservation with its tables. `SLOT_UNAVAILABLE` returns `conflicts[ { tableId, reservationId, from, to } ]` so the dialog names the right table. |
| P3 | 23 | Status history | `reservations` has only `status`, `updated_at`. | Add `reservation_status_events` (`reservation_id`, `from_status`, `to_status`, `actor_user_id`, `note`, `created_at`) like `order_status_events`. |
| P4 | 23 | Revealing the guest's phone number | Does not exist. | `POST /admin/reservations/{id}/reveal-contact`; `GET` returns only the masked number; each reveal writes one `audit_logs` row. |
| P5 | 23 | Changing the table after confirmation | Tables are assigned only at confirmation. | `PATCH /admin/reservations/{id}/tables { tableIds, rowVersion }` with the same capacity and time-overlap checks (the guest changes their mind, a table breaks, tables are joined). |
| P6 | 23 | Staff cancel or decline a confirmed reservation | `to` has no `CANCELLED`; `DECLINED` is valid only from `PENDING`. | If a guest phones to cancel, staff cannot do anything. Proposal: allow `CONFIRMED` to `CANCELLED` by staff with a reason; the guest sees "Đã hủy". |
| P7 | 23 | Staff create a reservation (phone, walk-in guest) | Only the guest creates one (`POST /reservations`). | Proposed `POST /admin/reservations` (status `CONFIRMED` at once, with tables, `customer_id` may be empty). The `Thêm đặt bàn` button is drawn in frame 23 (see P28). |
| P8 | 23 | Free tables by time slot | Only `GET /branches/{id}/reservation-slots` exists, for guests. | `GET /admin/reservations/availability?branchId&reservedAt&durationMinutes` returns each table as `FREE` or `BUSY { reservation, from, to }`, or derive it in the client from the day's calendar. |
| P9 | 23 | Joining adjacent tables | `restaurant_tables` has no position or group. | Add `area` used as the joining group, or `joinable_with`; otherwise capacity is only the sum of seats and the person seating takes the responsibility (board 7). |
| P10 | 23 | A table with guests ordering at the table | `orders.table_label` (a gap from W04F) is separate from `restaurant_tables`. | Not linked: table B3 has order `BT-261027-0047` at 12:07 but the reservation calendar does not see it. The owner must decide whether to link the table label to `restaurant_tables`. |
| P11 | 23 | Times for Đã đến and Không đến; waiting limit of a request | Not stated. | Settings: how many minutes before the reserved time Đã đến opens (30), how many minutes after it Không đến opens (15), the warning thresholds for a waiting request (15, 30), and whether an unconfirmed request expires by itself. |
| P12 | 23 | Display code of a reservation | `reservations.id` is a uuid. | The sample uses a short string such as `#4b7c1e`; if it must be read over the phone, add a number such as `BT-261027-R03` (gap). |
| P13 | 23 | Event payloads | `reservation.requested` and `reservation.status_changed` are named, with no payload. | Carry `reservationId`, `branchId`, `status`, `tableIds[]`, `rowVersion` and the actor; carry no name or phone number. |
| P14 | 23 | Branch that does not accept reservations | `branches.accepts_reservations`. | The page stays open for roles that may use it and says the service is off (board 15); `GET /admin/reservations` returns an empty list, or a dedicated code. |
| P15 | 24 | Shape of `/admin/branches/{id}/tables` | Only "Tables and seats", phase 2, is outlined. | GET (`isActive`, `area`, `q`, `page`, `pageSize`) returns `{ id, name, seats, area, isActive, holdingCount, seatedNow }`; POST `{ name, seats, area? }`; PATCH `{ name?, seats?, area?, isActive? }`; DELETE. `IN_USE` carries `reservations[ { id, reservedAt, durationMinutes, partySize, status, contactName } ]`. |
| P16 | 24 | Conflict when two people edit a table | `restaurant_tables` has no `row_version`. | Add `row_version` (and `rowVersion` in PATCH), or accept "last writer wins" because tables are rarely edited. |
| P17 | 24 | Order of tables | No `sort_order`. | Sort by name in numeric order; if tables should follow the floor plan, add `sort_order`. |
| P18 | 24 | Rules live in two places | Frame 10 (Branches › Info) has a dimmed "Quy tắc đặt bàn" block with the label "Số khách tối đa mỗi bàn đặt". | Edit only in frame 24; frame 10 only shows the values and links here. The column `reservation_max_party` is per reservation, not per table (change the label). Frame 10 is already approved, so it is not changed in this command. |
| P19 | 24 | What `reservation_slot_minutes` means | The model has `reservation_slot_minutes` and `reservations.duration_minutes`; frame 10 calls it "length of one booking". | The sample reservations have odd start times (12:30, 18:30), so it is not the start-time step. Proposal: split into `reservation_duration_minutes` (90) and `reservation_slot_step_minutes` (start-time step, 15 or 30). |
| P20 | 24 | One `rowVersion` for the branch and its rules | The rules are saved by `PATCH /admin/branches/{id}`. | Editing the rules can collide with someone editing the branch info (`STALE_VERSION`). Accept it, or split an endpoint `PATCH /admin/branches/{id}/reservation-rules`. |
| P21 | 24 | Value limits | Not stated. | Duration 30–240 (step 15), guests from 1 to the total of active seats, lead time 0–1.440 minutes, at most 1–90 days ahead; table name 1–20 characters, seats 1–20, area ≤ 40. |
| P22 | 24 | Area | `area` is free text. | Free text with suggestions, or a fixed list of areas per branch. If tables are to be joined by area, an extra rule is needed (see W14A, P9). |
| P23 | 24 | Count of reservations being held | Not in GET. | Count on the server (`holdingCount`) so the column "Đang giữ / sắp tới" and the Tắt button do not have to load the whole calendar. |
| P24 | 24 | Events | Only `branch.updated` (Manager) exists. | Changing a table or a rule should make colleagues' reservation calendars reload; use `branch.updated` or add `tables.changed` for staff. |
| P25 | 24 | Navigation | The Đặt bàn item has no sub-items. | Add two sub-items "Lịch đặt bàn" and "Bàn và quy tắc" (only Manager and Admin see the second). Frame 23 does not draw them yet (still open after the W16A re-run). |
| P26 | 23 | Reservation search for check-in | `GET /admin/reservations` has `q` only as a proposal (P1) and customer phone numbers are masked, so staff cannot find a guest by phone. | `q` matches `contact_name` (case and diacritics insensitive), the **last three digits** of the phone (add `reservations.contact_phone_last4`, stored or generated, indexed) and the display code (P12); default range yesterday to 14 days ahead for the selected branch (`from`, `to` overridable); at most 8 rows, `Xem tất cả` keeps `q` in the list. `RATE_LIMITED` for fast typing; no match is `200` with an empty list. Staff of the branch only; an admin on "all branches" searches every branch (proposal, still open: question 84). Reverses the earlier rule "no phone search because the number is masked" (W14A). |
| P27 | 23 | Edit a reservation for the guest | Only status transitions and table assignment exist; nothing edits time, party size, duration, contact or note. | `PATCH /admin/reservations/{id} { reservedAt?, durationMinutes?, partySize?, tableIds?, contactName?, contactPhone?, note?, reason, rowVersion }` for `MANAGER` (own branch) and `ADMIN`; `STAFF` get `FORBIDDEN`. Only while `PENDING` or `CONFIRMED`; the status does not change. Same validation as confirming (opening hours, max party, capacity, `SLOT_UNAVAILABLE`); the minimum lead time is ignored for staff. Writes `audit_logs` (new action `reservation.edit` for the catalogue in G1 and a new entity type `RESERVATION` in G2) with before and after and the reason; emits `reservation.updated` (new event) so open calendars and the guest's app reload. Changing `contactPhone` needs the audited reveal first. |
| P28 | 23 | Reservation entered by staff | `POST /admin/reservations` is only a proposal and there is no way to tell an app reservation from a phone one; `customer_id` is required. | `reservations.source` (`APP` \| `PHONE` \| `COUNTER`), `created_by`, `customer_id` nullable for a walk-in guest (name and phone are snapshots already); created `CONFIRMED` when tables are given, otherwise `PENDING`; `Idempotency-Key` as for app reservations. Open (question 85): whether `STAFF` may add (frame 23 lets them; editing is manager and admin only). |

#### M. Vouchers, banners and loyalty (frames 25, 26)

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| M1 | 25 | Shape of `/admin/vouchers` | Only "Code, type, value, limits, validity, branch, audience; `rowVersion`; usage counts" is outlined. | GET (`status`, `branchId`, `audience`, `q`, `page`, `pageSize`) returns `{ id, code, title, discountType, discountValue, maxDiscount, minOrder, appliesTo, branch, audience, assignedCount, startsAt, endsAt, usageLimitTotal, usageLimitPerUser, redeemedCount, isActive, status, rowVersion }`; `status` is derived on the server. |
| M2 | 25 | Redemptions of one voucher | No endpoint reads `voucher_redemptions`. | `GET /admin/vouchers/{id}/redemptions` (paged) returns `{ createdAt, order { id, orderNumber, subtotal }, customer { displayName }, amount, reversedAt, reversalReason }` and `summary { used, totalAmount, reversed }`. |
| M3 | 25 | Customers a voucher is assigned to | Only `POST …/assign` exists. | `GET /admin/vouchers/{id}/assignments` (paged); `DELETE /admin/vouchers/{id}/assignments/{userId}` to revoke (not yet used); assign body `{ userIds[] }`. |
| M4 | 25 | Who assigned, who edited | `voucher_assignments` and `vouchers` have no creator. | Write to `audit_logs` (it already lists "voucher edits"); add `created_by` if it must be shown. |
| M5 | 25 | Locking the code after redemption | No rule for changing a code. | Lock when `redeemed_count + reversals > 0` or any `voucher_assignments` exist; `orders.voucher_code` is already a snapshot, so changing the code does not break history, it only confuses guests who saved the code. |
| M6 | 25 | Deleting a voucher | The API has only GET, POST, PATCH. | Keep it that way: switch off only. A voucher with no redemption could be allowed `DELETE` if the owner wants to clean up. |
| M7 | 25 | Value limits | Not stated. | Code 4 to 20 upper-case letters and digits; title ≤ 60; fixed discount ≥ 1.000đ; minimum order ≥ 0; uses ≥ 1. The values are proposals. |
| M8 | 25 | "Hết lượt" voucher and reversing a use | Reversing a use when an order is cancelled makes the voucher live again. | The derived status must read the number of rows not reversed, not the old `redeemed_count`; shown by server time. |
| M9 | 25 | Vouchers and loyalty points | Points are earned on the subtotal after the voucher (data-model). | Say so in the preview and in the documents: points are not earned on the discounted part. There is no points example in the form yet (frame 26). |
| M10 | 25 | Vouchers in the customer's wallet | `GET /me/vouchers` exists, its shape is not stated. | Each card needs `title`, `code`, `discount*`, `minOrder`, `appliesTo`, `branch`, `endsAt`, `state` (`USABLE`, `BELOW_MIN`, `EXPIRED`, `USED`). |
| M11 | 25 | Events | There is no voucher event. | Could add `voucher.updated` so the customer's wallet reloads; today it reloads only when the screen opens. |
| M12 | 26 | Shape of `/admin/promotions` | Only "Home banners" (GET, POST, PATCH, DELETE) is outlined. | GET (`status`, `q`, `page`, `pageSize`) returns `{ id, title, body, media { id, url, altText } or null, linkType, linkTarget, linkLabel, linkState, startsAt, endsAt, sortOrder, isActive, status, rowVersion }`; `status` derived on the server; `linkLabel` and `linkState` (`OK`, `INACTIVE`, `MISSING`) so the list and the editor can warn. |
| M13 | 26 | Concurrent edits | `promotions` has no `row_version`. | Add `row_version`; PATCH takes `rowVersion` and returns `STALE_VERSION` on mismatch (as for vouchers). Without it, the later save overwrites the earlier one. |
| M14 | 26 | Reordering | No endpoint reorders in bulk. | `PUT /admin/promotions/order { ids[] }` (one transaction, reassign `sort_order` 1..N) instead of two PATCH calls that can drift; or a unique constraint on `sort_order`. |
| M15 | 26 | Banner constraints | No `CHECK`. | `CHECK (ends_at > starts_at)`; `link_type = NONE` implies `link_target IS NULL`; title ≤ 60, body ≤ 140 (proposed); `link_target` has no foreign key (polymorphic), so the API checks it exists on save and `GET /home` drops the button of a banner whose target is broken. |
| M16 | 26 | Banner image | `media_id` may be empty; `/admin/uploads/images` exists. | Ratio 2:1, at least 600 × 300, ≤ 10 MB (proposed); `media.alt_text` is edited together with the banner; an image no longer referenced is cleaned after 7 days (already exists). |
| M17 | 26 | Scope of a banner | No `branch_id`, audience or language. | A banner shows for every branch and every guest. For per-branch banners, add a nullable `branch_id` (and a Manager edits only banners of their own branch, like vouchers). Open question. |
| M18 | 26 | Reading a customer's points ledger | Only `POST /admin/users/{id}/points`; no read endpoint. | `GET /admin/users/{id}/points` (`reason`, `from`, `to`, `q`, `page`, `pageSize`) returns `{ balance, updatedAt, items[{ id, createdAt, reason, delta, balanceAfter, order { id, orderNumber } or null, note, createdBy { displayName } or null }] }`; `ADMIN` only; `balanceAfter` computed with a window function. |
| M19 | 26 | Customer list with points | `GET /admin/users` does not return points. | Add `pointsBalance` and `completedOrders` to each customer (or `GET /admin/loyalty/accounts`); filter `hasPoints` if needed. |
| M20 | 26 | Adjusting points | Body `{ delta, note }`; "audited". | Add an `Idempotency-Key` header (a retry does not write twice); return `201 { balance, entry }`; \|delta\| ≤ 10.000, note 5–200 characters; deducting more than the balance returns `INSUFFICIENT_POINTS` (existing code reused); create `loyalty_accounts` if absent; ledger, balance and `audit_logs` in one transaction. |
| M21 | 26 | Note in the ledger | `loyalty_ledger.note`. | Decide whether `GET /me/points` returns the `note` of an `ADJUST` (proposed: no, return only the type). |
| M22 | 26 | Reading the rates and the feature flag | The shape of `GET /admin/settings/loyalty` is not stated. | `{ earnVndPerPoint, redeemVndPerPoint, minRedeemPoints, expiryMonths or null }`; the `loyalty` flag is read through `GET /admin/app-settings` (only `ADMIN` can read both). |
| M23 | 26 | Audit log | `points.adjust` already exists in frame 17. | Add the actions `promotion.create`, `promotion.update`, `promotion.delete`, `promotion.reorder`, `promotion.toggle` (not yet drawn in frame 17); choose `entity_type = promotion`. |
| M24 | 26 | Realtime events | There is no banner or points event. | Not needed: the customer app reloads when the home page and the Điểm screen open. Could add `points.updated` if the Điểm screen should update by itself. |
| M25 | 26 | Export | There is no export of banners or of the points ledger. | No Xuất button is drawn in this frame. If needed: a resource `LOYALTY_LEDGER` for `/admin/exports`. |

#### J (continued). Statistics charts (frame 27 part B, phase 3)

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| J101 | 27 | Shape of `GET /admin/reports/revenue` | Only `from`, `to`, `branchId?`, `groupBy` are outlined. | Returns `{ groupBy, rows[{ key, label, orders, subtotal, discountTotal, deliveryFee, revenue, businessDateClosed? }], totals { orders, revenue, average }, previous? }`; `key` is a date, branch code, order type or method; each date row has `closed` to draw "not ended yet". Accepts `branchIds[]` (part A chooses several branches); a branch outside the scope: `404`. |
| J102 | 27 | Comparison with the previous period | Does not exist. | `compare=previousPeriod` returns an extra `previous { from, to, rows[], totals }` on the same weekdays; or the client makes a second call with the earlier range. |
| J103 | 27 | Range limit and performance | Not stated. | Grouping by day at most 366 days (`VALIDATION_FAILED`); proposed extra `groupBy=month`. Heavy report: a stricter `RATE_LIMITED`, cache by (range, branch) for a few minutes, consider a summary table by `business_date`. The error catalogue has no code for a query that takes too long. |
| J104 | 27 | Shape of `top-items` | Only "best sellers by quantity and revenue" is outlined. | `limit` (default 10), `sortBy` (`quantity` or `revenue`); returns `items[{ menuItemId, name, category, quantity, revenue }]` and `total { quantity, revenue }`; item revenue = sum of `line_total` including extra options, before discounts, delivery fee not included. A soft-deleted item still shows by its snapshot name. |
| J105 | 27 | Shape of `orders-summary` | Only the contents are listed. | `{ byStatus[{ status, orders }], cancellations[{ reason, cancelledBy, orders, amount }], avgAcceptMinutes, avgReadyMinutes, peakHours[{ dayOfWeek, hour, orders }], totals { placed, completed, cancelled, rejected, active } }`. Time definitions: accept = `PLACED` to `ACCEPTED`, preparation = `ACCEPTED` to `READY`; scheduled orders and counter-created orders are left out. |
| J106 | 27 | Cancellation reasons | `orders.cancel_reason` is free text. | Normalise so reasons can be grouped: a coded list of reasons (for example `OUT_OF_STOCK`, `DELIVERY_FAILED`, `CUSTOMER_CHANGED_MIND`, `OTHER`) plus a free note, or group by normalised text. A customer's cancellation does not require a reason today. |
| J107 | 27 | Peak hours | No shape. | Count by `placed_at` in Vietnam time, completed orders; sum by (weekday, hour), with `daysInRange[dayOfWeek]` so the client can compute an average if wanted. |
| J108 | 27 | Chart colour palette | `tokens.css` has only blue, teal, violet, red for the interface and no chart palette. | Add to `tokens.json` a palette of 8 categorical colours (light and dark) that passed the dataviz skill checker, and one grey context colour; make the six "sequential" steps of the heat grid tokens. For now `--color-primary` plus the grey context colour are used, so only single-series charts can be drawn. The existing three-colour version (blue, teal, violet) fails the checker: teal is below the saturation threshold, and the blue–teal pair has ΔE 14,6, below 15. |
| J109 | 27 | Order type in the report | `orders.type` has no `DINE_IN` (gap already recorded, A1). | Revenue by order type needs `DINE_IN`; an order created at the counter may have no customer (`customer_id` empty) but still counts in revenue. |
| J110 | 27 | Exporting chart data | Only the Excel export (part A) exists. | No separate download button per chart; the table under the chart and the Excel file are the two ways to get the numbers. |

#### N. E-invoices (frame 28, deferred)

All 26 boards of frame 28 carry the label `Chưa bật`; the frame is not usable until the owner turns e-invoices on (`WA17`, W17 is a deferred command).

| ID | Frames | Screen / item | Missing today | Proposal |
|---|---|---|---|---|
| N1 | 28 | Reading one invoice | Only list, record number, cancel and combined orders exist. | `GET /admin/invoices/{id}` returns the invoice, the buyer, `tax_lines` and the history (from `audit_logs`). |
| N2 | 28 | Shape of `GET /admin/invoices` | Only the filters are outlined. | Add a `kind` filter; return `items[{ id, kind, status, orderId?, orderNumber?, branch, businessDate?, orderCount?, buyerType, buyerName?, taxCode?, total, dueAt, series?, number?, lookupCode?, issuedAt?, issuedBy?, errorCode?, attempts?, rowVersion }]`, `counts` by status (the numbers on the tabs), paging, sorted by `dueAt` by default. Only invoices of `COMPLETED` orders are listed. |
| N3 | 28 | Replacing an invoice that is already issued | `POST /admin/orders/{id}/invoice` is allowed only for orders not yet finished; after a cancel there is no command for "new request". | `POST /admin/invoices/{id}/replace { buyer, reason, rowVersion }`: cancel the old invoice (`REPLACED`, `replaced_by_id`) and create a new `PENDING` row in one transaction, because the partial unique index allows only one current row per order. |
| N4 | 28 | Editing the buyer before the invoice is issued | Only while the order is not finished. | Allow adding or editing the buyer while the invoice is still `PENDING` or `FAILED`, also after the order is completed; otherwise `BUYER_INVALID` cannot be fixed and a guest who asks for an invoice after the meal cannot be served. |
| N5 | 28 | Tax lines with the manual adapter | The command body has only `series`, `invoiceNumber`, `lookupCode?`, `issuedAt`. | Add `taxLines?[{ label, rate, amount }]` so the books match the invoice issued on the portal. |
| N6 | 28 | Error codes | Only `INVOICE_INFO_INVALID` (422) and the invoice's `error_code` exist. | A code for issuing an invoice for an order that is not completed (the frame uses `INVALID_STATE` 409); the HTTP status of `PROVIDER_REJECTED`, `PROVIDER_UNAVAILABLE`, `BUYER_INVALID` and where the provider's reason is returned; field `errors[]` for `INVOICE_INFO_INVALID`. |
| N7 | 28 | Unique series + number | No constraint. | Unique (`series`, `invoice_number`) per seller (`ALREADY_EXISTS`). |
| N8 | 28 | Staff permission | Every write command says "Roles: manager and admin". | Let `STAFF` (own branch) use `POST /admin/orders/{id}/invoice` and see the invoice status inside the order, because the guest asks at the counter; keep the rest unchanged. |
| N9 | 28 | Due time, and invoices created at order time | The due time is counted from `completed_at`; an invoice can be created at order time. | The due time of a daily summary invoice is counted from `created_at`; the queue lists only invoices of `COMPLETED` orders. |
| N10 | 28 | Realtime event | None. | Optional `invoice.failed` for the branch's Manager (like `stock.low`); otherwise refresh on demand. |
| N11 | 28 | Excel export `INVOICES` | Only the source name exists. | Columns: kind, order number or date, branch, buyer, tax code, series, number, issue date, total, status, cancel reason; address and email masked by default. |
| N12 | 28 | Tax code and legal name | `brand.tax_code` (printed on the receipt) and `tax.tax_code` are two places; `brand` has no legal name. | One single source for the tax code; `tax.legal_name` belongs to `tax`. |
| N13 | 28 | Tax group of an item | `menu_items.tax_group` and `order_items.tax_group` are nullable. | The item editor (frame 6) needs a Tax group field when invoices are on; hidden while they are off. |
| N14 | 28 | Customer app | The customer app frame set for the restaurant is not drawn; "add to the mobile files when enabled". | The two drawings (boards 23, 24) are the content and the text for review; when enabled, redraw them with the customer app frame and add them to `designs/mobile`. |
| N15 | 28 | Sidebar | `03-ia-roles-components.md` has no Hóa đơn item. | Add a Hóa đơn item (Manager and Admin) and the number of overdue invoices when enabled. |

### S. Sample data added by the frames (not in `02-sample-data.md`)

The sample data stays the single source; these are the extensions the frames made. Real numbers must replace them at implementation.

| Frames | Added data |
|---|---|
| 05, 06, 07 | Tags `Thuần chay`, `Halal` (diet), `Đậu phộng`, `Sữa` (allergen), `Mới` (label); verifiers `Nguyễn Phúc · 21/10/2026 14:20` and `Trần Minh · 22/10/2026 09:05`; the new item `Cà phê muối` (32.000đ, Đồ uống); 15 minutes preparation and default options of Cơm gà; 7 amenities and 5 more tags with branch counts, slugs; category `Món chính` has no item (used as the deletable example). |
| 09, 10 | COL has 21 orders today (2 active: `COL-261027-0020`, `0021`); BT rating 4,5 from two reviews; COL no reviews; staff counts BT 4 (with Phan Lộc invited) and COL 3; branch phones `028 3822 0001` and `0002`; pin `10,77405 · 106,70046`; 15 minutes preparation, 30 minutes order cutoff; short descriptions; nearby ward names. |
| 11, 12 | Tết 28/01 to 03/02/2027 and 24/12/2026 early close 20:00 (as commanded); overnight, 24-hour and two-shift examples and the second page of special days; two test addresses (120 Nguyễn Tất Thành, 15 Phạm Văn Đồng), all test coordinates and distances, a basket of 210.000đ, a "Vòng 3 (thử)" ring, ring names; ring 2 of BT and the ring of COL are not free-over (`free_over = null`). |
| 13 | Photo captions (7 photos), uploader and upload dates, amenities of BT and COL, website `https://kitchendaylight.example/ben-thanh`, `+842838220009` in the conflict compare. |
| 14 | Review texts of Hà and Lan, hidden review of Lan on `COL-261026-0025` (5 stars, advertising, 27/10/2026); Bảo's order `BT-261025-0061`; dates 25, 26, 27/10/2026; Nguyễn Phúc's reply 26/10/2026 08:40; ratings BT 40 ÷ 9 and COL 16 ÷ 4 (the sample has three reviews only); reply drafts; conflict times 12:03 and 12:04; a no-review period 01 to 07/02/2026. |
| 15 | Staff emails `ten.ho@kitchendaylight.example`; last sign-in times of 27/10/2026 and Phan Lộc `Chưa đăng nhập` (link expires 29/10/2026 12:05); Võ Mai as the suspend example; role descriptions; a second admin `Lê Khoa` (`le.khoa@kitchendaylight.example`, last sign-in 26/10/2026 20:15); customers Mai Lan, Hồ Tuấn, Phạm Linh, Lê Thảo, Ngô Hậu, Võ Thanh and a deleted customer with masked contacts, order counts and last-order dates; 15 customers in total; resend link expiry 29/10/2026 12:10; 20 s and 40 s examples of `RATE_LIMITED`; Phạm Linh as the suspend example. |
| 16, 17 | Dashboard figures follow the sample; audit log: 12:05:41 on 27/10/2026, times and actors of the remaining rows (including who cancelled `0032` and who revealed contact on `0042`), stock before 8, old price 36.000đ of Chả giò chiên, the reason a review of "Lan" was hidden, 20 bonus points, voucher expiry 15/11 and 50 uses before editing, record ids, "about 900 records" (assumed). |
| 18, 19 | 279 orders (7-day BT total of sample section 7), 1.284 customers over 65 pages, 47 reports, three sample reports (Hà, Lan, Bảo), cursor-page times; "tens of thousands of orders a year" (about 40 a day per branch scaled); toast "Có 3 đơn mới" and the toast wording of `review.created`, `report.created`, `reservation.requested`, `export.ready`; times 12:02:07, 12:02:22, 12:05:56; the 30 s loss threshold; Hoàng Nam editing the description at 12:03 (from frame 06); Lê Dũng setting Bánh flan sold out. |
| 20, 27 | File names by type, "Tệp đã xuất" rows (1.012, 86, 25, 7 rows, creation times, exporters), "about 62.300 rows" and "about 900 rows" (assumed), Trần Minh unmasking for the accountant, "119 days"; statistics: range 01/10 to 27/10/2026 and all sheet numbers (last 8 rows of `Theo ngày`, 46 earlier rows summed to 1.020 orders and 115.000.000đ; 12 items with quantities and revenue totalling 134.536.000đ = subtotal; 5 `Chi tiết đơn` rows of which three orders and one phone and address are invented; 7 cancelled orders of which three added to match "3 cancelled on 23 to 24/10" and "1 on 26/10"; year-to-date BT 251.190.000đ and COL 161.460.000đ split from the sample's 412.650.000đ; the cash and transfer split; file size 186 KB, 1.352 rows; creation time 12:07; closed period 17 to 18/02/2026). |
| 21 | Eight log rows (times, `l***@example.com`, `b***@example.com`, `v***@example.com` customers; failure of `vo.mai@`; bounce of `phan.loc@` at 12:05:02 consistent with frame 15), template versions and dates, the code `482 915`, a second session saving at 12:03 as `v4`. |
| 22, 03 | The five `ordering` defaults proposed in L3 (20, 30, 30 min, 3 days, 7 days) and logo rules (L5); the fake tax code `0300000000` on the drawn receipt (A23). |
| 29, 30 | Orders `BT-261027-0046` and `0047` (table `B3`, two rounds, 94.000đ then 154.000đ), timeline times after 12:05:41. |
| 14 (W09B, reports tab) | Report `#c41d9e` by Linh (Spam, 27/10/2026 11:20) on Lan's review; the review hidden at 11:42 by Hoàng Nam; the extended sample at 11:35: report `#e07b52` by Vy (Sai thông tin, 11:31), COL rating 21 ÷ 5 = 4,20 then 16 ÷ 4 = 4,00, handled at 11:48; dismissed report `#7a20b5` by Vy on Bảo's review (26/10 14:10, handled 15:02 by Nguyễn Phúc); a review removed at 11:50 (board 18); time 12:06 (boards 23, 24); report ids are short illustrative strings. |
| 23 | Tables B1 to B6 (B1, B2 two seats; B3, B4 four seats; B5, B6 six seats; the sample has only B3 with four seats and frame 00 has B1 to B4); nine reservations today: Mai Anh (sample), Phạm Linh, Hồ Tuấn, Nguyễn Hạnh, Trần Bảo, Lương An, Đinh Khoa, Võ Quang, Lý Hoa, with times, party sizes, notes, short ids and masked phone numbers (all invented); the confirmer and times in the history; Ngô Hậu on board 12; a duration of 90 minutes and the thresholds 15 and 30 minutes. |
| 24 | Seven tables B1 to B7 (B5, B6 six seats, B7 four seats and switched off; B1 to B4 as in frame 00); the areas Cửa sổ, Giữa phòng, Phòng riêng, Sân thượng; two reservations of B3 besides Mai Anh (Đặng Vy 29/10 12:00, Trần Bảo 31/10 19:30); B6 and B7 never used; times 12:03, 12:06, 12:07; the person editing the branch, Nguyễn Phúc, and Lương An's reservation on board 11 (an illustrative situation). |
| 25 | `CHAO25` as in the sample (25.000đ, orders from 150.000đ, until 30/11/2026, 12 / 100); the vouchers `TRUA10`, `KHACHQUEN`, `GIAO15`, `TET50` and their values; ten redemptions and four more of `CHAO25` (order number, time, subtotal, two reversals), 14 in all; three customers assigned `KHACHQUEN` and the list of searchable customers (masked email, order count); sample orders `BT-261027-0035` and `BT-261027-0043` for the examples (subtotal as in the order table); the worked example `BT-261027-0035` 158.000đ − 25.000đ = 133.000đ and a delivery order with a 15.000đ fee kept, total 159.000đ; Nguyễn Phúc editing at 12:06 (boards 8, 13). The customer-app voucher card is a drawing from the description of frame 17 (not drawn; `mobile.css` has no `.vch`). |
| 26 | Five banners (title, body, dates, link) because sample section 8 has only the voucher `CHAO25`; the list of customers with points (Trần Bảo 205, Hoàng Yến 90, Đặng Vy 40, Phạm Linh 0 and three customers on page 2: Lê Thảo, Lương An, Ngô Hậu); Nguyễn Hà's points ledger (6 rows, adding up to exactly 320) with orders `BT-261002-0038`, `BT-261009-0071`, `BT-261015-0064`, `BT-261018-0059` set by the order-number pattern (the top row matches the frame 17 log: +20, 300 to 320, 24/10 16:05); a deleted customer (85 points revoked); sample adjustments +30 and −20; Nguyễn Phúc editing at 12:04 and Trần Minh at 12:03 on the error boards; provisional loyalty rates shown read-only (1.000đ = 1 point, 1 point = 100đ, redeem from 50 points, no expiry). |
| 27 (part B, charts) | The previous period 14/10 to 20/10 (seven days, total 31.307.000đ); cash and transfer amounts of 21, 22, 25 and 27/10 and the order counts per method; the split by order type (163 taken at the restaurant, 107 delivery, 9 dine-in) and the order count per type; 13 orders in progress split by status (BT as in the order table, COL 2 orders); an average preparation time of 14 minutes; the distribution of orders by hour and weekday (total exactly 1.277); the Tết closure 17 to 18/02/2026 as the empty state. Chart range 21/10 to 27/10/2026 for Bến Thành with a +2.158.000đ (+8,0%) difference over the 6 ended days; acceptance time 3 minutes. Numbers taken from the sample: section 7 (seven days of BT, 23 and 24/10 for both branches, acceptance 3 minutes), the sheet "Theo món" (12 items, 2.612 portions, 134.536.000đ) and "Đơn hủy" (7 orders, 619.000đ) of part A. |
| 28 | Invoice numbers, the series `1C26TAA`, numbers `00000013` to `00000018` and lookup codes: fictional. Buyers: Công ty TNHH Sao Mai (sample), tax code `0108765432` (and `0108765431` in the wrong version), `ketoan@saomai.example`; Trần Bảo (individual, as the customer in the sample version) `bao.tran@example.com`; addresses 56 Hai Bà Trưng, 42 Pasteur. Orders added by the frame following the order-number pattern: `BT-261025-0091` (110.000đ), `BT-261025-0066` (168.000đ), `BT-261024-0052` (125.000đ), `BT-261026-0096` (Phạm Linh, 142.000đ), `BT-261026-0099` (132.000đ), `COL-261023-0019` (78.000đ), and ten orders `BT-261026-0095` to `0106` of the daily summary invoice. Existing orders reused: `BT-261026-0107` (85.000đ, completed 19:58), `BT-261027-0030` (96.000đ, 10:42), `BT-261027-0040`, `BT-261027-0042`, `BT-261027-0043`, `COL-261024-0033`. Daily summary invoices: Bến Thành 24/10 (37 orders, 4.286.000đ = 38 orders 4.411.000đ − `0052` 125.000đ), 25/10 (50 orders, 5.412.000đ = 52 orders 5.690.000đ − 110.000đ − 168.000đ), 26/10 (42 orders, 4.908.000đ = 44 orders 5.135.000đ − 142.000đ − 85.000đ), from sample section 7; Cầu Ông Lãnh 24/10 (25 orders, 2.790.000đ) from section 7, while 25/10 (24 orders, 2.540.000đ) and 26/10 (26 orders, 2.760.000đ) were set by the frame. Mode Tổng ngày from 24/10, the manual adapter, a 24-hour due time, tax rates 8% and 10% (sample numbers), tax `7.111đ` = 96.000đ × 8 / 108 (price includes tax). Seller: Hộ kinh doanh Kitchen Daylight (legal name set by the frame), tax code `0312345678` taken from the Settings sample. The three queues mix every kind of row so all can be drawn; in reality there is one mode at a time. All tax rates are sample numbers pending the accountant. |

## Open questions

**Decided 2026-11-03 ("OK all").** The owner accepted every recommendation of [../open-questions-sheet.md](../open-questions-sheet.md) for the questions below (web W1 to W85, mobile M1 to M22). Where a row there says **Input**, the recommendation is only a placeholder: the fact it needs (bank details, accountant answers on e-invoices, receipt title, scheduling capacity, auto-cancel minutes) is still owed by the owner or the accountant. Rows that ask for a new field, endpoint or extra board (W36, W56, W67, W69, W70, M7, M10, M11, M18) are follow-ups, not blockers. The question texts below are unchanged.

From `docs/tmp/web-design/01-context.md` section 7 (flag, do not decide), then the ones the frames added. Each needs the owner (or the technical contact, accountant, or the people named).

### From the brief of the commands (section 7)

1. **Lost-device path for the owner's MFA** (`WA20`): the recovery codes and "admin resets admin" are drawn; the technical contact's reset task (an engineer-run server task after in-person identity proof) is outside the UI.
2. **Lateness thresholds and refetch interval** (settings, placeholders): `Mới` warning 5 / late 10 minutes, `Đang chuẩn bị` 15 / 25, board refetch 15 s.
3. **The courier is a typed name only** (no courier accounts): `Lê Dũng · 0903 456 789` is typed by staff.
4. **Bank-transfer details** (bank, account, holder, bank code, QR): the owner supplies them; the sample uses a fictional account.
5. **Kitchen-ticket and receipt paper sizes** (R1).
6. **Item photo limit** (R4): 8 is drawn.
7. **May staff reveal customer contact without a reason** (R6).
8. **Several printers or kitchen-display screens.**
9. **Refunds** are only recorded as `REFUNDED` after staff pay back by hand; there is no payment gateway.
10. **Receipt title `HÓA ĐƠN BÁN HÀNG`** and the revenue threshold for e-invoices (accountant, R2).
11. **Scheduled-order capacity** (how many orders per slot).
12. **Auto-cancel of unconfirmed orders** (setting, off by default; semantics in L8).
13. **Branch-specific menus** (today the menu is shared and a branch overrides price, availability and stock).
14. **Stock for options** (stock is tracked per item only).
15. **Business-day cutoff hour** (setting, default 04:00; effect of moving it, L17).
16. **Counter orders:** hold the kitchen until a transfer is confirmed or not (drawn: not held); counter orders when the branch is paused or past its order cutoff; a table number on every dine-in order; split payment (A12); phone orders for delivery; automatic printing of the kitchen ticket (A14).

### Added by the frames

17. Table service on the phone: the three added rules of decision 8, printing from a phone, whether a waiter may confirm a transfer (A15).
18. Phone field in two branch tabs (C34); the second-factor wording of frame 00 (`MỚI`) against frame 02 (`Mới`).
19. `LAST_ADMIN` and MFA (E5); whether `STAFF` should later use MFA.
20. Reviews: `REMOVED` back to `PUBLISHED`, reply on a hidden review (V4, V5); whether the hidden review keeps counting.
21. Menu: remove the last cover photo of a selling item, drop the last branch (B6); `alt_text` shared across items (B18); who owns the amenity icon list (B32).
22. Branches: 24-hour opening (C11), whether a special-day note is shown in the app (C13), delete a branch with staff who would lose their only branch (C3).
23. Email: does a test send write a log row (K4); resend only for staff mail in `FAILED`, once per 60 s (K5); customer search by full address (K6).
24. Exports: Excel CSV delimiter and BOM are **not verified against Excel with Vietnamese settings**; the xlsx library and the job queue are not chosen.
25. Maps: the ring map is a drawing and the branch pin uses an OpenStreetMap attribution; tile source and cost (self-hosted extract or a provider with a free tier) are still open (ADR-0005).
26. Mobile app wording of statuses must match the enum label map of frame 00 (same wording, same pills).

**Added by the phase 2, 3 and deferred frames (2026-10-30):**

Continues the numbering of "Open questions" above (the last number there is 26). Each needs the owner (or the accountant, where named). No two questions were exact duplicates, so none was merged.

**Frame 14, reports tab (W09B)**

27. Queue order: the frame puts **newest first**, like the old frame 11 and like the reviews list (the orders table is oldest first). Should the reports queue be worked first in, first out (oldest on top)?
28. Staff do not see the Reports tab (chosen from the event table, audience "Managers"). Or should Staff be able to view it and only not decide, as on the Reviews tab?
29. A report still open on a review that is already hidden: the frame lets **Ẩn đánh giá** close the report without changing anything. Or should that button be relabelled Giữ ẩn?
30. The switch "Áp dụng cho báo cáo khác cùng đánh giá" is on by default as commanded; the frame also applies it to the decision Bỏ qua. Is bulk dismissal as intended, or should it apply only to Ẩn and Gỡ?
31. Should the customer be told (in-app notice) when their report has been handled? Not drawn.
32. Is a resolution note of at most 500 characters enough (the frame's proposal)?
33. The main sample as commanded is "one open report on a hidden review"; to draw the duplicate state and the rating effect the frame added an extended 11:35 sample (a visible review, two reports). Does the owner agree to use this extra sample?

**Frame 23, reservations (W14A)**

34. Button times: Đã đến from 30 minutes before the reserved time, Không đến from 15 minutes after (proposed). Does the owner want to change them?
35. Should a request waiting too long for confirmation expire by itself (for example rejected automatically 2 hours before the reserved time) or only show a warning? Only the warning is drawn.
36. May staff cancel a confirmed reservation on the guest's behalf (the guest phones)? The API does not have it yet (P6) and no button is drawn. Creating a reservation by phone is drawn (`Thêm đặt bàn`, P28; question 85).
37. Rule for joining tables: only add up the seats (as drawn), or declare adjacent tables on the Tables page (W14B)?
38. Should a table with guests ordering at the table (order `BT-261027-0047` at B3) show on the reservation calendar?
39. Revealing the phone number of a reservation: drawn like orders (no reason required, audited). Is that right?
40. Are viewing past days (read-only) and at most 31 days in the list date filter reasonable?

**Frame 23, search, edit and add (added 2026-10-30)**

84. Should an admin on "Tất cả chi nhánh" search every branch by default (P26), or only the branch chosen in the switcher?
85. May `STAFF` add a reservation by phone or at the counter (P28)? Frame 23 lets them; editing stays with Manager and Admin (P27). Is that the right split?

**Frame 24, tables and reservation rules (W14B)**

41. Reservation rules are edited only in frame 24 (frame 10 only shows them and links here). Does the owner agree?
42. Tables and rules are for the Manager (own branch) and the Admin only; Staff cannot open the page. Is that right?
43. A table cannot be switched off while it still holds reservations (drawn as blocked, with the list). Or should switching off include a step "move the reservations to another table" inside the dialog?
44. Delete is allowed only for a table that is switched off and was never used; a table with history can only be switched off. Is that right?
45. Area is free text with suggestions. Or a fixed list of areas?
46. May tables be added and rules edited while the branch has not turned reservations on (like Cầu Ông Lãnh)? The frame allows it to prepare in advance.
47. Are the proposed value limits (duration 30–240 minutes, lead time 0–1.440 minutes, 1–90 days ahead, seats 1–20) reasonable?

**Frame 25, vouchers (W14C)**

48. The voucher code locks after its first redemption (as drawn). Does the owner agree?
49. A Manager edits only vouchers of their own branch and only views vouchers for all branches. Is that right?
50. Vouchers are not deleted, only switched off (the API has no `DELETE`). Should a voucher with no redemption be deletable?
51. Should the voucher title carry an extra free-text "condition" (for example "Không áp dụng giờ cao điểm")? Not drawn.
52. Is revoking a voucher already assigned to a customer (`ASSIGNED`) needed? The API does not have it.
53. A voucher discounts only the item amount, even the part of the delivery fee already waived when the order is above the free threshold. Keep it?
54. Are the proposed value limits (code 4–20 characters, title ≤ 60, fixed discount ≥ 1.000đ) reasonable?

**Frame 26, banners and loyalty points (W14D)**

55. Nguyễn Hà's sample ledger stops at 320 points (the +20 adjustment on 24/10 matches the frame 17 log), but her order `BT-261026-0107` completed on 26/10 (85.000đ) should have added 85 more points. The frame keeps 320 as in sample section 8; does the owner want the sample balance raised to 405 and the log corrected?
56. A banner has no branch, so the Bến Thành Manager can change banners of every branch. Keep the role table as it is (a Manager may manage banners) or add `branch_id`?
57. How many banners does the customer app show at most on the home page? No limit is drawn.
58. A new banner defaults to Off (proposed, so it can be reviewed before guests see it). Or default On?
59. Deleting a banner is a real delete and cannot be undone (the API has `DELETE`; no table points to it). Keep it, or allow switching off only, as for vouchers?
60. While earning points (Tích điểm) is off, the frame still lets the ledger be viewed and adjusted by hand. Is that right?
61. Is the note of a points adjustment shown to the customer on the app's Điểm screen? The proposal is no (only the type "Điều chỉnh từ quán" shows).
62. Is the customer notified when points are deducted? No notice is drawn.
63. Are the proposed limits (title ≤ 60, body ≤ 140, image 2:1 at least 600 × 300, \|points\| ≤ 10.000 each time, note 5–200 characters) reasonable?

**Frame 27, statistics charts (W15C, part B)**

64. The charts are three tabs of the same Thống kê page (as drawn, following the decision "one page"). Or separate pages in the Báo cáo section?
65. The chart colour palette is not in `tokens.css`. Does the owner agree to add the 8-colour categorical palette (checked with the dataviz skill checker) to `tokens.json`? Without it only one-colour charts can be drawn, as in this frame.
66. Comparison with the previous period: same weekday (21/10 against 14/10) and leave out days not yet ended. Is that right? Is a comparison with the same period last year needed?
67. "Preparation time" is defined as from acceptance to ready (`ACCEPTED` to `READY`), leaving out scheduled orders and counter orders. Should the time from placing to ready be measured too?
68. The peak-hours grid sums the orders of days with the same weekday in the range (Wednesday has only 3 days, so it is low). Change it to an average per day?
69. Grouping by day is limited to 366 days (proposed). Are grouping by month and by week needed?
70. The cancellation reason is free text, so the reason chart can only group identical texts. Should it be normalised to a pick list when cancelling an order?
71. May a Manager use "So với kỳ trước" for their own branch? The frame allows it; Staff have no page.
72. Clicking a column to open the order list of that day (drill-down) is not drawn. Is it needed?

**Frame 28, e-invoices (W17, deferred)**

73. Does the owner really turn e-invoices on, and why (revenue threshold, accountant's requirement)? W17 is a deferred command; it was drawn because the owner ordered it. The frame is not usable until this is answered.
74. Adapter: manual entry or which provider? Is Tự động xuất (auto issue) on (only a provider can turn it on)?
75. Default mode: Theo đơn, Tổng ngày (the owner does not like it) or Chỉ khi khách yêu cầu? The accountant decides. If the mode is changed midway, old rows stay as they are: is that accepted?
76. May counter staff add buyer information when a guest says "give me a company invoice"? The API today allows only Manager and Admin; the frame proposes allowing staff (a gap).
77. A guest asks for a named invoice after the order is completed: may the buyer be edited until the invoice is issued? If not, the only way is cancel and replace after issuing.
78. Is the 24-hour issue deadline and the "almost overdue" threshold of 80% right? What real deadline does the accountant report under the regulation?
79. Is the seller a household business or a company, with the exact legal name and tax code (the payment sample says a company name, the invoice sample says a household business)?
80. Tax calculation method, tax groups, tax rates and whether menu prices already include tax: the accountant supplies them. Every tax number in the frame is a sample number.
81. Cancelling or replacing an issued invoice: the period allowed by regulation, and who cancels on the portal when the manual adapter is used?
82. Should the Manager viewing the buyer's address and email on the invoice detail be audited as when viewing a customer's phone number? Not logged now.
83. Retention period for invoices and buyers: the frame states 10 years, as proposed by the data model; the accountant confirms.

## Status of the work (2026-10-30)

All 51 design commands (W00 to W17) have been accepted by the owner. The points marked "needs confirmation" in the decisions tables were accepted as proposals unless the owner said otherwise. The closing commands (W16A index, W16B this brief, W16C UI docs, W16D final checks) were first run on 2026-10-29 and **re-run on 2026-10-30** after the phase 2 and 3 frames (W09B, W14A to W14D, W15C) and the deferred e-invoice frame (W17) were drawn. The 19 old frames were moved to the archive on the owner's confirmation. What remains is the owner's review of the re-run and the open questions below. The gaps were folded into `data-model.md` and `api-outline.md` as proposals on 2026-10-30 (see [gaps-coverage.md](gaps-coverage.md)); they stay proposals until the owner and the engineers confirm them.

## Implementation notes (Angular and PrimeNG, ADR-0001)

Suggestions only: PrimeNG component names and options were **not** checked against the version that will be installed.

| Frame element | Suggested building block |
|---|---|
| Lists with URL paging, sort, filter chips and skeleton rows (orders history, items, users, audit, email log) | PrimeNG Table in lazy mode driven by query params; cursor lists keep a stack or use the server's `prevCursor`; sticky header and a sticky pager row |
| The orders board (frames 02, 29) | A standalone board component (columns, cards) fed by one signal store; a realtime service exposes the connection state as a signal, applies events by comparing `rowVersion` (never trusting order of arrival), refetches on reconnect, every 15 s while open and when the tab returns; no optimistic moves, a card changes column only after the server answers |
| Sorted columns with a new-order ring and the `Có N đơn mới ↓` button | `scrollIntoView` on demand; an `IntersectionObserver` for "off-screen"; the ring is a static outline class |
| Sound for a new order | Web Audio started from a user gesture; draw the "sound blocked" banner (frame 02) when the browser refuses |
| Toasts (new order, conflict, saved, failed) | Toast with a service wrapper; wording from the frames; the conflict toast is neutral, not an error |
| Dialogs (cancel, reject, payment, courier, delete, reveal) | Dialog or ConfirmDialog; the reason or note field is inside the dialog; 48 px buttons on touch screens |
| Dropdowns and filters | PrimeNG Select; vocabulary lists loaded once from `/meta/config` and cached; server-searchable selects (wards, items) use `lazy` with virtual scroll and ask for 20 matches |
| Date ranges (mandatory on big lists) | DatePicker in range mode with the maximum span enforced in the form and by the server |
| Forms with tabs (item, branch editors) | Router-driven tabs with one shared form state; dirty dot from a `computed`; unsaved-changes route guard; `errors[]` mapped to controls by `field` path |
| Money (`50.000đ`) | InputNumber with the `vi-VN` locale and no decimals; store integer VND |
| Option groups, item and category reordering | CDK drag and drop (or PrimeNG OrderList) with a single reorder request (B4, B28) |
| Printing (kitchen ticket, receipt) | The `.ticket` and `.receipt` blocks as a print view with `@page` size for 58 or 80 mm; the browser print dialog; a network or cloud printer is undecided (A14) |
| Email template editor (frame 21) | A restricted rich-text editor (bold, italic, underline, list, link) whose output is filtered by an allow-list on the server; the "insert variable" menu offers Vietnamese labels |
| Excel statistics | The API writes the `.xlsx`; the preview grid is plain HTML (`.sheet`); the xlsx library is not chosen |
| Phone layout (frame 30) | A separate route group with its own shell (top bar, bottom tabs, bottom sheets); the same data services as the tablet screens |
| Charts (frame 27 part B, phase 3) | The frames draw bars and the heat grid in HTML and CSS (real text, no SVG), each with a table twin. A chart library in a lazy-loaded module is fine if it keeps: one series colour, a table under every chart, a legend for two series or more, tooltips that never gate the data, and the token-only colours listed in the frame |
| App shell (sidebar, branch switcher, counts, guards) | `SessionStore`, `BranchSelectionService`, `NavCountsService`, `RealtimeService`, `ShellComponent`, interceptors and route guards as sketched in [docs/admin-shell-design.md](../../docs/admin-shell-design.md) |
| Theme | A PrimeNG theme preset generated from `tokens.json` (light and dark), not hand-written CSS variables |
| Fonts | Be Vietnam Pro; self-host the files instead of the Google Fonts link used in the frames |
| Map | MapLibre GL JS with OSM-based tiles from a configured URL; attribution always visible |

## Verification

This is what the frames' own reports say was done, plus the checks of the 2026-10-30 re-run.

- **Rendering.** Every frame was rendered with headless Chrome at 1500 px wide in light mode and most in dark mode. Most tablet and desktop frames were also rendered at 1024 × 768 (the sidebar becomes the icon rail; the reports of the commands name which boards); frame 30 at 390 × 844 and 360 × 800 (no element overflows sideways at 360 px; the category chip strip scrolls inside its strip, by design). Where a frame has several boards, the reports name the boards that were **viewed as images**.
- **Re-run checks (2026-10-30), by script over all 31 frames.** HTML balanced; every `use href="#i-..."` has its `<symbol>`, none is duplicated; the theme script is present; every `Dữ liệu` section has a `Quyền` row and an `Lỗi` row; internal links between frames resolve; no duplicate `id` in a page (113 renamed in frame 03, 44 in 22, 9 in 16, 7 in 23, 4 in 24, 1 in 28 after the review); no horizontal overflow at 1500 px in light and dark; computed text size: none under 12 px outside captions and spec tables (a floor was added at the end of `admin.css` for `code`, `small`, `.nav-tag`, `.badge-p2`, `.new-chip` and a few more that used 10 or 11 px in frames 00 to 08, 17, 19, 21 and 29); about 8.700 `data-bind` values checked against the table and column names of the data model (two wrong names fixed: `users.name`, in frame 26). Hex colours in markup: `#8CC2FF` (theme toggle), `#FFFFFF` and `#07111D` (logo backgrounds in frame 00).
- **Dead anchors (not fixed).** In-page links without a target: `#BT-261027-0045` (toast in frame 02), `#tab-basic` and `#tab-options` (frame 06), `14-reviews.html#reports`, `15-users.html#customers`. They are no-ops in the static mockups.
- **Measured in the browser** (earlier commands). Touch targets: no element below 48 px on the orders board (400, 779, 557 and 709 clickable elements over the four board commands) and on the availability screen (0 elements under 47.5 px on all 11 boards at 1366 and 1024); the statistics page checked at 36 px minimum; the users screens scanned for the words password, hash, token, device (none in any column or dialog).
- **Boards not viewed as images** (rendered but not looked at, or edited after they were looked at): the notes column of `docs/tmp/web-design/STATUS.md` names them command by command. Dark mode is the largest gap: most boards of frames 02, 03, 04 to 08, 10, 15, 27, 29 and 30 were viewed in light mode only; of frame 28 only boards 1, 9 and 23 were viewed in dark. The font floor added on 2026-10-30 changed the size of small tags in frames 00 to 08, 17, 19, 21 and 29; the top of frames 02 and 29 was looked at afterwards (dark), the other boards were not.
- **Not tested at all.** Other browsers, widths other than those above, print output of the ticket and receipt on real paper, the CSV and xlsx files in Excel with Vietnamese settings, hover, focus, keyboard order, screen readers, forced-colours and the hatch pattern of the charts in a real print. Accessibility is unverified until the Angular build is tested.

## Colours not measured

Text and control colours come from tokens whose contrast is measured in `style-direction.md`. New combinations are not in that measured list, and the commands' reports each named theirs in chat; those per-command lists were **not stored in the folder**, so they are not consolidated here. The two combinations the first brief already named still apply and were **not measured**: error-tinted backgrounds (`color-mix` of the error colour into the surface) with error text, and selected-row backgrounds. Frame 21 adds: the `bắt buộc` chip on the insert-variable menu in dark mode, the code box on `surface-variant`, the disabled `Gửi lại` button on a selected row, and the phone frame border; `index.html` adds the `Đã vẽ một phần` (warning) and `Chưa làm` (default) pills.

Phase 2, 3 and the deferred frame add (the lists of W14A to W14D were not stored): **frame 27 part B**: the dataviz validator FAILS the three-colour token set (teal chroma 0.088, blue to teal ΔE 14.6 under 15 in light) so charts use one series colour (`--color-primary`) and a grey context series (`--color-outline` mixed 75% into the surface, ΔE about 21 light and 20 dark, grey chroma exempt); the dark `--color-primary` (`#5CA8FF`, L 0.72) is outside the validator's lightness band; bars drawn in `--color-primary` mixed 40% into the surface (unfinished day, active statuses) are under 3:1 against the surface and are backed by text, legend and table; the six heat-grid levels have measured text contrast of at least 4.5:1 in both modes (WCAG formula, not APCA); tooltip text and border, gridlines and axes are not measured. **Frame 28**: the age chips (`Sắp quá hạn`, `Quá hạn`), the `kế toán cung cấp` chip, the `Chưa bật` tag (`--color-warning` on `--color-warning-container`), error borders in dark mode and the filled danger button text in dark mode.

## Token gaps

`tokens.css` was not edited; the nearest token was used. Colours that are hard-coded today and have no token:

- The overlay scrim: `#06101C` at 45 to 55 % in `.modal-bg`, `.oscrim`, `.bscrim` and `.rhs` (propose `--color-scrim`).
- `#8CC2FF` for links on the dark toast (`.toast a`) and for the theme toggle in every frame bar (propose an inverse-surface link token).
- **Chart palette (frame 27 part B).** `tokens.css` has no chart colours: propose eight categorical colours (light and dark), one context grey and six sequential steps for the heat grid, validated with the dataviz validator; until then charts are single-colour.
- Popup, menu, compose-window and bottom-sheet shadows are literal `rgba(0, 0, 0, .22 to .35)` (21 `rgba(...)` values in `admin.css`); only the card `--elevation` is a token (propose an overlay elevation).

## Not covered

The customer-side parts of the e-invoice feature are only sketched with admin tokens in frame 28 (the restaurant customer app frames are not drawn); expenses, costs and profit (no data model); bulk actions; import from a file; keyboard shortcuts; a profile or change-password screen for staff (MFA setup and recovery codes are drawn in frame 01); courier accounts; kitchen-display and multi-printer screens; split bills and moving an order between tables; the customer mobile frames (they live in `designs/mobile`); the real map component; real printing; the customer-facing wording of order status emails (not sent in v1, `WA3`).
