# Kitchen Daylight mobile: design brief (customer app of the owner's restaurant)

Status: **draft for review, revision 4 (2026-11-03).** Revision 3 rebuilds the mobile design for [ADR-0009](../../docs/adr/0009-owner-business-pivot.md): VER.02 is the app of the owner's own restaurant (one brand, several branches, menu, pickup and delivery orders, loyalty and vouchers in phase 2, **no payment in the app**), no longer a directory of third-party venues. The directory version of this brief and its frames are archived in [designs/archive/directory-version/](../archive/directory-version/README.md) (`mobile-brief.md`, `mobile/mockups/`). This revision implements step 2 of [docs/ui/README.md](../../docs/ui/README.md) for the customer app, using the tokens in [docs/ui/style-direction.md](../../docs/ui/style-direction.md), the schema in [docs/data-model.md](../../docs/data-model.md) (v5) and the endpoints in [docs/api-outline.md](../../docs/api-outline.md) (v3). It keeps the structure of the earlier brief and of the admin frames in [designs/web](../web/brief.md) so the two sets read the same way. Sample data is the same pool as the web frames; where the two differ, the web file wins. **Revision 4 (2026-11-03)** adds the two phase 2 frames (16 reservations, 17 vouchers and points) and records the changes the owner asked for after looking at the rendered frames: denser lists, a Phosphor icon set, attention motion, a modern surface language and a commerce layer (section "Revision 4: changes after the owner's review of the frames"). The gap rows of the phase 2 frames and of the commerce layer are in section J.

The folder is self-contained so it can be copied into the code repository:

```
designs/mobile/
  brief.md                this file
  mockups/
    index.html            frame index
    00 ... 17-*.html      one page per screen group (static HTML, no server or build); 16 and 17 are phase 2
    mobile.css            shared components (the business components are appended at the end)
    tokens.css            copy of the token file (= docs/ui/tokens/tokens.css; do not edit here)
```

Open `mockups/index.html` in any current browser. Every page has a "Sáng / tối" switch (the tokens carry both modes); main screens are also drawn light and dark side by side. Page text is Vietnamese; the logo files are in `designs/brand/`; this brief and the spec tables are English in the repository rules, but the captions and the "Dữ liệu" tables inside the frames are Vietnamese, as in the earlier frames.

## How to read a frame

- **Boards.** A frame holds main boards (the screen in a 390 x 844 phone outline) and extra boards for states, dialogs and variants (loading, empty, error, offline, permission denied, guest, every server error that has a code in the API outline).
- **`data-bind`.** Key elements carry a `data-bind` attribute naming the table, column or endpoint they read or write. It is documentation for implementers, not behaviour.
- **"Dữ liệu" table** at the bottom of each frame: UI element, data, rule, with a `Quyền` row (who can see or do it) and a `Lỗi` row (error codes and where each is drawn). This ties the design to the schema and the API outline.
- **Not product UI:** the phone outline, the status bar and Dynamic Island, the captions, and the "GĐ2" tag (phase 2 features, shown only when the feature flag is on). The system keyboard, the OS permission dialog and the share sheet are not drawn (a minimal OS permission dialog is sketched in frame 02 and labelled as an illustration).
- **Sample data** is fictional (section "Sample data"). Food photos are gradient placeholders; the map is a drawing. The status bar clock is 12:05 on Tuesday 27/10/2026.
- **Screen codes** (M1, M3 ...) are inherited from the earlier mobile spec and are not unique per frame (see deviation 14).

## Decisions

### Decisions of ADR-0009 this design relies on

| Topic | Decision | Effect on the frames |
|---|---|---|
| Business model | One brand, several branches; each branch has its own hours, availability and staff | A branch pill in the Home and Menu headers; branch is global state (`users.preferred_branch_id`, or on the device) |
| Payment | No payment in the app: cash or bank transfer, confirmed by staff; no gateway, no card data | Cash or transfer rows only; transfer details appear after the order, only on the customer's own unpaid order (`Order.transferInfo`) |
| `WA1` | Working name stays Kitchen Daylight; the real name goes in `app_settings.brand` | The name and logo are a placeholder to replace |
| `WA2` | Delivery by the restaurant's own staff; concentric zones by straight-line distance with fee, minimum and ETA | Delivery fee shown as "from" until an address is chosen; below minimum and out of zone have drawn states |
| `WA3` | Order status in the app only (realtime while open, refetch on resume); **no push, no SMS, no order emails** | Frame 15 states it; a customer who closed the app sees the new status on reopening |
| `WA6` | One review per completed order with a public owner reply | Reviews are written from an order; own review shows moderation status |
| `WA7` | Vouchers are public codes or assigned; one voucher per order that never covers the delivery fee; points are earned per VND and redeemed as a discount | Voucher and points rows carry the GĐ2 tag |
| `WA8` | Reservations are free, no deposit | Reservation entry points carry the GĐ2 tag |
| `WA10` | An account with a verified email is needed to order; a phone number is required at the first order and is not verified in the first release | Register has no phone field; `PHONE_REQUIRED` and `EMAIL_NOT_VERIFIED` gates at checkout |
| `WA11` | `view_history` is dropped; "order again" replaces it; favorites are dishes | No viewed list; the Orders tab and reorder replace it |
| `WA12` | A paid order that is cancelled or rejected is marked `REFUNDED` by staff by hand; completed needs paid | Payment pills, "Quán sẽ liên hệ để hoàn tiền" |
| `WA15`, `WA16` | Stock is taken at placement; `ordering` defaults accepted (refetch, call hint after 10 minutes, auto-cancel off) | Low-stock and sold-out states, the call hint on order tracking |
| `WA17`, `WA22` | No e-invoice in the first release (printed receipt, Excel statistics); e-invoices designed and deferred | No invoice UI in the customer app |
| Role model | `CUSTOMER`, `STAFF`, `MANAGER`, `ADMIN`; staff are branch-scoped | The customer app rejects staff accounts at sign-in (generic message) |

### Design decisions

| Topic | Decision | Why |
|---|---|---|
| Visual language | Photo-first, cool Water palette: ocean blue for actions and selection, teal for open / verified / success, violet for warnings (always with icon and text), red only for errors (a cancelled order is neutral, not red). Glass only on chrome | style-direction.md |
| Navigation | Four tabs: Trang chủ, Thực đơn, Đơn hàng, Tôi. The cart is not a tab: a floating cart bar on Menu and Item, and a cart button in the Home header. Item, cart, checkout, tracking, reviews, reports, auth and delete flows are pushed screens or sheets | ADR-0009, 03-ia-components |
| Branch change | Changing the branch with a non-empty cart asks for confirmation and refreshes the cart | One menu with per-branch availability and prices (schema), so lines may differ per branch |
| Guest first | Browse branches and menu and fill a cart signed out. Sign-in is asked for at checkout and returns to the cart; a verified email is needed to place the order | principle 2, `WA10` |
| Cart | Kept on the device, validated by the server (`POST /orders/quote` on every change, and again when the order is placed with `expectedTotal`); a sold-out line blocks checkout until the customer removes it | ADR-0009 (cart on the device); the app never changes a customer's cart silently |
| Money | Integer VND shown `65.000đ`; no price ranges (an item has one price); free-delivery threshold compares with the subtotal | content formats in docs/ui |
| Order safety | Every order carries an `Idempotency-Key`; after a lost response the app says it is not sure the order was sent and sends the user to the Orders tab, retry reuses the key | ADR-0009 risk 4 and 5 |
| Honest data | Allergen and dietary labels say "chưa xác minh" until a manager verifies them; a closed, paused or past-cutoff branch is marked on the card and the button before the user navigates | principle 3 |
| Privacy | Location is explained before the OS prompt and the app works without it; consent is never pre-ticked; account deletion is two taps from the Tôi tab; the phone number is not verified | principle 4 |
| Lists | Orders, favorites, addresses and reviews are paged; every list that can grow has a pager even when the sample is short | api-outline |
| Optimistic actions | Favorite, unfavorite and delete-review update at once and roll back on error, with "Hoàn tác" where it makes sense | polish checklist |
| Touch and accessibility | Targets at least 44 x 44; no text below 12 px; state never by color alone; icon buttons carry labels; layouts must survive 200% text; reduced motion and transparency respected | principle 5 |
| Enum labels | One Vietnamese label and one pill style per enum value, defined in frame 00 | Consistency across lists, detail and tracking |
| Realtime | 14 events reach the mobile app; small changes update in place, large ones show a "Làm mới" pill; reconnecting strip; no replay, refetch on reconnect and resume | ADR-0007, ADR-0008 #7 to #12 |

## Frame index

| Frame | Screens | Phase | Main data | Drawn |
|---|---|---|---|---|
| 00 Foundations (`00-foundations.html`) | Colors, type, shape, controls, glass chrome, icons, the enum label map (order, payment, service state, reservation, voucher), content formats, components (item row and card, branch card, stepper and options, cart bar and totals, timelines, voucher card) | 1 | `orders.status`, `orders.payment_status`, `branches.status`, `menu_items`, tokens | 18 boards |
| 01 Home (`01-home.html`) | M1 restaurant home: branch pill, active-orders ribbon, search, service switch, promo banner (GĐ2), reorder card, categories, popular items, nearest branches; states (closed, paused, loading, offline, error, guest, cart bar) | 1 | `GET /home`, `branches`, `orders`, `promotions`, `delivery_zones` | 16 boards, 30 phones |
| 02 Branches (`02-branches.html`) | M3 and M4 branch picker, map and list, location priming (F4), change branch with a non-empty cart, branch detail (hours, delivery zones, amenities, reviews), status variants | 1 | `GET /branches`, `branches`, `branch_opening_periods`, `delivery_zones`, `reviews`, GPS | 11 boards, 45 phones |
| 03 Menu (`03-menu.html`) | M2 menu with category bar, quick add, search and filter, ordering-unavailable states, live availability | 1 | `GET /branches/{id}/menu`, `GET /menu/search`, `menu_items`, `branch_menu_items`, `tags` | 13 boards, 55 phones |
| 04 Item (`04-item.html`) | M5 item sheet with option groups, quantity and note, sold out, low stock, favorite, allergen notice, states | 1 | `GET /menu/items/{id}`, `item_option_groups`, `branch_menu_items`, `favorite_items` | 16 boards, 67 phones |
| 05 Cart (`05-cart.html`) | M6 cart (device-local), pickup or delivery, free-delivery progress, quote warnings, dialogs, guest, states | 1 | `POST /orders/quote`, `branches`, `delivery_zones`, `vouchers` (GĐ2) | 9 boards, 46 phones |
| 06 Checkout (`06-checkout.html`) | M7 place the order (cash or bank transfer), address sheet, scheduled time, phone and email gates, every server error, success with transfer card | 1 | `POST /orders` (`Idempotency-Key`), `orders`, `customer_addresses`, `app_settings.payment` | 22 boards, 89 phones |
| 07 Order tracking (`07-order-tracking.html`) | M8 status, timeline, cancel, payment states, review prompt, live updates, states | 1 | `GET /orders/{id}`, `orders`, `order_items`, `order_status_events` | 8 boards, 50 phones |
| 08 Orders (`08-orders.html`) | M9 Orders tab (in progress, history), reorder check, guest, states, paging | 1 | `GET /me/orders`, `POST /orders/{id}/reorder` | 6 boards, 32 phones |
| 09 Reviews (`09-reviews.html`) | M5 and M6 write and edit a review of a completed order, own reviews with moderation status, all reviews of a branch, owner reply | 1 | `reviews`, `GET /me/reviews`, `GET /branches/{id}/reviews` | 14 boards, 54 phones |
| 10 Report (`10-report.html`) | M7 report a review (every board tagged GĐ2) | 2 (drawn now) | `review_reports` | 5 boards, 19 phones |
| 11 Account (`11-account.html`) | M9 Tôi tab, edit profile, addresses, favorite dishes, devices (GĐ2), terms, change password, appearance, sign out | 1 | `users`, `customer_addresses`, `favorite_items`, `consent_documents`, `user_consents` | 17 boards, 68 phones |
| 12 Auth (`12-auth.html`) | M10 sign-in, register with consent (F3), social first-time consent, 6-digit code flows, return-to-cart behavior | 1 | `users`, `auth_identities`, `email_tokens`, `user_consents` | 5 boards, 18 phones |
| 13 Delete account (`13-delete-account.html`) | M11 / F6 what is removed and kept, re-authenticate, type XÓA, blocked by active orders or reservation, done | 1 | `DELETE /me`, `users` tombstone, `orders` | 4 boards, 15 phones |
| 14 System states (`14-system-states.html`) | M14 forced update, maintenance, offline, load error, session expired, suspended, rate limited, branch paused, outside ordering hours, lost connection while ordering, cart needs update, splash, icon | 1 | `GET /meta/config`, `branches.status`, `429 RATE_LIMITED` | 7 boards, 21 phones |
| 15 Realtime on mobile (`15-realtime.html`) | Live effects of the 14 events the mobile app receives, no push, reconnecting, resume, guest | 1 | `outbox_events`, `row_version`, api-outline v3 events | 10 boards, 35 phones |
| 16 Reservations (`16-reservations.html`) | M17 new reservation form (branch, 14-day date strip, party size, 5-column time grid with "Hết chỗ"), `SLOT_UNAVAILABLE` with nearest slots, validation and rate-limit errors, my reservations (upcoming, past, seated), cancel, live `reservation.status_changed`, states, paging (every board tagged GĐ2) | 2 | `reservations`, `reservation_tables`, `restaurant_tables`, `GET /branches/{id}/reservation-slots`, `POST /reservations`, `GET /me/reservations` | 19 boards, 57 phones |
| 17 Vouchers and points (`17-vouchers-points.html`) | M18 voucher wallet and code entry (one message `Mã không dùng được` for every `VOUCHER_INVALID`), picking a voucher from the cart, points balance, rates marked as examples, ledger with six reason types, cross-reference of voucher and points in cart and checkout (the voucher never discounts the delivery fee), guest, loyalty switched off, states, paging (every board tagged GĐ2) | 2 | `vouchers`, `voucher_redemptions`, `loyalty_accounts`, `loyalty_ledger`, `GET /me/vouchers`, `GET /me/points`, `POST /vouchers/validate` | 13 boards, 43 phones |

The twelve copies of the retired directory-version frames that used to sit in this folder (`01-explore`, `02-search`, `03-nearby`, `04-place-detail`, `05-reviews`, `06-report`, `07-saved-history`, `08-account`, `09-auth`, `10-delete-account`, `11-system-states`, `12-realtime`) were moved, not deleted, to `designs/archive/directory-version/mobile/replaced/` on 2026-11-03 after the owner confirmed (each was byte-identical to its archive copy).

## Sample data

Fictional, the same people, branches, menu and orders as the admin web ([designs/web](../web/brief.md)); if the two differ, the web file wins. Totals were checked: `total = subtotal - discount_total + delivery_fee`, with `discount_total = voucher_discount + points_discount` (both 0 in phase 1 samples). The order number prefix is `branches.code`. "Today" is Tuesday 27/10/2026, the status bar clock is 12:05, the brand is Kitchen Daylight (working name, `WA1`), hotline `028 3822 0000`.

**Branches**

| Code | Name | Address (UI) | Services | Hours today |
|---|---|---|---|---|
| `BT` | Kitchen Daylight · Bến Thành | 25 Lê Lợi, P. Bến Thành, TP. Hồ Chí Minh | pickup, delivery, reservations | 10:00 - 22:00 (delivery 10:30 - 21:30) |
| `COL` | Kitchen Daylight · Cầu Ông Lãnh | 78 Võ Văn Kiệt, P. Cầu Ông Lãnh, TP. Hồ Chí Minh | pickup, delivery | 09:00 - 21:00 |

A third branch, "Xuân Hòa", exists only in the mobile frames, for the picker's scroll. Delivery zones of `BT`: ring 1 up to 2.000 m, fee `15.000đ`, minimum `60.000đ`, free over `250.000đ`, ETA 30 min; ring 2 up to 4.000 m, fee `25.000đ`, minimum `100.000đ`, ETA 45 min. `COL`: one ring up to 3.000 m, fee `20.000đ`, minimum `80.000đ`, ETA 40 min. Order cutoff 30 minutes before closing.

**Menu** (categories in order: Món chính, Cơm, Bún và phở, Món chay, Ăn vặt, Đồ uống, Tráng miệng; "Món chính" has no item in the sample)

| Item | Category | Price | Notes |
|---|---|---|---|
| Cơm gà nướng mật ong | Cơm | 65.000đ | Size (required, 1 of 2: Vừa +0, Lớn +10.000đ); Thêm (optional, up to 2: Trứng ốp la +8.000đ, Chả lụa +10.000đ, Dưa leo muối +5.000đ); Mức cay (required, 1 of 3). Tag Cay |
| Cơm sườn nướng | Cơm | 69.000đ | Stock tracked: 3 left at `BT`, sold out at `COL` |
| Bún bò Huế | Bún và phở | 60.000đ | Thêm (optional): Giò heo +15.000đ, Chả cua +12.000đ |
| Phở bò tái | Bún và phở | 60.000đ | Size required: Thường +0, Đặc biệt +15.000đ |
| Cơm chay Sen Vàng | Món chay | 55.000đ | Dietary tag Chay, verified. A second chay item, Đậu hũ sả ớt 48.000đ, is unverified |
| Gỏi cuốn tôm thịt (2 cuốn) | Ăn vặt | 35.000đ | Allergen tag Tôm, unverified |
| Chả giò chiên (4 cuốn) | Ăn vặt | 38.000đ | Label "Bán chạy" |
| Cà phê sữa đá | Đồ uống | 29.000đ | Size required (Vừa, Lớn +6.000đ), Đá, Đường |
| Trà đào cam sả | Đồ uống | 39.000đ | Size required (Vừa +0, Lớn +6.000đ, so 45.000đ) |
| Chè bưởi | Tráng miệng | 30.000đ | |
| Bánh flan | Tráng miệng | 25.000đ | Sold out everywhere (`is_available = false`) |

**Customer:** Nguyễn Hà (`ha.nguyen@example.com`), phone `0901 234 567` (stored `+84901234567`), email verified; second customer for lists: Trần Bảo (shown to others as "Bảo"). Saved address "Nhà": 18 Nguyễn Huệ, P. Bến Thành, about 900 m from `BT`.

**Orders of Nguyễn Hà** (number `{branchCode}-{yyMMdd}-{seq}`)

| Number | Branch | Type | Status | Placed | Content | Total |
|---|---|---|---|---|---|---|
| `BT-261027-0042` | BT | DELIVERY | `PREPARING` | 11:44 | Cơm gà nướng mật ong (Lớn, Trứng ốp la, Vừa) x1; Trà đào cam sả (Lớn) x2; fee 15.000đ | 188.000đ |
| `BT-261027-0041` | BT | PICKUP | `READY` | 11:38 | Bún bò Huế x2 | 120.000đ |
| `BT-261026-0107` | BT | PICKUP | `COMPLETED`, reviewed 4 stars | yesterday 18:20 | Cơm chay Sen Vàng x1; Chè bưởi x1 | 85.000đ |
| `COL-261024-0033` | COL | DELIVERY | `CANCELLED` by customer | 24/10/2026 | | 140.000đ |
| `BT-261020-0088` | BT | DELIVERY | `REJECTED` ("Hết nguyên liệu") | 20/10/2026 | | 96.000đ (see gap G77) |

Hà has two open orders at once (0041 and 0042). **Bank transfer details** (fictional, `app_settings.payment`): bank Vietcombank, account `0071 0012 3456 7`, holder `CONG TY KITCHEN DAYLIGHT`, note = the order number; shown only on the customer's own unpaid `BANK_TRANSFER` order. **Courier:** Lê Dũng, `0903 456 789`, typed by staff when the order leaves. **Voucher and points (phase 2):** `CHAO25` 25.000đ off, minimum 150.000đ, valid to 30/11/2026; `FREESHIP` is not allowed (`WA7`); balance 320 points, 1 point per 1.000đ spent, 1 point = 100đ off (placeholders, `app_settings.loyalty`). **Reviews:** Trần Bảo 5 stars "Cơm gà thơm, giao nhanh." with the owner reply "Cảm ơn bạn, hẹn gặp lại ở Kitchen Daylight."; Hà's own review of `BT-261026-0107`: 4 stars.

## Screen to data summary

| Screen | Reads | Writes |
|---|---|---|
| M1 Home | `GET /home`: `branches` (`BranchSummary`), `orders` (reorder, in-progress), `promotions` (GĐ2), popular `menu_items`, `menu_categories` | `users.preferred_branch_id` (branch pill), device cart |
| M3, M4 Branches | `GET /branches`, `GET /branches/{id}`: `branches`, `branch_opening_periods`, `branch_special_hours`, `delivery_zones`, `reviews` summary; GPS of the device | `users.preferred_branch_id`; none otherwise (location is a query parameter, never stored) |
| M2 Menu | `GET /branches/{id}/menu`, `GET /menu/search`, `GET /tags`: `menu_categories`, `menu_items`, `branch_menu_items`, `tags` | device cart (quick add); recent searches stay on the device |
| M5 Item | `GET /menu/items/{id}`: `menu_items`, `item_option_groups`, `branch_menu_items`, tags, media | device cart; `favorite_items` (`PUT` / `DELETE /me/favorites/{id}`) |
| M6 Cart | `POST /orders/quote`: `branches`, `delivery_zones`, `branch_menu_items`; `vouchers`, `loyalty_accounts` (GĐ2) | device cart only |
| M7 Checkout | `GET /me/addresses`, `GET /meta/config` (`ordering`, `payment` flag), quote | `POST /orders` (`orders`, `order_items`, stock, outbox event); `customer_addresses`; `users.phone` |
| M8 Order tracking | `GET /orders/{id}`: `orders`, `order_items`, `order_status_events`, `reviews`; `Order.transferInfo` from `app_settings.payment` | `POST /orders/{id}/cancel`; `POST /orders/{id}/reorder` (reads, builds a draft) |
| M9 Orders tab | `GET /me/orders`, review state | none (reorder builds a cart draft) |
| M5, M6 Reviews | `reviews`, `orders`, `GET /me/reviews`, `GET /branches/{id}/reviews` (with owner reply) | `reviews` (create, update, delete) |
| M7 Report (GĐ2) | `reviews` | `review_reports` |
| M9 Tôi | `GET /me`, `customer_addresses`, `favorite_items`, `consent_documents`, `user_consents`, `loyalty_accounts` (GĐ2), `refresh_tokens` (devices, GĐ2) | `users.display_name`, `users.phone`, `customer_addresses`, `favorite_items`, `refresh_tokens` (revoke) |
| M10 Auth | `users`, `auth_identities`, `consent_documents` | `users`, `auth_identities`, `email_tokens`, `user_consents`, `refresh_tokens` |
| M11 Delete account | `users`, active orders | `DELETE /me`: tombstone in `users`, `customer_addresses`, `favorite_items`, `voucher_assignments`, tokens, `loyalty_accounts` (forfeit `ADJUST` row), scrubbed order contact fields, `audit_logs` |
| M17 Reservations (GĐ2) | `GET /branches/{id}/reservation-slots`, `GET /me/reservations`: `reservations`, `reservation_tables`, `restaurant_tables`, `branches` rules | `POST /reservations` (`Idempotency-Key`), `POST /reservations/{id}/cancel` |
| M18 Vouchers and points (GĐ2) | `GET /me/vouchers`, `GET /me/points`: `vouchers`, `voucher_assignments`, `voucher_redemptions`, `loyalty_accounts`, `loyalty_ledger` | `POST /vouchers/validate` (reads only); the discount is written by `POST /orders` (`voucher_redemptions`, `REDEEM_ORDER`) |
| M14 System states | `GET /meta/config`, `branches.status`, quote | none |
| Realtime | `outbox_events` signals (14 events), then the REST reads above | none |

## Revision 4: changes after the owner's review of the frames (2026-11-03)

After the 18 frames existed the owner looked at the rendered pages and asked for the changes below. They are **presentation and information-density changes**; none edits the schema or the API (the fields they need are gap rows G142 to G146). Each was applied by a script or by CSS appended at the end of `mobile.css`, with the earlier files backed up first.

| Change | What the frames do now | Frames |
|---|---|---|
| Denser menu list | One-line name and description, price and tags on one row, 88 px photo, rounded elevated card; about twice as many dishes on the first screen | 03, 11, 14, 15 (and 00) |
| Phosphor icons | All sprites use Phosphor Regular and Fill (MIT) instead of the earlier line set; the Fill drawing marks the selected tab, hearts, stars and map pins; one glyph (`zalo`) has no Phosphor equivalent and keeps its own drawing | all 18 |
| Compact screens | Item sheet (option groups on one header line, 46 px rows), cart (a three-column line item), checkout, tracking, orders, reviews, report, reservations, vouchers; scroll positions of the phones were re-measured after every change | 04 to 10, 13, 16, 17 |
| Home | Search is one icon next to the cart that opens the Menu search; the open state sits under the branch name instead of a separate strip; smaller promo banner | 01, 14, 15 |
| Account | The "Của tôi" header is removed; six quick tiles replace the first list; tinted profile card | 11 |
| Attention motion | "Bán chạy" (light sweep), "Còn N phần" (pulse), missing required option group (shake), unverified allergen, stock limit, price change and bank-transfer amount (pulses), live-update cues, success mark; most run once or three times; every one stops under `prefers-reduced-motion` | 03 to 17 |
| Modern surfaces | Rounded elevated lists with icon chips, tint on the chosen option and on highlighted cards, a lifted action bar; money and status never sit on a saturated gradient | all |
| Commerce layer | Rating and order count on every dish; a featured dish on Home; "Thêm cho đủ bữa" in the cart; "Đặt xong tích N điểm" and "Bạn tiết kiệm …" next to the total; delivery or pickup time on the order button; stock bar on low-stock dishes; placeholder photos tinted per dish | 01, 03, 05, 06, 17 |

The numbers shown by the commerce layer (ratings, order counts, the three suggested dishes, the featured dish) are **sample data**; the server fields they need do not exist yet (G142 to G146). The point preview uses the example rates of frame 17.

## Where the design had to deviate from, or fill a gap in, the documents

I checked every screen against data model v5, the API outline v3 and the ADRs. Each point is resolved in the frames in the way noted and needs the owner's confirmation or a document fix. The API and data gaps themselves are in the next section.

| # | Finding | What the frames do | Needs |
|---|---|---|---|
| 1 | The IA says each branch has its own menu; the schema has one menu with per-branch availability and price (`branch_menu_items`). | Frames follow the schema. Changing branch refreshes the cart rather than moving lines; the confirmation sentence is "Giỏ hàng sẽ được làm mới vì mỗi chi nhánh có thực đơn riêng" (frame 02, 05). | Confirm; if lines should survive a branch change, say which rule (open question 1). |
| 2 | api-outline `reorder` says "last order's items"; reordering a cancelled or rejected order is not meaningful. | Home draws the last **completed** order and hides the card when there is none (owner accepted, M02A). | Fix the api-outline wording. |
| 3 | The location prompt says the location is for choosing a branch and the delivery fee, but the fee is computed from the delivery address (`POST /orders/quote` takes `addressId` or `delivery.location`), not from GPS. | Frame 02 keeps the sentence from the command; GPS only sorts and picks branches. | Reword the priming text, or accept. |
| 4 | Sample order `BT-261020-0088` (web) is a delivery of 96.000đ, which no item plus the 15.000đ fee can give. | Drawn as pickup 96.000đ (Đậu hũ sả ớt x2). Gap G77. | Fix the web sample. |
| 5 | `02-branches.html` still shows the reviewer as "Trần Bảo" (full name) and the label "Phản hồi từ quán" without a date (19 occurrences each, checked 2026-11-02); the review frames show "Bảo" and "Phản hồi từ Kitchen Daylight" with a date. | Not edited (outside the commands so far). | Fix in a review pass or at the final check. |
| 6 | The web review screen shows the `BT` rating as 4,44 over a date range; mobile shows 4,6 (128) overall. | Different scopes, not a conflict. | Know it; no change. |
| 7 | The sample menu has no item in "Món chính", yet Home and Menu list the category. | The Menu hides empty categories; Home still shows the tile (gap G28). | Add an item to the sample or drop the category. |
| 8 | The IA says sign-in is required at checkout "then return to the cart"; the earlier command text said "back to checkout". | Frame 12 returns to the screen that opened it: the cart (whose button then reads "Thanh toán"), or checkout when the session expired there. | Confirm. |
| 9 | The data model's deletion table has no line for `review_reports`, and keeps order contact fields until a retention period is decided. | Frame 13 shows `review_reports` as kept (24 months) and says contact data "will be removed". | Complete the table; legal review (`chờ rà soát pháp lý`). |
| 10 | Delivery fee needs an address, but the cart and Home must show a price before one is chosen. | "Phí từ 15.000đ" and a provisional total (gap G39). | Allow an address-less quote or compute on the device. |
| 11 | The third branch "Xuân Hòa" is needed for the picker's scroll but is not in the web sample. | Exists only in the mobile sample. | Add it to the web sample or remove it. |
| 12 | The closing command named 11 realtime events for mobile; api-outline v3 gives the customer three more (`review.replied`, `reservation.requested`, `reservation.updated`), and its 30-second connection threshold is written for the staff board. | Frame 15 lists all 14 events and applies the same threshold to mobile. | Confirm the three events and the threshold (gap G117). |
| 13 | The old directory-version documents still describe the app as a venue directory (`docs/ui/mobile.md`, `docs/ui/style-direction.md` parts). | Not edited here. | Update in the documents step. |
| 14 | The screen codes M1 to M14 come from the old spec and repeat (M6 is both the cart and the all-reviews list; M9 is both Tôi and Orders). | Kept in the frame bars and the index so earlier references still work. | Renumber when the UI docs are updated. |

### API and data gaps found

Every row of every command report is here (the "Reported in" column says which; two reports that found the same thing share a row). The first column is a stable number for conversations. "Proposal" is what the frames assume; none of it changes `api-outline.md` or `data-model.md`. The status of each row against api-outline v3 was **not** re-checked except where a row says so (checked 2026-11-02).

Two things to know before reading the rows. First, a report claim was retracted: the first claim that `branches.sort_order` does not exist was retracted by M03A (row G8 keeps the correct statement). Second, api-outline v3 now lists `ordering { maxItemQuantity, maxCartLines, callHintMinutes ... }` in `GET /meta/config`, `Order.transferInfo` with `qrUrl?`, `Order.canReview`, `etaAt`, `courier`, `timeline[]`, and `summary { average, count, distribution }` for branch reviews, so the corresponding rows are open only for defaults, values or the rest of their shape.

#### A. Home, branches and availability

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G1 | Home ribbon, Orders tab badge, Tôi row | `GET /home` returns no in-progress orders and `GET /me/orders` has no filter, so the ribbon ("BT-261027-0042 · Đang chuẩn bị +1"), the tab badge and the count on the Tôi row have no source | Add `activeOrders[{ id, orderNumber, status }]` to `/home` (also gives the "+1"), or `GET /me/orders?scope=active` | M02A, M02B, M09, M11A |
| G2 | Home service line | `BranchSummary` lacks pickup preparation time and the lowest delivery fee | Add `pickupPrepMinutes` and `delivery { fromFee, etaMinutes }` | M02A |
| G3 | Home branch card | `BranchSummary` lacks today's hours | Add `hoursToday { open, close }` | M02A |
| G4 | Home status strip, Menu, Cart | `openState.nextChangeAt` does not say whether it is the cutoff or the closing time, and there is no state for "past the order cutoff but still open"; the app must compute it from `order_cutoff_minutes` | Add `openState.acceptingOrders` and `acceptingUntil` / `orderCutoffAt` | M02A, M02B, M04C |
| G5 | Branch picker, branch detail, Menu | `openState` has one state for the whole branch, but delivery hours differ from store hours ("delivery not open yet") | Add `openState.delivery { state, nextChangeAt }` next to the store state | M03A, M03B, M04C |
| G6 | Home category row | `/home` returns no categories and `menu_categories` has no icon column or key | Add `categories[]` to `/home` and an `icon` key to categories | M02A |
| G7 | Home, Menu, Item offline banner | `GET /home` and `GET /branches/{id}/menu` carry no `generatedAt` or ETag for "saved at 11:52" | No API change: the app records the time it stored the response; say so in the API outline | M02B, M04C, M05B |
| G8 | Home and picker without a location | Default branch order when there are no `lat` / `lng` is not stated (note: the first report wrongly claimed `branches.sort_order` does not exist; it does, M03A corrected this) | State `sort_order`, then `name` | M02B, M03A |
| G9 | Branch picker | `GET /branches` has no `limit` or cursor; a chain past about ten branches needs paging or search | Optional `limit` and `cursor`, or state a ceiling on the number of branches | M03A |
| G10 | Map | The map tile source is still open (ADR-0008 open item 1); the frames draw an illustration | Decide the source and the attribution | M03A |
| G11 | Branch detail, TEMPORARILY_CLOSED banner | No column for the manager's pause message; the pause endpoint only has an optional `reason` (open item A25) | `branches.pause_message` (nullable, at most 200 characters) returned as `pauseMessage` by `GET /branches/{id}`; the app drops the line when empty | M03B, M12C |
| G12 | Branch detail, special days | `branch_special_hours.note` is internal (brief C13), so customers only see "special schedule" | Add a customer-facing `display_note` (for example "Nghỉ Tết") | M03B |
| G13 | Branch detail, special days | The window of upcoming special days is not stated (the frames assume 30 days) | The server returns days from today for the next 60 days | M03B |
| G14 | Branch detail, reviews summary | `GET /branches/{id}/reviews` does not say which item is the caller's own, so the app compares `user_id` | Add a `mine` flag to each item | M03B |
| G15 | Branch detail, Item "ask the restaurant", Order tracking call button | `branches.phone` is required (E.164) but its owner screen is still open in the data model (C34); sample data has only the hotline `028 3822 0000` | Confirm per-branch phones; add them to the sample data | M03B, M05B, M08A |
| G16 | Branch detail, amenities | The icon sprite lacks 5 of the 8 fixed amenity icons: `tree`, `door`, `child`, `wheelchair`, `box` | Add the five `<symbol>`s to frame 00 before the app uses them | M03B |
| G17 | Branch removed while selected | What happens to the device cart (it belongs to a branch) when the selected branch is deleted or `CLOSED` | Keep the cart until a new branch is chosen, then ask as for a branch change | M12D |

#### B. Menu, search and item

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G18 | Menu quick add, Home popular items | `MenuItem` has `hasOptions` but not which groups are required, so the app cannot tell whether "+" can add directly | Add `hasRequiredOptions` (or `quickAdd`) to `MenuItem`; the same field is needed by `/home` `popular` | M04A |
| G19 | Menu, Home categories | "Categories with items" does not say empty categories are dropped for a branch | Never return an empty category; `/home` `categories` follows the same rule | M04A |
| G20 | Menu empty state | Unclear whether a branch with no items returns `categories: []` or `404` | `200` with an empty array | M04C |
| G21 | Menu search | `GET /menu/search` does not state the matched fields, the meaning of several words or `tagIds[]`, nor does it return the category name per result or `hasRequiredOptions` | Add `category { id, name }`, `matchedIn: NAME or DESCRIPTION`, `hasRequiredOptions`; AND between words and between tags | M04A, M04B |
| G22 | Menu search as you type | No suggestion mode (at most 8, no paging) | `GET /menu/search?q=&suggest=1`, or `limit=8` without `page` | M04B |
| G23 | Menu filter sheet | No way to exclude an allergen; `tagIds[]` only includes | Add `excludeTagIds[]`; dietary tags filter on `verified` by default (`verifiedOnly`) | M04B |
| G24 | Menu filter sheet | No maximum price parameter | `maxPrice` compared with the effective price | M04B |
| G25 | Menu filter button | "Xem N kết quả" needs a count without loading the list | `countOnly=1`, or return `total` in every response | M04B |
| G26 | Menu filter sheet | The tag list should only offer tags that still have an item at the selected branch | `GET /tags` scoped by `branchId` | M04B |
| G27 | Menu rows, Item | `lowStock.left` is not defined precisely | Return it only when `0 < stock_qty <= low_stock_threshold`, so the app never sees raw stock | M04A |
| G28 | Sample data, Home and Menu | No item in the category "Món chính", so it is empty in the sample menu | Add an item to the sample data or drop the category from the sample | M04A |
| G29 | Live menu | `menu.availability_changed` does not state whether it carries the item name | No: the app looks the item up in the menu it already loaded | M04C |
| G30 | Menu header | The cart's service type (pickup or delivery) has no place on the Menu | A pickup / delivery switch at the top of the Menu, or a banner only on mismatch | M04C |
| G31 | Item sheet | The shape of `optionGroups` is not written down | `optionGroups[{ id, name, minSelect, maxSelect, options[{ id, name, priceDelta, isDefault }] }]` | M05A |
| G32 | Item sheet, cart | Maximum length of `items[].note` is not stated (only a generic `TOO_LONG`) | 200 characters, returned as `ordering.item_note_max` by `GET /meta/config` | M05A |
| G33 | Item sheet, cart **(required topic: `app_settings.ordering` cart limits)** | Per-line quantity and cart-line limits (`max_item_quantity`, `max_cart_lines`) are in `app_settings` and, in api-outline v3, in `GET /meta/config` `ordering { maxItemQuantity, maxCartLines }`; **defaults are still not set** (the frames use 30 lines) | Set defaults (proposed `maxCartLines` 30) in `app_settings.ordering` | M05A, M06A, M06B |
| G34 | Item sheet, cart | `OPTION_INVALID` does not carry which options are invalid | Add `invalid { itemIndex, optionIds[] }` so the edit sheet can name them | M05A |
| G35 | Item sheet | Options are not per branch (known data-model limit) | Accept for the first release; note it for the owner | M05A |
| G36 | Item sheet heart, Favorites | Unclear whether `GET /menu/items/{id}` says the caller favorited it | Add `isFavorite` (only with a token), or read `GET /me/favorites` and filter | M05B |
| G37 | Item sheet, similar items | No official source for "similar items" | Computed on the device (same category, available at the branch); no API | M05B |

#### C. Cart, quote and checkout

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G38 | Cart bar total | `Quote` has no item total that works before a branch with a zone is chosen | Use `Quote.subtotal` once a branch is chosen; before that compute from displayed prices on the device | M01B |
| G39 | Cart, delivery without an address | `POST /orders/quote` requires an address for delivery, but the cart needs a "from" fee and a provisional total | Allow a quote with no address: `deliveryFee: null` plus `deliveryFeeFrom` and the rings; or the app computes from the branch's `delivery_zones` | M06A |
| G40 | Cart free-delivery progress and minimum order | `free_over` and `min_order` of the ring containing the address are needed before ordering | Return `zone { fee, minOrder, freeOver, etaMinutes }` in `Quote` (the `zone` field exists; fix its members) | M06A |
| G41 | Cart voucher and points rows (GĐ2) | `featureFlags` only has `ordering`, `delivery`, `reservations`, `loyalty` | Use `loyalty` for vouchers and points, or add a `vouchers` flag | M06A |
| G42 | Cart warnings | The shape of `Quote.warnings[]` is not defined | `{ code: ITEM_UNAVAILABLE or PRICE_CHANGED or STOCK_LOW or OPTION_INVALID, itemId, ... }` with `was` / `now` for price, `left` for stock, `inactiveOptionIds[]` | M06B |
| G43 | Cart and checkout, branch closed | `BRANCH_CLOSED` should carry `reason` (closed, paused, past cutoff, service off) and `nextOpenAt` so the button text and the dialog can differ | Add `reason` and `nextOpenAt` to the error body | M06B, M07C |
| G44 | Cart offline | The last quote, including `expectedTotal`, must be kept on the device | Note for the app side, no API change | M06B |
| G45 | Checkout, scheduled time | The list of valid time slots (opening hours, delivery hours, minus the cutoff) is not given | Return `slots[]` per day, or the app computes it from opening hours | M07A |
| G46 | Checkout, addresses | No limit for `delivery_note` length or the number of saved addresses per person | 200 characters and, for example, 10 addresses | M07A |
| G47 | Checkout, address sheet | The source of the ward list is still open | Decide; use `GET /wards?provinceCode=` | M07A |
| G48 | Checkout, address sheet | `mapStyleUrl` covers the base map but there is no address search service | No reverse geocoding; state it so the app team does not add one | M07A |
| G49 | Checkout, bank transfer **(required topic: bank-transfer information source)** | `GET /meta/config` does not tell a customer whether the restaurant enabled bank transfer, and bank details must not leak; the frames lock the option when details are missing | Add a flag `payment.bankTransferEnabled` (true when `app_settings.payment` is complete) | M07B |
| G50 | Checkout, bank transfer | The owner must supply real bank details (`app_settings.payment`) before bank transfer can be enabled; the frames show clearly fictional ones | A task for the owner; until then the first release is cash only | M07B |
| G51 | Checkout, bank transfer card | The account number's stored format is not fixed, and the Copy button must copy the right digits | Store one continuous string; the app groups it for display | M07D |
| G52 | Checkout success, bank transfer card | `transferInfo.qrUrl?` exists in the Order shape but the owner has no QR, so it is not drawn | When present: show the QR under the amount with a save button | M07D, M08B |
| G53 | Checkout, receiver phone | `POST /orders` needs a phone but does not say whether it is saved to the profile | The server takes `phone` in the order body, or the app calls `PATCH /me` first; write it down | M07B |
| G54 | Checkout, email gate | Whether `POST /auth/email/send-code` has a daily limit or only 60 seconds | Decide the limit and the `RATE_LIMITED` message (frame 12) | M07B |
| G55 | Checkout, PRICE_CHANGED | The response does not say it carries old and new per-line prices | Return the new quote with full `lines[]` so the app compares with the device cart | M07C |
| G56 | Checkout, ITEM_UNAVAILABLE | `items[]` needs the remaining quantity and the reason | `items[{ id, soldOut, left? }]` | M07C |
| G57 | Checkout, idempotency | Same `Idempotency-Key` with a different body: the response is not defined | `409` (or `422`) with its own code; the app always renews the key when the body changes | M07C |
| G58 | Checkout, non-customer account | `FORBIDDEN` when a non-customer account places an order | Fix the wording, or block staff accounts at sign-in in the customer app | M07C |
| G59 | Checkout success, scheduled order | Unclear whether `eta_at` equals `requested_for` for a scheduled order | When `requested_for` is set, `eta_at = requested_for` | M07D |
| G60 | Checkout success, transfer card | No realtime event for "staff confirmed payment while the customer is still here" | `order.updated` when `payment_status` changes (drawn in frame 15) | M07D |
| G61 | Checkout success | A scheduled delivery order is not drawn separately (same rule as pickup) | None; mention only | M07D |

#### D. Orders, tracking and labels

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G62 | Orders tab | `GET /me/orders` has no tab filter | `scope=active` or `history` (or `status[]`) with a cursor per tab | M09 |
| G63 | Order card | A list item needs the item summary (first two names, count), `canReview` and `review { rating }` so no extra call per order | Add them to each list item | M09 |
| G64 | Orders history | No time limit is stated for a customer's history (92 days exists only for admin) | No limit, only paging | M09 |
| G65 | Reorder | `POST /orders/{id}/reorder` must return, per line, `available`, `priceChanged` (old and new), `invalidOptions[]` and the order's branch; today only "items now unavailable are flagged" | Specify that response | M09 |
| G66 | Reorder across branches | No rule for switching the cart's branch when the old order is from another branch, nor for `max_cart_lines` when merging | Only "refresh the cart" for another branch; clamp to `maxCartLines` | M09 |
| G67 | Orders tab live | How a card crosses tabs and changes the badge on `order.status_changed` without a full reload | Update the list cache locally from the event | M09 |
| G68 | Order cancel | The customer's `cancel_reason` is free text; staff have `cancel_reason_code` | A fixed list for customers (Đặt nhầm món, Muốn đổi món, Chờ quá lâu, Lý do khác) or `cancel_reason_code` for customers too | M08A, M08B |
| G69 | Order cancel retry | After a network loss the order may already be `CANCELLED`; a retry would return `ORDER_NOT_CANCELLABLE` | A repeated cancel by the same customer returns `200` with the current order (idempotent) | M08B |
| G70 | Order tracking, call hint **(required topic: `app_settings.ordering` key for the timeout hint)** | The "call the restaurant" hint after N minutes unaccepted needs `call_hint_minutes` (default 10) in the public config; api-outline v3 lists `ordering.callHintMinutes` in `GET /meta/config` (checked 2026-11-02) | Confirm the key and the default of 10 minutes | M08A |
| G71 | Order tracking, courier | `courier.phone` is optional, so the Call button must hide; that state is not drawn | Draw it, or require a phone | M08A |
| G72 | Order tracking, timeline | The API only says `timeline[]`; it must carry the reason (`note`) and an anonymous `actor` so staff names never reach the customer | Specify both | M08A |
| G73 | Order tracking, refund | `refunded_at` and `paid_at` exist in the schema but `Order` lists neither | Add `paidAt` and `refundedAt` to `Order` | M08B |
| G74 | Order tracking, live | The scope and minimal payload of `order.status_changed` (order id, status, `rowVersion`) | Only the order's own customer; the signal is enough to refetch | M08B |
| G75 | Order tracking, review prompt | `Order.canReview` and the order's review (`rating`, `status`) must be in `GET /orders/{id}` (api-outline v3 now lists `canReview`) | Add the review's rating and status | M08B |
| G76 | Order tracking, offline | No rule for the device copy of orders (how long, which orders) or the time of the last load | Decide the retention on the device | M08B |
| G77 | Sample data (web file) | Order `BT-261020-0088` is a delivery of 96.000đ but no item and 15.000đ fee combination gives that total | Fix the web sample (for example 99.000đ) or make it pickup; the frames draw it as pickup 96.000đ (Đậu hũ sả ớt x2) | M08A |
| G78 | Label map | `orders.type = DINE_IN` and the label "Đã phục vụ" (in the data model since 30/10) are not in the customer label map | Add the chip "Tại bàn" and the label if customers can see such orders | M01A, M01B |
| G79 | Label map, branch pill | `branches.status = CLOSED` (permanently closed) has no label | Assumption: the app hides `CLOSED` branches; the owner to confirm | M01A, M01B |
| G80 | Label map, order detail | `orders.cancelled_by = SYSTEM` (auto-cancel after a timeout) has no label of its own | Keep the "Đã hủy" pill and add a reason line such as "Quán chưa kịp xác nhận" | M01A, M01B |

#### E. Reviews and reports

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G81 | Edit review | No error code for `PATCH /reviews/{id}` on a review that is no longer `PUBLISHED` | `REVIEW_NOT_PUBLISHED` (409) | M10A |
| G82 | Edit review | Body and `rowVersion` of `PATCH` for a customer are not stated | Body `{ rating, body? }`; no `rowVersion` on the customer side | M10A |
| G83 | All reviews | No star filter parameter | `GET /branches/{id}/reviews?rating=1..5` (optional) | M10A |
| G84 | All reviews | Paging of the public list is not stated | `page` / `pageSize`, return `total` | M10A |
| G85 | My reviews | Whether `DELETE` applies to `HIDDEN` or `REMOVED` reviews | No, as drawn | M10A |
| G86 | Delete review | Hard or soft delete, and whether the customer may write again inside the window | Hard delete; may write again inside `review_window_days` | M10A |
| G87 | Review gate | `ORDER_NOT_REVIEWABLE` is one code for three causes (not completed, past the window, not the caller's) | A `reason` in `error.details` to pick the right sentence | M10A |
| G88 | Sample data (web file) | Missing: a `COMPLETED` order older than 7 days and other orders of Hà whose review is hidden or removed | Add them | M10A |
| G89 | Report a review | `DUPLICATE_REPORT` appears only in the `POST /reports` row, not in the error table, with no HTTP status | Add it to the error table (409) | M10B |
| G90 | Report a review | `REVIEW_NOT_PUBLISHED` is still a proposal | Decide to use 409 | M10B |
| G91 | Report a review | Reporting one's own review: the server behavior is not stated | `FORBIDDEN`; the UI already hides the entry on own reviews | M10B |
| G92 | After reporting | The reporter has no endpoint to see the status or outcome of a report | As drawn (none); if needed later `GET /me/reports` | M10B |
| G93 | Sample data (web file) | No visible review of branch `COL` to draw a full list | Add a few `COL` reviews and the `COL` rating | M10B |

#### F. Account, favorites and auth

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G94 | Tôi tab | `GET /me` lists only `displayName`, `phone`, `preferredBranchId`; no email, verification state or avatar | Add `email`, `emailVerifiedAt`, `avatarUrl` | M11A |
| G95 | Edit profile | Maximum length of `display_name` is not stated | 60 characters (CHECK) | M11A |
| G96 | Edit profile | Whether `PATCH /me` may clear the phone (`phone = null`) | Allow it; the next order returns `PHONE_REQUIRED` | M11A |
| G97 | Edit profile | The phone normalization rule is not written | Write it down: accepted national form, stored E.164, Vietnamese mobile numbers | M11A |
| G98 | Change password | An account with only Google or Apple sign-in has no password | The row becomes "Đặt mật khẩu", or is hidden | M11A |
| G99 | Addresses, Favorites, Devices | No paging stated for `GET /me/addresses`, `/me/favorites`, `/me/sessions` | `page` / `pageSize` (default 20) and `total` | M11B |
| G100 | Addresses, undo delete | How "Hoàn tác" works | The app holds the `DELETE` for a few seconds before sending, or add `POST /me/addresses/{id}/restore` | M11B |
| G101 | Addresses | Whether deleting the default address picks another one | No; the next choice happens at checkout | M11B |
| G102 | Favorites **(required topic: favorite items payload)** | How to tell a removed item and a sold-out item per branch in `GET /me/favorites`; the frames need `available`, `soldOut`, `removed` and the price at the selected branch | `GET /me/favorites?branchId=` returns `[{ menuItem, available, soldOut, removed }]`; together with `isFavorite` on the item (see Item sheet) | M11B |
| G103 | Favorites | `PUT /me/favorites/{id}` on a removed item | `NOT_FOUND`; the UI shows "Món không còn trong thực đơn" | M11B |
| G104 | Terms | A guest must be able to read the legal documents | Public `GET /consent-documents/current` | M11B |
| G105 | Sample data (web file) | Missing: an item removed from the menu, a full second address, devices | Add them | M11B |
| G106 | Sign-in and register | `VALIDATION_FAILED` (badly formed email, short password) is not drawn in frame 12 | Draw field errors under the inputs | M12A |
| G107 | Verification code resend | `RATE_LIMITED` on the resend button is not drawn | Draw the message with a countdown from `Retry-After` | M12A |
| G108 | Sign-in | `ACCOUNT_SUSPENDED` is not drawn in frame 12 | Reuse the "Tài khoản đang bị tạm khóa" dialog of frame 06 | M12A |
| G109 | Sign-in and code | Network loss while sending is not drawn in frame 12 | Use the pattern of frame 14 | M12A |

#### G. Account deletion

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G110 | Delete account, what is kept | `review_reports` has no line in the data model's deletion table (only a 24-month retention after resolution) | Add a "keep" line to the deletion table | M12B |
| G111 | Delete account, block | Where the pre-check of in-progress orders and upcoming reservations (GĐ2) comes from | Use the in-progress orders already loaded; for reservations rely on the `409` | M12B |
| G112 | Delete account, block | The `409` body does not say whether orders or a reservation caused it | `details { orders: n, reservations: m }` | M12B |
| G113 | Delete account, what is kept | When the order contact fields are scrubbed (immediately or after a retention period) is not decided; the screen says "will be removed" | Pending the accountant and legal review (`chờ rà soát pháp lý`) | M12B |

#### H. System states and realtime

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G114 | System states, cart needs update | api-outline only has `POST /orders/quote` each time the cart changes, not a re-check on app launch | Write the rule "on launch, non-empty cart: quote again" and the per-line comparison | M12C |
| G115 | System states, cart needs update | Whether the quote returns the old price for the struck-through display, or the app stores the price at add time and compares | The app stores the price when the line is added and compares | M12C |
| G116 | Realtime, order updated | `order.updated` carries `itemsAdded` only; unclear whether it carries a new ETA | Add `eta` to the signal, or the app refetches | M12D |
| G117 | Realtime, connection | "Connection lost after 30 seconds without data" in api-outline is written for the staff board; unclear for mobile | Use the same threshold on mobile | M12D |
| G118 | Realtime, reviews | No separate event tells other customers about a new review; only the aggregate arrives, inside `branch.updated` | Keep, and say so in api-outline | M12D |

#### I. Other topics the closing command requires

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G119 | Cart **(required topic: can a cart be synced across devices)** | Nothing syncs the cart: ADR-0009 keeps it on the device and validates it when the order is placed, and api-outline has no cart endpoint (only `quote` and `reorder`, which builds a draft). A signed-in customer on a second device starts with an empty cart; sign-out and a branch change behave as local rules (a branch change clears it) | Keep it device-local in phase 1 and say so; if sync is wanted later add `GET` and `PUT /me/cart` keyed by branch, with a version. Decide also whether the cart survives sign-out (open question) | M14B |
| G120 | Voucher wallet **(required topic: voucher wallet endpoint shape, GĐ2)** | `GET /me/vouchers` is listed (card: `title`, `code`, `discountType`, `discountValue`, `maxDiscount?`, `minOrder`, `appliesTo`, `branch`, `endsAt`, `state` USABLE, BELOW_MIN, EXPIRED, USED) but there is no call to save a public code into the wallet, no paging, and the `vouchers` array of `GET /home` has no shape; frame 17 is not drawn yet | Add a way to save a code (`POST /me/vouchers { code }`, rate limited, one `VOUCHER_INVALID`), paging for the wallet, and the Home voucher shape; the cart uses `POST /vouchers/validate` | M14B |
| G121 | Home **(required topic: missing fields in `GET /home`)** | Everything `/home` needs that is missing is listed in the rows tagged M02A, M02B and M04A: `activeOrders[]`, `categories[]` with icon, `hasRequiredOptions` on `popular`, `BranchSummary` hours today, prep time, fee and accepting state; plus the `reorder` rule below | Define `reorder` as the last **completed** order (the frames draw that; api-outline says "last order's items") | M14B |

#### J. Phase 2 frames (M13A, M13B) and the 2026-11-03 commerce layer

| # | Screen | Missing | Proposal | Reported in |
|---|---|---|---|---|
| G122 | Reservations, time grid | `GET /branches/{id}/reservation-slots` has no response shape and no reason for a locked slot | `{ date, slots[{ startsAt, available, reason? (FULL, TOO_SOON, PAST) }] }` | M13A |
| G123 | Reservations, `SLOT_UNAVAILABLE` | The `409` carries no suggested times (only `conflicts` on the staff side) | The app computes them from the reloaded slots, or add `alternatives[]` to the error | M13A |
| G124 | Reservations, `VALIDATION_FAILED` | Outside opening hours, too soon, too far and party too large share one code | `details[{ field, reason }]` with `OUTSIDE_OPENING_HOURS`, `TOO_SOON`, `TOO_FAR`, `PARTY_TOO_LARGE` | M13A |
| G125 | Reservations, double booking | No code when the same customer books an overlapping time at the same branch with a different key | `DUPLICATE_RESERVATION` (`409`), or accept it | M13A |
| G126 | Reservations, branch switched off | `POST /reservations` to a branch that no longer takes reservations has no error code; the open form has no event to lock it | `FORBIDDEN` or `NOT_FOUND` or a dedicated code; use `branch.updated` to lock the form | M13A |
| G127 | My reservations | `GET /me/reservations` has no response shape, tabs or paging | `scope=upcoming\|past`, `page` and `pageSize` or `cursor`; each card `branch{name,phone}`, `endsAt`, `tables[{name,seats}]`, `declineReason?`, `canCancel`, `createdAt` | M13A |
| G128 | My reservations, table name | Not stated whether the customer sees the table name | Yes, as drawn (hidden while empty); otherwise drop the line | M13A |
| G129 | Reservation form, note | `reservations.note` has no length limit | 200 characters (`CHECK`) | M13A |
| G130 | Reservation form, email | The outline does not say a verified email is needed to reserve (unlike ordering, `WA10`) | Confirm with the owner; the frame draws no email gate | M13A |
| G131 | Reservation, cancel | A customer cannot edit; cancelling twice returns `INVALID_TRANSITION` (as G69) | `POST /reservations/{id}/cancel` idempotent, `200` with the current status | M13A |
| G132 | Sample data | The web has no reservations of Nguyễn Hà (R1 to R6) and no 30-minute slot step (the web frame types 15) | Add them to the web sample | M13A |
| G133 | Realtime, reservations | No event tells an open form that the branch stopped taking reservations | Use `branch.updated` and say so in the outline | M13A |
| G134 | Points, rates | `app_settings.loyalty` is only readable through the admin endpoint, so the customer app cannot show earn and redeem rates, the minimum or the expiry | Add `rates { earnVndPerPoint, redeemVndPerPoint, minRedeemPoints, expiryMonths }` to `GET /me/points` or to `GET /meta/config` | M13B |
| G135 | Points, ledger | `GET /me/points` has no response shape | `{ balance, updatedAt, items[{ id, createdAt, reason, delta, balanceAfter, order{orderNumber}? }] }`, paged, never the staff `note` of an `ADJUST` | M13B |
| G136 | Voucher wallet, states | `BELOW_MIN` can only be computed with a cart; a voucher not yet started or switched off has no state | Optional query `branchId`, `type`, `subtotal` on `GET /me/vouchers` (without them `BELOW_MIN` is never returned); decide how `starts_at` in the future and `is_active = false` appear | M13B |
| G137 | Voucher validation | `POST /vouchers/validate` requires `type` and `subtotal`, so it cannot run from the Tôi tab with an empty cart, and its success body is not defined | Make both optional (then minimum and service are not checked); define `{ applies, discount, voucher }`; saving a code is G120 | M13B |
| G138 | Cart, redeeming points | The cart has an all-or-nothing switch but the ledger shows partial redemptions (50 points) | `redeemPoints` is an integer; the app sends `min(balance, points the subtotal after voucher allows)`, at least the minimum | M13B |
| G139 | Points ledger, reasons | `REVERSE_EARN` and `EXPIRE` exist in the enum but no flow in the API produces them; the frames draw them as examples | Confirm which flow writes them, or remove them | M13B |
| G140 | Realtime, vouchers and points | No `voucher.updated` or `points.updated` event | The app refetches on open and when its own order becomes `COMPLETED` or cancelled; add events later if wanted | M13B |
| G141 | Cart and checkout, applied voucher and points | Frames 05 and 06 did not draw the applied state; the cross-reference board of frame 17 draws it | When convenient, draw it in 05 and 06 too (a frame fix, no API change) | M13B |
| G142 | Dish rating and popularity | `MenuItem` has no average rating or order count, yet every dish row shows "4,8 · 320+ lượt đặt" | Add `ratingAvg`, `ratingCount`, `orderCount` (rounded, for example "320+") to `MenuItem`, computed from `reviews` and `order_items` | commerce pass |
| G143 | Cart, "Thêm cho đủ bữa" | No endpoint or rule for the suggested dishes | A server rule (same category as missing drinks, best sellers) returned with the quote, or a fixed owner list per branch | commerce pass |
| G144 | Home, featured dish | `GET /home.popular` has no rule for which dish is featured today | `featured` item chosen by the owner (a promotion with `link_type = MENU_ITEM`) or the best seller of the day | commerce pass |
| G145 | Cart, points earned | `Quote` has no "points you will earn", so the app computes `floor((subtotal - voucherDiscount) / earnVndPerPoint)` from G134 | Add `pointsToEarn` to `Quote` | commerce pass |
| G146 | Low-stock bar | `MenuItem.lowStock` has `left` but not the threshold, so the bar cannot show a fraction | `lowStock { left, threshold }` (`branch_menu_items.low_stock_threshold`) | commerce pass |

#### Coverage of the reports

The brief carries 146 numbered rows: 118 of them carry the 140 original report rows of M01A to M12D (22 rows were found by two or more commands and are shared), 3 rows were added by M14B (G119 to G121), and 25 rows were added in revision 4 (G122 to G146: 12 from the report of M13A, 8 from M13B, 5 from the commerce pass). Each original row is carried by exactly one numbered row; the table lists the numbers so a missing row can be found.

| Command | Rows in its report | Carried by |
|---|---|---|
| M01A | 3 | G78, G79, G80 |
| M01B | 4 | G38, G78, G79, G80 |
| M02A | 5 | G1, G2, G3, G4, G6 |
| M02B | 4 | G1, G4, G7, G8 |
| M03A | 4 | G5, G8, G9, G10 |
| M03B | 7 | G5, G11, G12, G13, G14, G15, G16 |
| M04A | 5 | G18, G19, G21, G27, G28 |
| M04B | 6 | G21, G22, G23, G24, G25, G26 |
| M04C | 6 | G4, G5, G7, G20, G29, G30 |
| M05A | 5 | G31, G32, G33, G34, G35 |
| M05B | 4 | G7, G15, G36, G37 |
| M06A | 4 | G33, G39, G40, G41 |
| M06B | 4 | G33, G42, G43, G44 |
| M07A | 4 | G45, G46, G47, G48 |
| M07B | 4 | G49, G50, G53, G54 |
| M07C | 5 | G43, G55, G56, G57, G58 |
| M07D | 5 | G51, G52, G59, G60, G61 |
| M08A | 6 | G15, G68, G70, G71, G72, G77 |
| M08B | 7 | G52, G68, G69, G73, G74, G75, G76 |
| M09 | 7 | G1, G62, G63, G64, G65, G66, G67 |
| M10A | 8 | G81, G82, G83, G84, G85, G86, G87, G88 |
| M10B | 5 | G89, G90, G91, G92, G93 |
| M11A | 6 | G1, G94, G95, G96, G97, G98 |
| M11B | 7 | G99, G100, G101, G102, G103, G104, G105 |
| M12A | 4 | G106, G107, G108, G109 |
| M12B | 4 | G110, G111, G112, G113 |
| M12C | 3 | G11, G114, G115 |
| M12D | 4 | G17, G116, G117, G118 |
| M00, M14A | 0 ("none") | n/a |
| M13A | 12 | G122 to G133 |
| M13B | 8 (a ninth, the missing voucher flag, is already G41) | G134 to G141 |
| M14B | 3 new rows | G119, G120, G121 |
| Commerce pass (2026-11-03) | 5 new rows | G142 to G146 |

Not counted as rows: the reports of M00 and M14A found no gaps. M10A also reported two inconsistencies in other frames (deviations 5 and 6 above) and M03A retracted one claim (see above).

## Status of the findings and questions (2026-11-02)

**Update 2026-11-03:** the gap rows G1 to G146 were folded into `data-model.md` and `api-outline.md` as proposals; see [gaps-coverage.md](gaps-coverage.md). The sentence below that says no command edited those two files stays true for the commands.

The owner accepted every proposal of the commands M01A to M14A ("chốt theo đề xuất" or "đạt") in the review of each command. Accepted does not mean the API or data model was changed: **no command edited `api-outline.md` or `data-model.md`**, so every gap row above is still a proposal until the documents are updated. Questions the owner did not answer individually remain open below. M13A and M13B were accepted the same way ("chốt theo đề xuất", "M13B đạt"). The 2026-11-03 changes (revision 4) were each asked for by the owner in chat and applied; they are not an acceptance of the open questions 20 to 22.

## Open questions

**Decided 2026-11-03 ("OK all").** The owner accepted every recommendation of [../open-questions-sheet.md](../open-questions-sheet.md) for the questions below (web W1 to W85, mobile M1 to M22). Where a row there says **Input**, the recommendation is only a placeholder: the fact it needs (bank details, accountant answers on e-invoices, receipt title, scheduling capacity, auto-cancel minutes) is still owed by the owner or the accountant. Rows that ask for a new field, endpoint or extra board (W36, W56, W67, W69, W70, M7, M10, M11, M18) are follow-ups, not blockers. The question texts below are unchanged.

From every command report, grouped; the letters in brackets are the commands that raised them.

1. **Menu per branch (open since M03A).** One menu with per-branch availability (as drawn), or really separate menus? Should a branch change keep the lines that are still available instead of clearing the cart? (M03A, M03B, M04A, M04B, M04C, M05A)
2. **Favorite heart in menu rows.** Hearts are drawn on the item sheet and in favorites; do menu rows need one? (M04A, M04B, M04C, M05A)
3. **Menu search.** Suggestions when nothing is typed ("Món bán chạy"); keep the chip "Thuần chay" while the sample has no vegetarian item; does the category bar need "Tất cả" during a search; does the owner approve the allergen disclaimer wording (M04B, M05B)
4. **Menu header.** Show the cart's service type permanently on the Menu; keep the "about to stop taking orders" warning 30 minutes before the cutoff (M04C)
5. **Item sheet.** Threshold for full screen versus sheet; may a single-choice group be unselected; keep the note link on items without options (M05A)
6. **Cart.** Split the vouchers and points flags; should guests see the voucher and points rows; should the app remove sold-out lines itself when the cart opens; shared system screen or an inline banner for `RATE_LIMITED` in the cart (M06A, M06B)
7. **Cart on sign-out and branch removal.** Does the cart survive sign-out (M11B); what happens to it when the selected branch disappears (M12D); should an offline launch be drawn for the cart that needs an update (M12C)
8. **Checkout.** A limit of saved addresses (for example 10); may the receiver phone be edited at checkout and written back (M07A, M07B); is the 20-second send timeout right; block ordering entirely under `UPGRADE_REQUIRED` or only at the button (M07C)
9. **Bank transfer.** Does the owner already have the bank details for `app_settings.payment`? Without them the first release is cash only (M07B). Copy button for the amount; show the delivery address on the success screen (M07D)
10. **Order tracking and Orders tab.** Cancel placed in the status block or at the bottom; a retry of cancel (idempotent) or only "check the order"; the four cancel reasons; the "+N" count (portions or lines); a "Theo dõi" button on completed orders; dark boards for the remaining state boards (M08A, M08B, M09)
11. **Home.** Is the promo banner hidden when none is valid or tied to `featureFlags.loyalty`; should "Đặt lại" lock when the branch is closed; keep the cart bar on Home; a board for "about to stop taking orders" on Home (M02A, M02B)
12. **Branch picker and detail.** Keep the priming sentence about the delivery fee; pin color; show the closed state in the picker; a full-screen photo viewer; show `branches.description`; the "Chỉ đường" lock cannot occur because `location` is required (M03A, M03B)
13. **Reviews.** When a customer edits a review that has an owner reply, is the reply kept; can a customer have a completed order and an unverified email in practice; must the reason "Khác" require details; does reporting need a verified email (M10A, M10B)
14. **Account.** For accounts with only social sign-in: hide the password row or turn it into "Đặt mật khẩu"; hotline and "Liên hệ quán" on the Tôi tab; deleting the default address; "Thêm vào giỏ" from favorites when the branch is closed (M11A, M11B)
15. **Auth.** The verified-email success text still says "viết đánh giá" only; a hint line under "Để sau" (M12A)
16. **Delete account.** Which warning comes first when both an order and a reservation block; a scrolled variant of that phone (M12B)
17. **System states.** Should the paused-branch cart bar offer "Xóa giỏ" or "Đổi chi nhánh" (M12C)
18. **Realtime.** A `reservation.status_changed` phone for frame 16 (drawn in M13A, board 17)
19. **Retired copies and scan.** Done on 2026-11-03: the twelve copies were moved to `designs/archive/directory-version/mobile/replaced/`. The final word scan is clean; only the tab label "Lịch sử" of frame 08 and the phrase "Giữ từ bản cũ" in captions of frame 11 are matches of the old words and are not catalog entities (M14A, M14D)

20. **Reservations (M13A).** The date strip shows 14 days although the rule allows 30: add "Ngày khác" with a date picker; a verified-email gate before reserving; show the table name to the customer (G128, G130).
21. **Vouchers and points (M13B).** The web title of `GIAO15` is "Giao hàng giảm 15.000đ", which reads as a delivery-fee discount and contradicts `WA7`: rename it "Đơn giao hàng giảm 15.000đ"? The completed order `BT-261026-0107` has no `EARN_ORDER` row in the sample ledger (the web asks the same); may points also reduce the delivery fee (the frames say no); does the voucher need its own feature flag (G41)?
22. **Commerce layer (2026-11-03).** Who chooses the featured dish and the "Thêm cho đủ bữa" dishes (G143, G144); does the owner want ratings and order counts shown on every dish, and from how many ratings on; keep the example rates in the point preview; approve the Phosphor icon set and the motion (all of it stops under reduced motion).

Things the owner or the accountant still has to provide (from the working rules, not design questions): branch-level menus; the owner's real bank details (`app_settings.payment`); scheduling capacity and limits (`ordering.schedule_*`); auto-cancel of unconfirmed orders (`ordering.auto_cancel_unaccepted_minutes`, off by default); refund handling (manual, `REFUNDED`); whether the customer wants an e-receipt (not in this release); the revenue threshold for e-invoices (accountant); minimum quantity per item; voucher stacking; guest checkout; push notifications; the "call the restaurant" hint minutes; the ward list source; the real restaurant name and logo; a star filter on reviews; points rates.

## Implementation notes (React Native and Expo, ADR-0001)

Suggestions; I have not verified any library API against the version you will install.

| Frame element | Suggested building block |
|---|---|
| Tab bar | Expo Router native tabs on iOS 26 (unstable API) behind one component with a JavaScript fallback (style-direction.md, risk 3) |
| Lists and infinite scroll | TanStack Query infinite queries with a virtualised list; `page` and `pageSize` as in the API; one cursor per Orders tab |
| Images and placeholders | `expo-image` with blurhash from `media.blurhash` |
| Bottom sheets (item, filter, address, cancel, payment, report) | A sheet library or native sheets, chosen at scaffolding; solid surface, radius 28; sheets taller than the screen scroll inside |
| Cart | A device store (persisted), validated by `POST /orders/quote` on every change and again on launch; keep the last quote and the price at add time for the offline and "cart needs update" states; one `Idempotency-Key` per order attempt, renewed when the body changes |
| Money and time | Integer VND everywhere, formatted `65.000đ`; 24-hour times in the restaurant's time zone; do not use floating point for totals |
| Phone numbers | Normalize to E.164 on blur (Vietnamese mobile numbers); validation rule to be written in the API outline (gap on `PATCH /me`) |
| Map | MapLibre binding for React Native with OSM-based tiles from a configured URL; attribution always visible (ADR-0005); tile source still open |
| Location | OS permission through the Expo location module, behind the priming screen of frame 02; GPS coordinates only as query parameters |
| Secure storage | `expo-secure-store` for the refresh token; access token in memory (ADR-0003) |
| Social sign-in | Native Google and Apple flows with a server nonce (ADR-0003); Apple shown on iOS only |
| Clipboard, calling | Copy of the bank account and the transfer note; `tel:` links for "Gọi quán" and the courier |
| Theme | Generated from `tokens.json` (light and dark), shared with the admin preset; follow the system setting, with a manual override saved on the device |
| Fonts | Be Vietnam Pro, self-hosted; Inter as fallback. License and packaging unverified (style-direction.md) |
| Icons | Phosphor (MIT), Regular for the normal state and Fill for the selected state, through an icon component that takes `name` and `selected`; the frames use the same names |
| Motion | The frames use CSS keyframes for the attention effects (light sweep, pulse, shake, pop); build them with Reanimated, run once or three times, and switch them off when the system asks for reduced motion |
| Commerce data | `MenuItem.ratingAvg`, `ratingCount`, `orderCount`, `lowStock { left, threshold }` and `Quote.pointsToEarn` (G142, G145, G146) before the rating line, the stock bar and the point preview ship; never invent counts, show the real figure or hide the line |
| Haptics | Light haptic on add to cart, place order and submit review, never on scroll |
| Strings | Externalised from the start so English can be added without rework (README) |
| Realtime | One Socket.IO client (fallback plain WebSocket) that opens in the foreground, exposes connection state, and invalidates queries on the 14 events; refetch on reconnect and on resume; client behavior in React Native is still unverified (ADR-0007 open item 1) |

## Verification

What was and was not checked. I did not re-render the whole folder for this closing step; the statements below come from the per-command checks recorded in `docs/tmp/mobile-design/STATUS.md` and the command reports.

- **Rendering.** Each frame was rendered with headless Chrome, one process at a time, at 1500 px wide (long frames in tall windows or as several partial pages) and the images were looked at slice by slice. The page chrome followed the operating-system dark mode, so the page theme was dark in most renders; main screens are drawn light and dark side by side inside each page, so both modes were seen for those. The light page theme is recorded as looked at only in M12A (the new board and the table of frame 12) and M14A (the index); earlier commands may have looked at more but did not record it. Boards drawn light only (secondary states, as the commands allowed) were not seen in dark.
- **Frames never looked at in full after their last edit.** Some slices were not looked at in the reports of M12D (5 of 16 slices, the guest board seen only through its source frame) and M12C (the first phone row of board 1). The earlier frames were looked at when built; there was no regression pass across the whole folder after all edits (the final check does that).
- **Text at 200%.** Tried by doubling `font-size` and `line-height` on three phones per command in M04A, M04C, M05A, M05B, M06A, M06B, M07A to M07D, M08A, M08B and M09, plus the item column in M04A. M03A, M03B, M04B and M10A to M12D did not record a 200% test. Findings: no cut text except the branch button "Hết giờ nhận" in frame 03 (cut at 200%), a 200%-text snackbar that covers part of the bottom bar, and sheets taller than the screen, which now scroll inside. Text set inline was not doubled in the M07B test. Frames 00, 01, 02, 09, 10, 11, 12, 13, 14 and 15 therefore have no recorded 200% test (frame 04's item column and the later boards of 03 were tried).
- **Structure.** After each command: balanced HTML (a parser pass), every `href` between frames resolves except links to frames not built yet at that time (they resolve now except `16-reservations.html`), every `use href="#i-..."` has its `<symbol>`, the theme script is present. For the index: every link resolves and the table equals the files in the folder.
- **Colors.** Text and control colors come from tokens whose contrast is measured in style-direction.md. New combinations were **not** measured: text on tinted banners (`warning` on `warning-container`, error text on an error-tinted surface, `on-secondary-container` on `secondary-container`), the "flash" and "fresh" highlights (primary at 12% and 22%), `text-secondary` on `surface-variant` pills and on photos, `disabled-text` on `disabled-bg` (low on purpose), the primary 8% selected rows, white text on the scrim, the fixed dark snackbar, the dim "Làm mới" and reconnecting strips, and the struck-through old price. Every report listed its own pairs.
- **Not tested:** other browsers, widths below 1100 px, print, any real device, any keyboard-order or screen-reader pass (the markup uses buttons and `aria-label` on icon buttons, but it is a static illustration), motion (spring sheets, heart pop, haptics are described in captions only), real photos, a real map, the OS permission dialog, the system keyboard. Liquid Glass is approximated with a browser blur.
- **Data and API claims.** The statuses of the gap rows against api-outline v3 were not re-verified except for the rows that say so; the sample data was checked arithmetically in each frame (for example 65.000 + 10.000 + 8.000 + 2 x 45.000 + 15.000 = 188.000đ).
- **This brief.** It is Markdown and was not rendered as a page. I checked it with a script: every frame file in the index exists and every file in the folder that belongs to the set is in the index; the number of gap rows per command equals the number of rows in the command's report (coverage table); links to documents resolve. The gap rows were rebuilt from the command reports (the chat text of earlier sessions, found in the project's session logs) and `STATUS.md`; where `STATUS.md` only summarized a gap, the session log was used.

**Revision 4 (2026-11-03), what was and was not checked.** The frames 16 and 17 were built and checked like the earlier ones (M13A, M13B). The owner's change requests were then applied frame by frame:

- **Seen.** After each change I rendered one to four boards of the frame concerned with headless Chrome and looked at the picture, mostly the light phone and, for the main boards, the dark one too. Seen after their change: 00 (icons, timeline), 01 (header, promo, featured dish), 02 (reviews tab), 03, 04 (boards 1, 4, 13), 05, 06 (boards 1, 3, 12, 22), 07, 08, 09, 10, 11, 12, 13, 14 (board 1), 15 (board 3), 16, 17. Boards of those frames that I did not open after the change are listed per command in `STATUS.md` ("chưa xem").
- **Not seen after the change.** Most error, dialog and state boards of frames 05 to 10 and 14 to 16, the dark phones of several frames, and every phone at 200% text (no 200% test was repeated after the density and icon changes). The 200% result recorded above therefore describes the frames before revision 4.
- **Scroll positions.** Every change that shortened or lengthened a page was followed by a measurement of the phones that are scrolled (`--y`), and the value was recomputed so the same content stays at the top. Two recomputations went wrong (frames 01, 02, 14, 15 once, frame 16 once) and were reverted from the backup and redone; the remaining phones were looked at only for the boards named above.
- **Mistakes found and fixed during the pass.** Cart line warnings squeezed into the photo column (frame 05); an unwanted hidden "Hết chỗ" label (frame 16, reverted); a double `.tm` on the cancelled timeline step (frame 07); modal and success marks that looked blurred in a screenshot because the entrance animation started at zero opacity (all entrance effects now start from a visible state).
- **Motion.** Not tried in a browser by me beyond two screenshots of frame 03 taken at different times (the sweep and the pulse ran). The reduced-motion rules are in the CSS and were not toggled in a browser.
- **Colors.** New combinations were not measured: text on the tinted gradients of the profile card, the promo, the points balance and the voucher value block (they use `on-primary-container` on a mix of two container tokens), the red and teal tinted cards of frame 13, the tinted selected rows and bars. Money and status text sit on the plain surface or a light tint, by rule.
- **Data.** Ratings, order counts, the featured dish and the three suggested dishes are invented sample values (G142 to G146); the point preview uses the example rates of frame 17.
- **Icons.** All sprites were replaced by script; every `use` still resolves; no icon was compared one by one with the old set.
- **This brief (revision 4).** Markdown, not rendered. Checked by script: frame files in the index exist; rows G122 to G146 are consecutive and appear once in the coverage table; links resolve.

## Not covered

Onboarding illustrations, empty-state illustrations beyond the icon placeholders, motion prototypes (the attention effects exist only as CSS in the static frames and were not tried on a device), tablet and landscape layouts, Android-specific chrome (the same layout is used; Material shapes and motion are an implementation matter), push notifications and SMS (out of scope for this release, `WA3`), staff phone orders (phase 2), e-invoices (deferred, `WA22`), the staff and admin screens (designs/web), import or export, any email to app users, the real map component.
