# VER.02 docs

VER.02 is a rebuild: the app of the **owner's own restaurant** (one brand, several branches), not a directory of other people's venues (decision of 2026-10-27, [ADR-0009](adr/0009-owner-business-pivot.md)). Customers use a mobile app (iOS and Android) to see the menu, order for pickup or delivery, book a table, earn points and use vouchers. Staff run the restaurant from an admin web console, starting with a live orders board. There is no payment inside the app. Working name: **Kitchen Daylight** (the real restaurant name is not chosen).

Last reconciled: **2026-11-03**. Data model v5 (reviewed and revised 2026-10-28), API outline v3 and the data plan follow ADR-0009. **The admin web design was redrawn (2026-10-29 and 2026-10-30)** for the restaurant console: [ui/admin.md](ui/admin.md), the admin part of [ui/README.md](ui/README.md) and 31 HTML frames with a [brief](../designs/web/brief.md) (phase 1, 2 and 3 frames, the reviews reports tab and the deferred e-invoice frame are all drawn). **The customer mobile app was redrawn on 2026-11-02 and revised on 2026-11-03** for the restaurant: [ui/mobile.md](ui/mobile.md) (flows F1 to F6: order, reorder, review, register with consent, reservation, delete account), the mobile part of [ui/README.md](ui/README.md) (screen inventory M1 to M18, navigation, state matrix, decisions) and 18 HTML frames (00 to 17, the phase 2 frames 16 reservations and 17 vouchers and points included) with a [brief](../designs/mobile/brief.md) (revision 4). The columns and endpoints the admin design needs and the data model and API outline do not have yet were collected in the web brief ("API and data gaps found", 328 gaps) and **folded into those two documents on 2026-10-30 as proposals**, each addition tagged `(brief ID)` (see [../designs/web/gaps-coverage.md](../designs/web/gaps-coverage.md)); the owner and the engineers still have to confirm them. The customer app found 146 more (G1 to G146 in the mobile brief); they were **folded on 2026-11-03 as proposals**, tagged `(mobile G#)`, see [../designs/mobile/gaps-coverage.md](../designs/mobile/gaps-coverage.md). On 2026-11-03 the owner also accepted every recommendation for the open questions of both briefs ([../designs/open-questions-sheet.md](../designs/open-questions-sheet.md)) and approved M14A and M14D, so the design is closed except for the facts the owner or the accountant still owe.

## Decisions

| ADR | Topic | Status |
|---|---|---|
| [0001](adr/0001-tech-stack.md) | Tech stack | Accepted: Expo React Native, iOS + Android, pnpm + Turborepo, self-managed auth, AWS, TypeORM. Rest proposed. Product framing amended by ADR-0009 |
| [0002](adr/0002-unified-place-model.md) | Unify foods and branches into `Place` | Superseded by ADR-0009 (kept as history) |
| [0003](adr/0003-authentication.md) | Authentication and authorization | Self-managed auth accepted; codes, invitation link, key store accepted in ADR-0008. **TOTP for manager and admin accepted**; deletion keeps order amounts and scrubs contact data (legal retention pending) (ADR-0009). Roles become customer / staff / manager / admin with branch scoping |
| [0004](adr/0004-aws-hosting.md) | AWS hosting, tiers (`dev`/`demo`/`prod`), budget about USD 50/month | Accepted; single-instance availability now carries real business risk and needs a stated recovery expectation |
| [0005](adr/0005-geocoding.md) | Geocoding and map handling | Reduced: MapLibre with OpenStreetMap-based tiles stands (tile source open); bulk geocoding dropped |
| [0006](adr/0006-database-redesign.md) | Database redesign | Superseded in part; conventions reused in data model v5 |
| [0007](adr/0007-realtime-sync.md) | Realtime sync | Core under ADR-0009 (orders board, order status); choices accepted in ADR-0008 |
| [0008](adr/0008-open-items-resolution.md) | Resolution of open items (2026-10-27) | Accepted as a batch; the directory-specific items are void |
| [0009](adr/0009-owner-business-pivot.md) | VER.02 becomes the owner's restaurant app | Accepted (direction, scope, phasing, assumptions `WA1` to `WA11`, TOTP for manager and admin, deletion handling, no push in v1); real name, recovery expectation, fee and loyalty values still to be given |
| [0010](adr/0010-repository-layout-and-local-docker-repo.md) | Repository layout and a dedicated local Docker repository | **Accepted** (2026-10-28, option A): 2 repositories now (the monorepo and a Docker repository used only for local development and tests); 3 if infrastructure moves out later. Amends ADR-0001, ADR-0004 and the scaffold plan (done). Both repositories public on the owner's personal GitHub (see the ADR for the controls). The Docker repository is not created yet |

## Design

- [Data model v5](data-model.md): branches, menu, orders, reservations, loyalty, reviews, roles, privacy lifecycle; about 54 tables (44 in phase 1); printed receipts and Excel statistics instead of e-invoices.
- [API outline v3](api-outline.md): conventions, error catalogue (new order, voucher and branch codes), endpoints by phase and role, realtime events, screen-to-endpoint table.
- [Data plan](migration-plan.md): seeding the owner's real branches and menu (replaces the VER.01 migration, which is dropped).
- [Data sources](data-sources.md): mostly obsolete (open-data import dropped); only the administrative-unit fixtures ([../data/](../data/README.md)) remain useful.
- [Scaffold plan](scaffold-plan.md): monorepo layout (and its companion Docker repository, ADR-0010), modules, build order by phase, facts to verify before the first commit.
- [Testing strategy](testing-strategy.md): levels, who runs what, must-have tests including the order, branch-scoping, voucher and reservation races.
- [Admin shell design](admin-shell-design.md): proposal for the data, API and solution behind the role-aware sidebar, the branch switcher, the sidebar counts and denied access (nothing in it is in the data model or API outline yet).
- [UI design](ui/README.md), [admin web flows](ui/admin.md) and [style direction and tokens](ui/style-direction.md): principles, decisions, navigation, screen inventory and state matrix for both surfaces: the admin web (A1 to A20) and the customer mobile app (M1 to M18), both redrawn for the restaurant; the mobile flows are in [ui/mobile.md](ui/mobile.md).
- High-fidelity frames: [web brief](../designs/web/brief.md) and [frame index](../designs/web/mockups/index.html) (31 frames for the restaurant console; the directory-version frames are archived in `designs/archive/directory-version/`, the 19 old files that sat next to the new frames were moved to `designs/archive/directory-version/web/replaced/` on 2026-10-30), [mobile brief](../designs/mobile/brief.md) and [frame index](../designs/mobile/mockups/index.html) (frames 00 to 15 for the customer app, revision 3 of 2026-11-02; frames 16 and 17 of phase 2 are not drawn yet; the directory-version frames are archived in `designs/archive/directory-version/mobile/`, and twelve retired copies still sit in the live folder until the final check moves them), [brand assets](../designs/brand/README.md).

## Phasing (proposal, ADR-0009)

1. **Phase 1, sell:** branches and hours, menu with options and availability, pickup and delivery orders, staff orders board with realtime, printed receipts, order history, accounts and consent, reviews of completed orders, and the Excel statistics export for the books.
2. **Phase 2:** table reservations, vouchers and promotions, loyalty points.
3. **Phase 3:** revenue charts and the top-items and order-summary views (the Excel export is already in phase 1).

## Open (owner or outside input needed)

1. **A number for the recovery expectation** of the single server (how long an outage is tolerable). Lost-device recovery for the owner's MFA is proposed (ADR-0009 `WA20`).
2. **Retention of order data and receipts:** what must be kept and for how long; needs the owner's accountant or counsel; not researched.
3. Real values: restaurant name and brand, delivery fee and zones, loyalty rates, expected scale, bank details for transfers, business address and tax code for the receipt.
3b. **Accountant:** the business is small and family-run, so no e-invoice now (printed receipt plus Excel statistics; ADR-0009 `WA17`); the e-invoice adapter and two tables are designed and deferred (`WA22`). Confirm that holds while yearly revenue stays below the threshold for a household business (sources disagree: 500 million or 1 billion VND), and whether the receipt title is acceptable.
4. Push notifications for order status are out of the first release; revisit after launch.
5. Map tile source and cost; legal text for Terms and Privacy; trademark of the name; font license.
6. The owner's real data: branches, hours, menu with prices, photos (and whether any VER.01 content is theirs).

## Next

1. **Design closed (2026-11-03).** All 51 web commands and all mobile commands (M00 to M14D) are accepted; every open question was accepted as recommended in [../designs/open-questions-sheet.md](../designs/open-questions-sheet.md). What remains is not design work: the facts marked **Input** there (bank details, accountant answers on e-invoices, receipt title, scheduling capacity, auto-cancel minutes) and the follow-ups that need a new field, endpoint or extra board (W36, W56, W67, W69, W70, M7, M10, M11, M18). When the design workspace is no longer needed, delete all of `docs/tmp/` (the UI docs no longer live there, they are back in [ui/](ui/README.md)).
2. **Customer app gaps folded (2026-11-03)** into [data-model.md](data-model.md) and [api-outline.md](api-outline.md) as proposals tagged `(mobile G#)`; the owner and the engineers still have to confirm them. Open points are in data-model "Findings and open items" 15 and api-outline "Open items" 27 to 31.
3. The Docker repository (ADR-0010) has its own implementation plan, written inside it: [../repos/kitchen-daylight-docker/docs/](../repos/kitchen-daylight-docker/docs/README.md) (7 phases, 33 small tasks, copy-paste prompts, status tracker). The monorepo's foundation plan (architecture only, 7 phases, 41 tasks) is written the same way: [../repos/kitchen-daylight/docs/implementation/foundation/](../repos/kitchen-daylight/docs/implementation/foundation/implementation-phases.md); the `api`, `web` and `mobile` plans follow after its architecture gate.
4. Start the foundation plan at P0-T1; its Phase 0 verifies the unverified facts of [scaffold-plan.md](scaffold-plan.md) section 10 (slice 0) before any configuration is written.
