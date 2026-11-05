# Open questions of the design: one decision sheet (2026-11-03)

**Status: decided 2026-11-03.** The owner replied "OK all": every recommendation below is accepted. **Input** rows stay open as facts to supply (their recommendation is only a placeholder). The decision is also recorded under "Open questions" in both briefs.

Gathers every open question of [web/brief.md](web/brief.md) ("Open questions", numbers 1 to 85, written `W1` to `W85` here) and [mobile/brief.md](mobile/brief.md) (1 to 22, written `M1` to `M22`; M19 is already done). Each row has a **recommendation** (what the frames already draw, or the safest default). Nothing here changes a document by itself.

**How to answer.** Reply "OK all" to accept every recommendation, or list the rows to change, for example "W28: Staff may view; M9: cash only". Rows marked **Input** need a fact that only the owner, the accountant or counsel has; the recommendation then is only a placeholder to build with. Rows marked **Later** do not block the foundation or the first slice that touches them.

Legend: **Dec** = a design or product decision the owner can take now; **Input** = needs an outside fact; **Later** = defer without harm.

## A. Owner facts that block going live (Input)

| # | Question | Recommendation | Type |
|---|---|---|---|
| W4, M9 | Bank-transfer details (bank, account, holder, bank code, QR) | Collect before the first real order. Without them the first release is cash only (`payment` setting empty, transfer option hidden) | Input |
| W10, W73 to W83 | Receipt title `HÓA ĐƠN BÁN HÀNG`; whether e-invoices are turned on; seller type, tax method, rates, retention, deadlines | Keep e-invoices off (ADR-0009 WA17): printed receipt plus Excel statistics. W73 to W83 stay deferred until the accountant answers. Ask only the receipt title question now | Input / Later |
| W11 | Scheduled-order capacity per slot | Start with the `ordering.schedule_*` defaults already accepted; no per-slot capacity in phase 1 | Input |
| W12 | Auto-cancel of unconfirmed orders | Off by default (as designed); the owner picks minutes when ready | Input |
| W13, M1 | Menu: shared with per-branch overrides, or separate menus per branch | Keep the schema (one menu, per-branch availability, price and stock). On a branch change, keep the lines still offered at the new branch and ask about the rest, instead of clearing the cart | Dec |
| W25 | Map tile source and cost | Decide before the map slice; not needed by the foundation | Later |
| W24 | Excel CSV delimiter and BOM; xlsx library | The statistics report is XLSX, which avoids the CSV encoding problem; choose the library in the operations slice | Later |

## B. Orders, counter and operations (web)

| # | Question | Recommendation | Type |
|---|---|---|---|
| W1 | Lost-device path for the owner's MFA | Keep the design: recovery codes, "admin resets admin", engineer-run server task after in-person proof | Dec |
| W2 | Lateness thresholds and refetch interval | Keep the placeholders (5/10 and 15/25 minutes, 15 s); they are settings | Dec |
| W3 | Courier is a typed name only | Keep | Dec |
| W5 | Receipt and ticket paper sizes | 80 mm default, 58 mm selectable | Dec |
| W6 | Item photo limit | 8 | Dec |
| W7, W39 | May staff reveal contact without a reason | Yes, audited, no reason required (as drawn for orders and reservations) | Dec |
| W8 | Several printers or kitchen-display screens | Out of the first release | Later |
| W9 | Refunds | Manual, recorded as `REFUNDED` | Dec |
| W14 | Stock for options | Per item only | Dec |
| W15 | Business-day cutoff hour | 04:00, editable, with the warning that is drawn | Dec |
| W16, W17 | Counter orders: hold the kitchen until transfer is confirmed; counter orders when paused or past the cutoff; table number on every dine-in order; split payment; phone delivery orders; auto-print; waiter confirming a transfer | Do not hold; allow counter orders when paused (staff override, audited); table label optional; no split payment; no auto-print; waiter may not confirm a transfer | Dec |
| W18 | Phone field in two branch tabs; wording `MỚI` vs `Mới` | Keep one phone field (contact tab); use `Mới` everywhere | Dec |
| W19 | `LAST_ADMIN` and MFA; STAFF MFA later | Keep: the last admin cannot be removed or have MFA reset; revisit STAFF MFA after launch | Dec |
| W20 | Reviews: `REMOVED` back to `PUBLISHED`; reply on a hidden review; hidden review counting | Allow restore by admin only; no reply on a hidden review (`REVIEW_NOT_PUBLISHED`); a hidden review does not count | Dec |
| W21 | Last cover photo, last branch of an item, shared `alt_text`, amenity icon ownership | Block removing the last cover of a selling item; block dropping the last branch of an active item; `alt_text` per image; icon keys owned by `design-tokens` | Dec |
| W22 | 24-hour opening; special-day note in the app; deleting a branch that is the only branch of a staff member | Support open-all-day; show the note; refuse the delete with `IN_USE` listing the staff | Dec |
| W23 | Email test send logging; resend limits; customer search by full address | Test sends are not logged; resend for `FAILED` staff mail once per 60 s; search by name, phone or email only | Dec |
| W26 | Mobile status wording must match the label map | Yes, one label map in `design-tokens`/`i18n` | Dec |

## C. Reviews and reports (web)

| # | Question | Recommendation | Type |
|---|---|---|---|
| W27 | Reports queue order | Oldest first (work the queue first in, first out) | Dec |
| W28 | Staff and the Reports tab | Staff may view but not decide, as on Reviews | Dec |
| W29 | `Ẩn đánh giá` on an already hidden review | Relabel `Giữ ẩn` | Dec |
| W30 | Bulk "apply to other reports" on `Bỏ qua` | Keep, default on | Dec |
| W31 | Tell the customer when a report is handled | No notice in the first release | Later |
| W32 | Resolution note limit | 500 characters | Dec |
| W33 | Extra 11:35 sample | Yes, keep it | Dec |

## D. Reservations, tables, vouchers, banners, points (phase 2)

| # | Question | Recommendation | Type |
|---|---|---|---|
| W34 | `Đã đến` from 30 min before, `Không đến` from 15 min after | Keep | Dec |
| W35 | Auto-expire a request not confirmed in time | Warning only | Dec |
| W36 | Staff cancel a confirmed reservation for the guest | Yes, add the action (needs an endpoint, P6) | Dec |
| W37 | Joining tables | Add up seats only; adjacency later | Dec |
| W38 | Dine-in order table on the reservation calendar | Yes, as a read-only marker | Dec |
| W40 | Past days and 31-day filter | Keep | Dec |
| W41 to W47 | Rules edited only in frame 24; Manager/Admin only; blocked switch-off with list; delete only if unused; area free text; allow preparing before reservations are on; value limits (30 to 240 min, 0 to 1,440, 1 to 90 days, seats 1 to 20) | Accept all as drawn | Dec |
| W48 to W54 | Voucher code locks after first use; Manager edits own branch only; no delete, only off; no free-text condition; no revoke of assigned; discount on items only; limits (code 4 to 20, title at most 60, fixed at least 1,000đ) | Accept all as drawn (W48, W49, W50, W53, W54 were already accepted in W14C) | Dec |
| W55, M21 | Sample ledger: Nguyễn Hà's order 85,000đ should add 85 points; raise balance to 405 | Yes, correct the sample (320 to 405) in both web and mobile samples | Dec |
| W56 | Banner has no branch; Manager can edit all banners | Add `branch_id` (nullable = all) and limit a Manager to own branch | Dec |
| W57 | Banners shown on Home | Max 3 | Dec |
| W58 | New banner default | Off | Dec |
| W59 | Banner delete is real | Keep real delete | Dec |
| W60 to W63 | Ledger viewable while earning is off; adjustment note hidden from customer; no deduction notice; limits (title at most 60, body at most 140, image 2:1 at least 600x300, adjustment at most 10,000, note 5 to 200) | Accept all as drawn | Dec |
| W84 | Admin on "all branches" searches every branch | Yes, every branch by default | Dec |
| W85 | Staff add reservations by phone | Yes; edit stays Manager/Admin | Dec |

## E. Reports and charts (phase 3)

| # | Question | Recommendation | Type |
|---|---|---|---|
| W64 | Charts as tabs of one page | Keep | Dec |
| W65 | Add 8-colour categorical palette to `tokens.json` | Yes, when the charts are built (phase 3) | Later |
| W66 | Comparison with previous period | Same weekday, skip unfinished days; no year-over-year | Dec |
| W67 | Preparation time definition | `ACCEPTED` to `READY`; add placed-to-ready as a second figure | Dec |
| W68 | Peak-hours grid | Average per day | Dec |
| W69 | Group by week and month | Add both | Dec |
| W70 | Cancellation reason | Pick list plus optional note | Dec |
| W71 | Manager uses comparison | Yes | Dec |
| W72 | Drill-down from a column | Not in the first charts release | Later |

## F. Customer app (mobile)

| # | Question | Recommendation | Type |
|---|---|---|---|
| M2 | Heart in menu rows | No (hearts on the item sheet and favorites only) | Dec |
| M3 | Menu search: suggestions, vegetarian chip, "Tất cả" during search, allergen disclaimer wording | Show best sellers when empty; show the chip only when a tagged item exists; no "Tất cả" during search; disclaimer wording as drawn, to be checked with counsel | Dec |
| M4 | Service type in the Menu header; 30-minute warning | Show it; keep the warning | Dec |
| M5 | Item sheet: full screen threshold; unselecting a single choice; note link | Full screen when the item has options and the sheet would scroll; a single choice with a default cannot be unselected; keep the note link | Dec |
| M6 | Cart: split flags; guests see voucher and points rows; auto-remove sold-out lines; `RATE_LIMITED` | Separate flags `vouchers` and `loyalty`; guests see the rows disabled with a sign-in hint; mark sold-out lines but let the customer remove them; inline banner | Dec |
| M7 | Cart on sign-out and branch removal; offline launch | Keep the cart on sign-out (it is device state); if the branch disappears, keep lines and ask for a branch; draw the offline case in the next design pass | Dec |
| M8 | Address limit; editing receiver phone; 20 s timeout; `UPGRADE_REQUIRED` blocking | Limit 10; phone editable and saved to the address; timeout 20 s then "check the order"; block only at the order button | Dec |
| M10 | Order tracking: cancel position and retry; reasons; "+N"; "Theo dõi" on completed; dark boards | Cancel at the bottom; retry is idempotent; keep four reasons; "+N" counts lines; no "Theo dõi" on completed; draw the dark boards in a later pass | Dec |
| M11 | Home: banner hidden when none; "Đặt lại" when closed; cart bar; stop-taking-orders board | Hide the banner when none is valid; "Đặt lại" opens the cart but the order button explains the closed state; keep the cart bar; add the board later | Dec |
| M12 | Branch picker: fee sentence; pin colour; closed state; photo viewer; description | Reword the priming (GPS only sorts and picks branches); show the closed state; add the viewer; show `description` | Dec |
| M13 | Reviews: edit keeps the reply; unverified email; "Khác" needs details; report needs verified email | A reply is kept but marked "review edited"; completing an order requires a verified email so the case cannot occur; "Khác" needs details; reporting needs a signed-in account | Dec |
| M14 | Account: social-only password row; hotline; default-address delete; add-to-cart when closed | Show "Đặt mật khẩu"; show hotline from `app_settings.brand`; deleting the default address picks the next; allow adding to the cart, block at the order button | Dec |
| M15 | Auth success text; hint under "Để sau" | Generic text ("Email đã được xác minh"); add the hint | Dec |
| M16 | Delete account: which warning first | Orders first, then reservations | Dec |
| M17 | Paused-branch cart bar | Offer "Đổi chi nhánh"; keep "Xóa giỏ" in the cart menu | Dec |
| M18 | `reservation.status_changed` phone | Draw it in the next design pass (phase 2) | Later |
| M20 | Reservations: date strip 14 vs 30 days; verified-email gate; table name | Add "Ngày khác"; require a verified email; do not show the table name | Dec |
| M21 | `GIAO15` title; EARN_ORDER row; points on delivery fee; voucher flag | Rename "Đơn giao hàng giảm 15.000đ"; fix the sample ledger (see W55); points never reduce the fee; separate voucher flag (see M6) | Dec |
| M22 | Commerce layer: who picks featured dishes; ratings/order counts on dishes; example rates; Phosphor icons and motion | The manager flags featured and add-on dishes in the item editor; show rating from 5 ratings up; keep example rates labelled as examples; approve Phosphor and the motion | Dec |

## G. What closing the design means

After you answer (or accept all), the design is closed in these steps: record the answers in the two briefs as "Decided 2026-11-03" (a separate pass, no frame redrawn unless a row above says "draw"), then run P6-T1 to import. Rows that ask for a redraw or a new endpoint are tracked as follow-ups, not as blockers of the import: **W36**, **W56**, **W67**, **W69**, **W70** (new fields or endpoints) and **M7**, **M10**, **M11**, **M18** (extra boards).
