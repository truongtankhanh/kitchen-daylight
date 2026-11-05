# ADR-0003: Authentication and authorization

- **Status:** Self-managed auth in NestJS is **Accepted** (project owner). The detailed design below was **Proposed** on 2026-10-21 and the items covered by [ADR-0008](0008-open-items-resolution.md) (email codes, invitation token, key store, account deletion, refresh grace window) are **Accepted as a batch on 2026-10-27**; the rest stays proposed.
- **Date:** 2026-10-21 (amended 2026-10-27)
- **Depends on:** [ADR-0001](0001-tech-stack.md), [data-model.md](../data-model.md)

## Context

VER.01 delegated mobile sign-in to Firebase Auth, and the admin site used `md5()` passwords with a session holding only the email. Roles (`members.level`) were checked only to hide buttons; the API endpoints had no authentication at all.

VER.02 has two client types with different threat models:

| Client | Who | Credential storage available |
|---|---|---|
| Mobile (iOS, Android) | End users | OS secure storage (Keychain / Keystore) |
| Admin web (Angular SPA) | Staff, admins | Browser only |

## Decision

### Identity and tokens

- One identity per person: `users.id` is the FK target for favorites, history and reviews.
- **Access token:** JWT, 10–15 minutes, signed with an asymmetric key (`ES256` or `EdDSA`) with a `kid` header so keys can rotate. Claims: `sub`, `role`, `iat`, `exp`. Keys live in SSM Parameter Store as `SecureString` ([ADR-0004](0004-aws-hosting.md); Secrets Manager bills per secret and stays the upgrade path). *Amended 2026-10-27 (ADR-0008 #3); this ADR previously said Secrets Manager.*
- **Refresh token:** opaque 256-bit random value, **stored only as a hash**, single use. Every refresh issues a new token in the same `family_id`.
  - **Reuse detection:** presenting an already-used refresh token revokes the whole family.
  - Sliding idle expiry plus an absolute maximum session lifetime (initial values: 30 days idle / 90 days absolute; tune later).
  - **Grace window (ADR-0008 #6):** a just-used refresh token presented again within 10 seconds returns the same successor instead of counting as reuse, so two parallel refreshes from one mobile app do not revoke the family. Outside the window it is reuse.
- **Mobile:** refresh token in `expo-secure-store`; access token in memory only.
- **Admin web:** refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to the auth path; access token in memory. The refresh and logout endpoints require a custom header and an `Origin` check as CSRF defense. API and admin must be same-site (subdomains of one registrable domain) for `SameSite=Strict` to work.
- Logout revokes the current family; "log out everywhere" revokes all families of the user.
- A role change or account disable takes effect after the access-token TTL at most. Sensitive admin endpoints re-read the role from the database.

### Passwords

- argon2id, parameters per current OWASP guidance, tuned on the production task size.
- Length-based policy: minimum 10, maximum 128, no composition rules. Optional breached-password check via k-anonymity range API.
- Per-account lockout/backoff after repeated failures (`failed_login_count`, `locked_until` on `users`), plus the IP-level limits below. Responses never reveal whether an email exists (login, register, reset).

### Social sign-in (mobile only)

- The app obtains a Google or Apple ID token with the native flow and sends it to the API. The backend verifies the signature against the provider's JWKS and checks `iss`, `aud` (an allow-list of our client IDs), `exp` and a `nonce` we issued.
- Accounts link on (`provider`, `provider_subject`), never on email alone. Auto-linking to an existing local account is allowed only when the provider reports a verified email **and** the local account's email is verified. Otherwise the user must sign in to the existing account first and link explicitly. This prevents pre-registration account takeover.
- Apple may return a private-relay email and provides the name only on first sign-in. Store it then.
- Facebook login from VER.01 is dropped.
- Admin web uses email + password only. No social login for staff.

### Email flows

- **App users (mobile): a 6-digit code typed in the app** for email verification and password reset (ADR-0008 #1). Single use, stored as a keyed hash (HMAC with a server secret), valid 10 minutes, dead after 5 wrong attempts, and issuing a new code expires the previous one. Per-account and per-IP throttling applies on top, because 6 digits alone are guessable (about 20 bits): the attempt counter is what makes them safe. The code goes to the account email, or to another email the user enters, which the API checks first. Responses are generic and never reveal whether an email exists. This removes the need for deep links or a bridge page.
- **Staff (admin web): links.** Invitation link single use, hashed, valid 48 hours; staff password reset link valid 30 minutes (ADR-0008 #2). Staff passwords need at least 12 characters.
- All mail goes through Amazon SES behind `MailPort`. The send log never stores a code, token or link. Bounces and complaints feed an own suppression table (ADR-0008 #34).
- A completed password reset revokes all of the user's refresh-token families.

### Authorization

- NestJS global guard with deny-by-default: every route requires a valid access token unless marked `@Public()`.
- Role guard: `USER`, `STAFF`, `ADMIN`. `STAFF` can create and edit catalog rows. Only `ADMIN` manages users and deletes catalog rows. **Amended 2026-10-27 (ADR-0009):** the roles become `CUSTOMER`, `STAFF`, `MANAGER`, `ADMIN` and staff roles are scoped to branches through `staff_branches`: `STAFF` processes orders and reservations and marks items sold out at their branches, `MANAGER` also manages menu, prices, stock, hours, vouchers and reports of their branches, `ADMIN` (the owner) does everything and manages staff accounts. Branch scoping is enforced in the API on every query.
- Ownership: the acting user id always comes from the token, never from the request body or path. Favorites, history and reviews are scoped by it; a user can edit or delete only their own review.
- **No MFA for staff and admin (owner decision, 2026-10-21).** Accepted risk: a guessed or stolen admin password gives full catalog and user management. Compensating controls: staff/admin passwords require at least 12 characters; admin accounts are created only by an `ADMIN` (no self-registration); stricter throttling and lockout on the admin login; auth events for `STAFF`/`ADMIN` are logged. Revisit this if staff accounts grow or the app starts holding data beyond the public catalog. **The second condition is met as of 2026-10-27 ([ADR-0009](0009-owner-business-pivot.md)):** the app now holds customers' names, phone numbers, delivery addresses and orders, and staff handle them daily. The revisit is done: **TOTP is required for `MANAGER` and `ADMIN`** (accepted 2026-10-27, ADR-0009); `STAFF` stays on password with the stricter throttling already designed.

### Abuse protection

- Each tier runs a **single API instance** ([ADR-0004](0004-aws-hosting.md)), so in-process throttling (for example `@nestjs/throttler`, with strict limits on the auth paths) is effective, together with the per-account counters in Postgres.
- **Blocking condition for scaling out:** in-process counters are per instance. Before the API runs more than one instance, rate limiting must move to a shared layer (AWS WAF rate-based rules or Redis).
- Auth events (login success/failure, refresh reuse, password reset, role change) are logged as structured events without secrets or tokens.

### Account lifecycle

- In-app account deletion is required by the App Store for apps that create accounts. `DELETE /me` removes the user's favorites and history and anonymizes their reviews (author becomes "deleted user"). **Decided 2026-10-27 (ADR-0008 #4): anonymize, not delete.** Legal review may still change this. Consent withdrawal in the first release is by deleting the account (ADR-0008 #5).

### Implementation notes

- NestJS `@nestjs/jwt` with custom guards, `argon2` for hashing, `jose` for JWKS verification. Passport is not needed.
- Schema additions are in `data-model.md` (`email_tokens`, lockout columns).

## Alternatives considered

- **Amazon Cognito:** AWS-native and removes password storage, but creates a second identity store that must be synchronized with `users`, and limits customization of flows. Rejected because the owner chose self-managed auth and one relational identity.
- **Firebase Auth (as in VER.01):** same second-identity-store issue, plus a non-AWS dependency.
- **Opaque server-side sessions instead of JWT:** simpler revocation, but every request needs a session lookup and mobile clients would still need a refresh-style mechanism. JWT access + rotating refresh keeps request handling stateless with bounded revocation delay.
- **Auth libraries/products (Better Auth, Keycloak, Auth0):** not chosen; they add a dependency or service to operate for a small, well-understood set of flows.

## Consequences

- We own credential storage, token rotation, email delivery and abuse protection. This is the main risk of the decision, and the reason for reuse detection, hashed tokens and strict throttling. *Amended 2026-10-28:* `MANAGER` and `ADMIN` now sign in with TOTP (see Authorization and ADR-0009), so the residual risk is the password-only `STAFF` path, covered by 12-character passwords, stricter throttling and lockout, and logged auth events.
- Auth endpoints and the refresh flow need dedicated tests (reuse detection, concurrent refresh, expired and revoked tokens, link-takeover cases). The owner runs tests; results are fed back to the implementer.
- SES must be moved out of the sandbox before launch, and a sending domain verified (SPF, DKIM, DMARC).

## Open items

1. ~~Concurrent-refresh tolerance~~ decided: 10-second grace window (ADR-0008 #6).
2. ~~Delete versus anonymize reviews~~ decided: anonymize (ADR-0008 #4), pending the legal review.
3. Final token TTLs after UX review (access token, refresh idle/absolute, code lifetime and attempt limit).
4. The "enter another email" path of the mobile verification flow is designed only for an unverified account. Changing the email of a verified account is not designed.
5. Test coverage for the code flow: attempt counter, expiry, "new code expires the old one", and per-IP throttling (see [testing-strategy.md](../testing-strategy.md)).
6. **Staff MFA** is decided (TOTP for `MANAGER` and `ADMIN`); lost-device recovery is proposed in ADR-0009 `WA20` (recovery codes, two admins, an admin-performed reset, an engineer-run last resort; no email or SMS bypass). **Account deletion with order records** is decided as keep amounts and items, scrub contact data; the retention period and what the law requires are still pending the accountant's or counsel's answer.
