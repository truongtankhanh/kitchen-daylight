# Admin web shell: data, API and solution design (proposal)

Status: **proposal, open points decided 2026-10-30** (section 9). It covers the part of the admin web that every screen shares: the role-aware sidebar, the branch switcher, the counts on the sidebar, sign-in state and what happens when access is denied. The screens are drawn in [designs/web/mockups/00-foundations.html](../designs/web/mockups/00-foundations.html) (board "Khung ứng dụng và thanh bên theo vai trò") and in the shell of every other frame; the decisions that led to them are in [designs/web/brief.md](../designs/web/brief.md) and [ui/admin.md](ui/admin.md).

The contracts below were folded into [data-model.md](data-model.md) and [api-outline.md](api-outline.md) on 2026-10-30 as proposals (brief rows Z1 to Z9, section "Z. App shell"); this document keeps the reasoning. Facts already decided are marked *existing*; everything else is a *proposal*.

## 1. What the shell has to do

| Need | Source of the rule |
|---|---|
| Show only the items the signed-in role can use (an unusable item is **not rendered**, not greyed) | Role matrix: `03-ia-roles-components.md` section 2, frame 00 |
| Show only the branches the person works at; `ADMIN` also gets "Tất cả chi nhánh" | `staff_branches` (data model), "Branch scoping" (api-outline) |
| Show a count next to `Đơn hàng` (orders waiting for acceptance in the selected branches) and next to `Đánh giá` (open reports, phase 2) and, if enabled, `Hóa đơn` (overdue invoices) | Frames 00, 02, 14, 28 |
| Stay correct when access changes while a page is open | Denied-access rules, frame 00 |
| Keep working when the connection drops | ADR-0007, ADR-0009 risk 4 |

The server is always the authority. The browser only hides what a role cannot use.

## 2. Contract for `GET /admin/meta/config` (proposal; the outline lists the content, not the shape)

Role `staff` and above. One call at start-up, again after `config.changed`, after a `FORBIDDEN`, and when the tab returns after a long absence.

```json
{
  "user": { "id": "uuid", "displayName": "Nguyễn Phúc", "role": "MANAGER", "mfaEnabled": true },
  "branches": [ { "id": "uuid", "code": "BT", "name": "Kitchen Daylight · Bến Thành", "status": "ACTIVE" } ],
  "permissions": ["orders.read", "orders.write", "menu.write", "reviews.moderate", "reports.read", "exports.read", "invoices.manage"],
  "features": { "reservations": true, "vouchers": true, "promotions": true, "loyalty": false, "charts": false, "einvoice": false },
  "ordering": { "boardThresholds": {}, "boardRefetchSeconds": 15 },
  "brand": { "hotline": "+842838220000", "receipt": { "paperWidth": 80 } },
  "reports": { "businessDayStartsAt": "04:00" },
  "maintenance": { "active": false },
  "navCountsRefetchSeconds": 30
}
```

- `branches` is the list the switcher shows. For `ADMIN` it is every branch (the UI adds "Tất cả chi nhánh").
- `permissions` is a flat list of capability keys computed by the server from the role and the feature flags. The client **does not repeat the role matrix**: each menu item and route names the key it needs. Changing who may do what is then a server change.
- `features` extends the existing `featureFlags` (`ordering`, `delivery`, `reservations`, `loyalty`) with the flags the admin needs for `vouchers`, `promotions`, `charts` and `einvoice` (the outline names `einvoice` only for the deferred feature).
- Not returned: secrets, bank details beyond what staff need (gap A13 of the brief), anything from `app-settings` that is admin-only.

*Why not put the role in the access token only?* The token is checked on every request, so a role change is already enforced by the API; but the UI needs the full capability list and the branch list on screen, and a token that carries them goes stale. The call is cheap and refetched on the events above.

## 3. Counts on the sidebar (proposal)

`GET /admin/nav-counts?branchIds[]=<id>&branchIds[]=<id>` (role `staff`). The ids are checked against the caller's branches: an id outside them returns `404` (the same rule as everywhere); no `branchIds[]` means all the caller's branches.

```json
{ "generatedAt": "2026-10-27T05:05:41Z",
  "newOrders": 3,
  "openReports": 1,
  "overdueInvoices": 4 }
```

- `newOrders`: orders in `PLACED` of the selected branches (the same count as the `Mới` column header).
- `openReports`: `review_reports` with status `OPEN` or `IN_REVIEW` for reviews of the selected branches. Omitted for `STAFF` and when the feature is off (phase 2).
- `overdueInvoices`: invoices past `tax.invoice_due_hours`. Present only when `features.einvoice` is on and the role may manage invoices.
- Cheap by design: three indexed counts, no row data, no customer data. Suggested cache on the server: a few seconds.

**How the numbers stay fresh** (signal, then fetch, as in ADR-0007): the client refetches `nav-counts` when it receives `order.placed`, `order.status_changed`, `order.cancelled`, `report.created`, `report.resolved` (and an invoice event if one is added), debounced to one call per second; and every `navCountsRefetchSeconds` as the fallback when the connection is down. The orders board already loads every active order, so on that screen the count can be taken from the board state instead of calling the endpoint.

*Alternative rejected:* computing the numbers in the browser from the lists. It needs the full lists on every page and gets the scope wrong for roles that must not see revenue or reports.

## 4. Branch selection (proposal)

- The selection is a set of branch ids from `meta.branches`. A single-branch user sees the branch name as a label, with no switcher.
- State: the URL query `?b=BT,COL` (codes, readable and shareable inside the team) is the source of truth for the page; the last choice is stored in `localStorage` as the default for the next visit. Nothing is stored on the server (no new column; `users.preferred_branch_id` belongs to the customer app).
- At start-up every code in the URL or storage that is not in `meta.branches` is dropped silently; if nothing is left the default is all the user's branches (`ADMIN`: all).
- Every list and count endpoint takes `branchIds[]` (today the outline has `branchId?` only; brief gaps A29, V1, R5, F1). Screens that act on one branch (counter order, a branch editor) take the single branch from the page, not from the switcher, and a multi-branch selection shows `Chọn chi nhánh` there.
- A realtime event for a branch outside the selection does not touch the page but still refetches the counts of the sidebar only if that branch is in the selection.

## 5. Building the menu and guarding routes (proposal)

The menu is data in the client, one entry per item of `03-ia-roles-components.md` section 2 plus `Hóa đơn`:

| Item | Route | Needs permission | Needs feature | Count |
|---|---|---|---|---|
| Tổng quan | `/dashboard` | `orders.read` | | |
| Đơn hàng › Bảng đơn, Tạo đơn tại quầy, Lịch sử đơn | `/orders/...` | `orders.read` | | `newOrders` |
| Thực đơn › Món ăn, Danh mục và thẻ | `/menu/...` | `menu.write` | | |
| Thực đơn › Hết món và tồn kho | `/menu/availability` | `orders.read` | | |
| Chi nhánh | `/branches` | `branches.write` | | |
| Đặt bàn | `/reservations` | `orders.read` | `reservations` | |
| Ưu đãi | `/promotions/...` | `promotions.write` | `vouchers` or `promotions` | |
| Đánh giá | `/reviews` | `reviews.read` | | `openReports` |
| Báo cáo | `/reports` | `reports.read` | | |
| Hóa đơn | `/invoices` | `invoices.manage` | `einvoice` | `overdueInvoices` |
| Người dùng, Cài đặt, Email, Nhật ký | `/users`, `/settings`, `/email`, `/audit` | `admin.*` | | |
| Tệp đã xuất | `/exports` | `exports.read` | | |

- An item whose permission or feature is missing is **not rendered**. The labels `GĐ1`, `GĐ2`, `GĐ3`, `Admin` and `Chưa bật` in the frames are design notes and do not exist in the product.
- Each route declares the same permission and feature. A guard that fails shows the page "Bạn không có quyền xem trang này" (nothing is fetched). A record outside the user's branches shows "Không tìm thấy" (the API returned `404`).
- **When access changes under an open page:** any `403 FORBIDDEN` makes the client refetch `meta/config`; if `permissions` changed it rebuilds the menu and shows the denied page for the current route instead of an error toast. `user.suspended` and `session.revoked` sign the person out at once. `config.changed` refetches `meta/config`; maintenance does not block the admin (decided in W13B).

## 6. Sign-in state and connection (existing decisions, one proposal)

- *Existing:* login with a TOTP step for `MANAGER` and `ADMIN`; the access token lives in memory and the refresh token in an HttpOnly cookie (ADR-0003, api-outline "Authentication, staff transport"); `X-Client: admin-web`.
- *Proposal:* one silent refresh at a time (a "single flight" shared by all waiting requests); if the refresh fails the app returns to login and keeps the unsent form in memory; a `401 TOKEN_EXPIRED` is retried once after the refresh, any other `401` goes to login.
- *Existing:* the board must not depend on realtime alone: the top bar shows `Đang kết nối`, `Đang thử lại`, `Mất kết nối` and the board refetches on reconnect and every `boardRefetchSeconds`. The same connection signal drives the sidebar counts.

## 7. Suggested structure in the Angular app (ADR-0001; suggestions only)

| Piece | Responsibility |
|---|---|
| `SessionStore` (signals) | `user`, `branches`, `permissions`, `features`, loaded from `meta/config`; `can(key)`; refetch rules of section 5 |
| `BranchSelectionService` | The selected ids, URL and `localStorage` sync, validation against `SessionStore.branches` |
| `NavCountsService` | Calls of section 3, debounce, fallback timer, exposes one signal per count |
| `RealtimeService` | The connection (one per tab), connection state signal, events to the services above |
| `ShellComponent` | Sidebar (menu data of section 5), top bar, content outlet, connection line |
| HTTP interceptors | Bearer token, `X-Client`, `Accept-Language`, `problem+json` to a typed error (`code`, `errors[]`), single-flight refresh, `FORBIDDEN` to the refetch rule |
| Route guards | Permission and feature check from the route data; the denied page |

## 8. Tests that this design needs

- **Matrix test per role** (`STAFF`, `MANAGER`, `ADMIN`): the menu that `meta/config` produces equals the role table; no unusable item is rendered; the denied page is shown for a typed URL.
- **Branch scoping:** every list and count endpoint with a branch id outside the caller's branches returns `404`; `ADMIN` sees all; a request with no `branchIds[]` uses the caller's own set.
- **Contract test** for `meta/config` and `nav-counts` shapes (the OpenAPI snapshot, as for the rest of the API).
- **Counts consistency:** `newOrders` equals the number of `PLACED` orders the board shows for the same branches.
- **Role change while open:** a role downgrade makes the next request `FORBIDDEN`, the client refetches and shows the denied page.

(Per the owner's rule, tests are run by the owner; this document only lists them.)

## 9. Decisions on the open points (owner, 2026-10-30, "chốt các điểm mở": accepted as proposed)

1. **Grain of `permissions`:** the client receives capability keys, not the role. The role matrix lives in one place, on the server.
2. **Sidebar counts:** their own endpoint, `GET /admin/nav-counts`, not folded into `GET /admin/dashboard` (the dashboard is heavier and hidden from `STAFF`).
3. **Invoice events:** no realtime event for invoices for now; the fallback timer (`navCountsRefetchSeconds`) is enough. Revisit if e-invoices are enabled and managers miss failures.
4. **Branch selection on two devices:** not synced; each device keeps its own.
5. **Key and feature names:** the permission keys and feature names in sections 2 and 5 are the working names; the engineers may rename them when writing the OpenAPI document, keeping the same grain.

Still open (outside this document): the final list of keys, and the gaps Z1 to Z9 of the brief, which are not yet in `data-model.md` or `api-outline.md`.
