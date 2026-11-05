# ADR-0007: Realtime sync between admin web and mobile

- **Status:** The requirement comes from the owner (2026-10-21). The design below was **Proposed** on that date; the six open items were **resolved as a batch on 2026-10-27** in [ADR-0008](0008-open-items-resolution.md) #7 to #12 (see "Resolved open items" at the end). Socket.IO behaviour in React Native is still to be verified at scaffolding.
- **Date:** 2026-10-21 (amended 2026-10-27)
- **Under [ADR-0009](0009-owner-business-pivot.md) realtime becomes core, not a nicety:** the staff orders board and the customer's order status depend on it. Audiences are now "staff of one branch" and "one customer", with new events (`order.placed`, `order.status_changed`, `menu.availability_changed`, ...) listed in [api-outline.md](../api-outline.md) v3. A staff board must also refetch on reconnect and at a short interval, because a missed order is lost revenue; "signal, then fetch" and the 2-second target still hold.
- **Depends on:** [ADR-0001](0001-tech-stack.md), [ADR-0003](0003-authentication.md), [ADR-0004](0004-aws-hosting.md), [data-model.md](../data-model.md)
- **UI:** [designs/web, frame 19](../../designs/web/mockups/19-realtime.html)

## Context

The owner wants the admin web and the mobile app to stay in sync in real time: what staff publish, hide or change on the web shows up on devices without a manual refresh, and what users do on mobile (a new review, a report) reaches staff immediately. This was not in the first scope, so the API outline, the data model and the mobile design do not cover it yet.

Constraints already decided: NestJS API, PostgreSQL, one EC2 instance with Docker Compose and a budget of about USD 50 per month ([ADR-0004](0004-aws-hosting.md)); self-managed JWT auth with rotating refresh tokens ([ADR-0003](0003-authentication.md)); in-process rate limiting that must move to a shared layer before a second instance; no push notifications in the first release (data model scope).

## Requirements

1. Web to mobile: place published, unpublished, edited or deleted; review hidden or removed (rating aggregates change); account suspended (device signs out); app configuration changed (maintenance, minimum version).
2. Mobile to web: a new report raises the sidebar count and a toast; a new review is visible to moderators.
3. Web to web: two staff editing the same place do not overwrite each other silently; lists do not reorder under the reader.
4. Works when the connection drops: the UI shows the state, reconnects, and reloads what it missed.
5. No personal data in events; authorization stays in the REST layer.

## Proposed design

- **Signal, then fetch.** An event carries a type, an entity id, a version and an audience (role or user), never the record. A client that cares calls the normal REST endpoint, which applies authorization. This keeps one place for access control and keeps events small.
- **Transactional outbox.** The API writes the event row in the same transaction as the change, so an event exists if and only if the change committed. A relay publishes it to the gateway.
- **Transport:** a WebSocket gateway in the NestJS API. Server-sent events would suffice for the web but React Native has no built-in support for them, so one transport for both is simpler.
- **Optimistic concurrency** on editable records through a version number; a stale save returns `409` and the UI offers "view changes", "reload" or an explicit overwrite that is written to the audit log.
- **Presence** (who is viewing a record) lives in memory only.
- **Mobile lifecycle:** connect in the foreground; on resume, refetch instead of trusting missed events, unless the server can replay from a last event id.

New schema objects this implies, **now in [data model v5](../data-model.md)**: an `outbox_events` table (id, type, entity type, entity id, version, audience, branch id, audience user id, created at, published at) and a `row_version` column on records staff edit (`branches`, `menu_items`, `menu_categories`, `branch_menu_items`, `vouchers`, `email_templates`, `orders`, `reservations`). The stale-save error is `409` with `code = STALE_VERSION`. Event names and audiences are in [api-outline.md](../api-outline.md) ("Realtime"). Details in frame 18.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Polling every few seconds | Trivial, stateless | Load grows with users; latency is the interval; wasteful on mobile battery |
| Server-sent events | Simple, works over plain HTTP | No native support in React Native; one-directional |
| WebSocket gateway (proposed) | One transport for web and mobile; two-way if needed | Stateful connections; needs a shared layer to scale past one instance |
| PostgreSQL `LISTEN/NOTIFY` as the bus | No extra infrastructure; fits the outbox | Not a client transport; payload size limited; only for fan-out between API instances |
| Managed realtime service (for example AWS AppSync or API Gateway WebSocket) | Scaling handled by the vendor | New cost and vendor coupling against a small budget; evaluated for neither price nor fit |
| Push notifications only | Works in the background | Not realtime inside the app; out of scope in the first release |

## Consequences

- Every write path that clients should see must emit an event; this becomes a rule in the implementation tasks, and a test checks it.
- Scaling to more than one API instance needs a shared bus and shared rate limiting; this joins the blocking condition already in ADR-0003.
- The admin UI gains a connection indicator, live badges, a conflict banner and a "reload list" bar (frame 18); the mobile screens' matching live states are designed in [designs/mobile frame 15](../../designs/mobile/mockups/15-realtime.html).
- The API outline needs a connect endpoint, event types and the `409` conflict code.

## Resolved open items (ADR-0008, accepted as a batch 2026-10-27)

1. **Transport and token:** Socket.IO on the NestJS gateway; the access token goes in the handshake and the client reconnects when it refreshes; the server drops sockets with an expired token or revoked session (#7, #8). Plain WebSocket is the fallback if Socket.IO misbehaves in React Native.
2. **Replay:** none in v1; clients refetch on reconnect or resume (#9).
3. **Conflict policy:** block on any stale `rowVersion` with `409 STALE_VERSION`; reload or explicit audited overwrite; no field-level merge (#10).
4. **Retention:** `outbox_events` are purged 7 days after creation (#9).
5. **Latency target:** under 2 seconds at the 95th percentile on a normal connection (#11).
6. **Guests:** receive only events about branches, the menu and app configuration (#12); never an order, a reservation or a user.

## Open items

1. Socket.IO client behaviour in React Native with the chosen Expo SDK (not verified in this documentation pass).
2. Scaling past one API instance needs a shared bus (Postgres `LISTEN/NOTIFY` or Redis) and shared rate limiting; blocking condition, unchanged.
3. Whether a later release adds replay from a last event id (needs the 7-day retention that already exists).
