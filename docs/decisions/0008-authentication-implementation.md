# 0008. Authentication implementation

Status: **proposed** (A1-T1, 2026-11-06). Fixes how the API implements [ADR-0003](../adr/0003-authentication.md) as amended by [ADR-0008](../adr/0008-open-items-resolution.md) and [ADR-0009](../adr/0009-owner-business-pivot.md): token lifetimes and sessions, the refresh grace window, password hashing and lockout, email codes and staff links, throttle figures, TOTP and recovery codes, the TOTP secret encryption, the JWT, the staff refresh cookie, social sign-in and the library pins. **Every number in this record is a proposal for the owner**, because ADR-0003 open item 3 leaves the final token lifetimes to "after UX review"; rows and sections marked **owner** need an answer before acceptance (section 13). No code, package or environment variable is written by this task; A1-T2 writes the variables from section 12.

## Contradictions and tightenings

Each row names a document that this record contradicts (**C**) or makes stricter (**T**). The API track does not edit those documents: a row that is built logs a divergence in [api-divergences.md](api-divergences.md) ([decision 0007](0007-api-platform-libraries-and-rules.md), section 13).

| # | Kind | Document | It says | This record says |
|---|---|---|---|---|
| 1 | C | [ADR-0003](../adr/0003-authentication.md), Authorization, bold sentence | "**No MFA for staff and admin** (owner decision, 2026-10-21)" | Stale: amended in the same paragraph and by ADR-0009 (`WA4`). TOTP is required for `MANAGER` and `ADMIN`; `STAFF` stays on password (section 8) |
| 2 | C | ADR-0003, "Implementation notes" | "`@nestjs/jwt` with custom guards, `argon2` for hashing, `jose` for JWKS verification" | `jose` alone signs and verifies every JWT (section 9); `@nestjs/jwt` is not installed. Password hashing uses `argon2id` from `node:crypto`, not the `argon2` package (section 4). **owner** |
| 3 | T, **owner** | ADR-0003, "Identity and tokens"; open item 3 | access token "10–15 minutes" | 15 minutes, for both clients (section 1) |
| 4 | T, **owner** | ADR-0003, refresh token | "30 days idle / 90 days absolute; tune later" | Customers (mobile): 30 days idle, 90 days absolute. Staff (admin web): 24 hours idle, 7 days absolute (section 1) |
| 5 | T | ADR-0003 and ADR-0008 #6, grace window | "returns the same successor" | The same successor **refresh** token and a newly signed access token, from an in-process single-flight cache; after a restart a re-presentation inside the window is refused without revoking the family (section 2). **owner** for the restart rule |
| 6 | T | [data-model.md](../data-model.md), `refresh_tokens` row | columns `id`, `user_id`, `token_hash`, `family_id`, `device_label`, `expires_at`, `used_at`, `revoked_at`, `last_used_at` | Adds `family_expires_at` (absolute end, copied to every successor), `replaced_by_id` (the successor) and `created_at` (Conventions). `token_hash` is the SHA-256 of the raw token. Built by A1-T4 (section 2) |
| 7 | T, **owner** | data-model, `refresh_tokens` row; ADR-0003 | no limit on live families per user | At most 10 live families per customer and 5 per staff member; a new sign-in beyond that revokes the least recently used family (section 1) |
| 8 | C, **owner** | [api-outline.md](../api-outline.md), "Current user", rows `/me/sessions`, `/me/sessions/{id}` | phase 2 | A2-T4 builds them in phase 1. A session is a refresh-token family; `DELETE` revokes the family (section 1) |
| 9 | C, **owner** | data-model, `users` row and api-outline, staff transport (brief E15): "the lock message does not reveal the unlock time…"; [testing-strategy.md](../testing-strategy.md), "Auth and sessions": "the identical response for unknown email, wrong password and locked account" | a distinct lock message on one side, an identical response on the other | The testing strategy wins: one response, `401 INVALID_CREDENTIALS`, for unknown email, wrong password, wrong second factor and a locked account. The generic text may say that the account can be temporarily locked; it never says that it is (section 5) |
| 10 | T | api-outline, Conventions, "Rate limits": "the figures are open (brief E16)"; open item 16 | no figures | Figures per route group, per IP and per account (section 7) |
| 11 | T, **owner** | api-outline open item 27 (mobile G54) | "a daily limit on `POST /auth/email/send-code` beyond the 60 seconds" is open | Proposal: at most 5 messages per user and type in a rolling 24 hours, for codes and staff links (section 6) |
| 12 | T, **owner** | ADR-0003, Passwords | "Optional breached-password check via k-anonymity range API" | Out of phase 1. Phase 1 only refuses a password equal to the account email or its local part (section 4) |
| 13 | T, **owner** | ADR-0003, Passwords and staff passwords; NIST SP 800-63B-4 [S3] | customers 10 to 128, staff at least 12 | Kept as the ADR says, counted in Unicode code points after NFC. NIST asks for 15 for a single-factor password [S3], which applies to customers and `STAFF`; the owner confirms the ADR figures or raises them (section 4) |
| 14 | T | data-model, "Personal data lifecycle", Encryption: "`mfa_credentials.secret_encrypted` is encrypted with a key held outside the database" | no algorithm, layout or key name | AES-256-GCM, key `MFA_ENCRYPTION_KEY`, the user id as associated data, a key id in the ciphertext, rotation by a previous-keys variable (section 8) |
| 15 | T | data-model, `mfa_credentials` row: recovery codes "stored hashed" | no hash named | Each recovery code is an `argon2id` PHC string in `recovery_code_hashes` (section 8) |
| 16 | T | data-model, `email_tokens` row | "stored as a keyed hash (HMAC)" for codes; links "hashed" | Codes: HMAC-SHA-256 keyed with `OTP_HMAC_SECRET` over a versioned string of user id, type and code. Links: SHA-256 of a 256-bit token carried in the URL fragment. `created_at` exists, as decision 0007 row 15 requires (section 6) |
| 17 | T | api-outline, Conventions, "Client headers"; ADR-0003, admin web: "a custom header and an `Origin` check" | `X-Client` is informational; the custom header is not named | `X-Client: admin-web` is the custom header, required with an allowed `Origin` on every `POST /admin/auth/*`. Cookie `kd_refresh`, `Path=/api/v1/admin/auth` (section 10) |
| 18 | T | api-outline, `/admin/app-settings`, read-only `security` block | one `accessTokenMinutes`, `sessionIdleDays`, `sessionAbsoluteDays` | Two session profiles (customer and staff), and the staff idle time is in hours. The settings slice (A4) shapes the block from the constants of section 1 |
| 19 | T | `kitchen-daylight-docker/docs/api-contract.md`, environment table; [decision 0005](0005-api-foundation-conventions.md), sections 2 and 3 | JWT and OTP variables only | New variables `JWT_PREVIOUS_PUBLIC_KEYS`, `MFA_ENCRYPTION_KEY`, `MFA_ENCRYPTION_PREVIOUS_KEYS`, `ADMIN_ORIGINS`, `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`; `env:sync` and `gen-dev-secrets.sh` also generate a dev `MFA_ENCRYPTION_KEY` (section 12) |
| 20 | T | ADR-0003, social sign-in: "a `nonce` we issued" | no lifetime or storage | 256-bit nonce, 10 minutes, single use, held in process memory (section 11) |

## Context

- **ADR-0003** (as amended): ES256 or EdDSA access JWT with `kid`, claims `sub`, `role`, `iat`, `exp`, keys in SSM; opaque 256-bit refresh token stored as a hash, single use, family revocation on reuse, sliding idle and absolute expiry, 10 s grace window; mobile keeps the refresh token in `expo-secure-store`, the admin web in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to the auth path with a custom header and an `Origin` check; argon2id per OWASP; length-only password policy 10 to 128, staff 12; per-account lockout (`failed_login_count`, `locked_until`); generic responses; in-process throttling while one instance runs; auth events logged without secrets. Open item 3: final TTLs after UX review.
- **ADR-0008** rows 1, 2, 3, 6 (codes 10 minutes, 5 attempts, HMAC; staff links 48 h and 30 min; keys in SSM; 10 s grace window), row 8 (the socket authenticates with the access token and reconnects after a refresh; the server disconnects a socket whose token expired) and row 36 (deletion word "XÓA").
- **ADR-0009** `WA4` (TOTP for `MANAGER` and `ADMIN`), `WA10` (a verified email is needed to order) and `WA20` (paper recovery codes, two admins with MFA, admin-performed reset, engineer last resort, no email or SMS bypass).
- **data-model**: the rows `users`, `auth_identities`, `refresh_tokens`, `email_tokens`, `mfa_credentials`, `consent_documents`, `user_consents`; "Personal data lifecycle" (deletion removes `auth_identities`, `refresh_tokens`, `email_tokens`, `mfa_credentials`; `refresh_tokens` purged 30 days after expiry or revocation, `email_tokens` 7 days, codes 1 day; the TOTP secret is encrypted with a key outside the database).
- **api-outline**: customer and staff transports, `/me/mfa/*`, `/me/sessions`, "Rate limits" (`429` with `Retry-After`; staff login limited in process plus a per-account counter; resend once per 60 s).
- **testing-strategy**, "Auth and sessions": rotation and reuse, grace window, concurrent refresh, expired and revoked tokens, link-takeover cases, the code flow, staff links, lockout with the identical response, deny by default.
- **Decision 0005** sections 2, 3, 5: the variable table, the dev secrets generated by `env:sync`, the production guard. **0006** item 2: the secure-store rules of the refresh-token slice. **0007** section 5: `@nestjs/throttler` named throttlers `default` and `auth`, IP keyed, per-account counters in PostgreSQL, `429 RATE_LIMITED` with plain `Retry-After`, figures left to this record.
- **Docker repository** `docs/api-contract.md`: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` (base64 of the PEM on one line, PKCS#8 and SPKI, P-256), `JWT_KEY_ID` (`kd-dev-` + 16 hex digits of the SHA-256 of the public key), `OTP_HMAC_SECRET` (256 bits, base64).
- Runtime: Node 26.13.0 (decision 0005, section 9), ESM.

## Evidence

Read on 2026-11-06. Registry data from read-only `npm view <pkg> version engines peerDependencies dependencies optionalDependencies license dist-tags time --json`. Nothing was installed and nothing was run locally. Claims are cited as [S#] or marked **not verified**.

| ID | Source |
|---|---|
| S1 | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html: argon2id minimum configurations "m=47104 (46 MiB), t=1, p=1", "m=19456 (19 MiB), t=2, p=1", "m=12288 (12 MiB), t=3, p=1", "m=9216 (9 MiB), t=4, p=1", "m=7168 (7 MiB), t=5, p=1", which "provide an equal level of defense"; store algorithm and work factor in "the modular PHC string format"; re-hash at the next login to raise the work factor; "Peppers cannot be changed without knowledge of a user's password" |
| S2 | https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html: maximum "at least 64 characters"; allow "all characters including unicode and whitespace"; "Do not silently truncate passwords"; block "common and previously breached passwords"; lockout counter tied to the account "rather than the source IP address", balancing threshold, observation window and duration, exponential lockout; let a locked-out user reset the password; run the same process for unknown users so the response returns "in approximately the same response time"; compare in constant time |
| S3 | https://pages.nist.gov/800-63-4/sp800-63b.html (SP 800-63B-4): single-factor passwords "a minimum of 15 characters", passwords used within MFA "a minimum of eight"; maximum "at least 64"; "Each Unicode code point SHALL be counted as a single character"; NFC normalisation before hashing; no composition rules; blocklist comparison (SHALL); at most 100 consecutive failures per account; look-up secrets "at least six decimal digits", those under 112 bits salted and hashed; OTPs accepted "only once while it is valid" |
| S4 | https://nodejs.org/api/crypto.html (page header "Node.js v26.13.0 documentation"): `crypto.argon2(algorithm, parameters, callback)` and `argon2Sync`, "Added in: v24.7.0", algorithms `argon2d`, `argon2i`, `argon2id`, parameters `message`, `nonce` (salt, at least 8 bytes), `parallelism`, `tagLength`, `memory` (KiB), `passes`, optional `secret` (pepper) and `associatedData`; the excerpt read shows **no Stability line** on the argon2 entries (the module is "Stability: 2 - Stable"). GCM: `authTagLength` "defaults to 16 bytes"; `setAAD()` "must be called before `cipher.update()`"; since v26.0.0 a non-128-bit GCM tag without `authTagLength` is refused. `crypto.randomInt` and `crypto.timingSafeEqual` entries were **not reached** in the excerpts read |
| S5 | https://github.com/nodejs/node/commit/5402b5e, PR #63924 "doc,crypto: mark argon2 and encap/decap as stable": removes "Stability: 1.2 - Release candidate" from `argon2` and `argon2Sync`. The first release that carries it is **not verified**; a third-party docs mirror (nodejs.cn) still shows "1.2 - Release candidate" |
| S6 | https://github.com/ranisalt/node-argon2 README: "works only and is tested against Node >=22.0.0"; prebuilt binaries for Ubuntu 22.04 and Alpine 3.18 (x86-64, ARM64); comparison table: `node:crypto` argon2 has no "PHC string formatting", no "Verify PHC string", no "Check if re-hash is needed", no "sensible default parameters"; "node-argon2 will transition into a minimal wrapper" around Node's native methods once all supported Node releases have them |
| S7 | Registry: `argon2` 0.45.2 (published 2026-11-03), `latest`; `next` 1.0.0-alpha.1; engines `node >=16.17.0`; dependencies `@phc/format`, `node-addon-api`, `node-gyp-build`, `cross-env`; `install` script `cross-env ZERO_AR_DATE=1 node-gyp-build`; MIT |
| S8 | https://github.com/napi-rs/node-rs/tree/main/packages/argon2 README: no node-gyp, no postinstall; `hash()` defaults `memoryCost` 19456, `timeCost` 2, `parallelism` 1, `outputLen` 32, algorithm Argon2id; returns an encoded PHC string; `verify()`. Registry: `@node-rs/argon2` 2.2.2 (published 2026-10-06), engines `node >= 10`, platform packages as `optionalDependencies` including `linux-x64-gnu` and `linux-arm64-gnu`; MIT |
| S9 | https://github.com/panva/jose README: "`jose` has no dependencies and it exports tree-shakeable ESM"; Node.js among the runtimes; `SignJWT`, `jwtVerify`, `createRemoteJWKSet`, `createLocalJWKSet`, `importPKCS8`, `importSPKI`. `docs/jwt/verify/interfaces/JWTVerifyOptions.md`: `algorithms`, `audience` and `issuer` ("Requires the claim to be present"), `clockTolerance` (applies to `nbf` and `exp`), `maxTokenAge`, `requiredClaims`, `typ`. `docs/jwks/remote/interfaces/RemoteJWKSetOptions.md`: `cacheMaxAge` default 600000 ms, `cooldownDuration` default 30000 ms, `timeoutDuration` default 5000 ms. Registry: `jose` 6.2.15 (published 2026-11-01), no `engines` field, ESM `exports` map; MIT |
| S10 | Registry: `@nestjs/jwt` 12.0.3 (published 2026-10-12), peer `@nestjs/common ^8 … ^12`, depends on `jsonwebtoken` 9.0.3 and `@types/jsonwebtoken` 9.0.10; MIT |
| S11 | https://www.rfc-editor.org/rfc/rfc6238.txt: default time step X = 30 s; "We RECOMMEND that at most one time step is allowed as the network delay"; "The verifier MUST NOT accept the second attempt of the OTP"; "Keys SHOULD be of the length of the HMAC output"; HMAC-SHA-1, and MAY use SHA-256 or SHA-512 |
| S12 | https://github.com/google/google-authenticator/wiki/Key-Uri-Format: `otpauth://totp/LABEL?PARAMETERS`, label `issuer:account`, `secret` Base32 without padding, `issuer` "STRONGLY RECOMMENDED"; `algorithm` (default SHA1), `digits` (default 6) and `period` (default 30) are ignored by Google Authenticator implementations |
| S13 | https://github.com/hectorm/otpauth README and https://hectorm.github.io/otpauth/classes/TOTP.html: Node.js, Deno, Bun, browsers; defaults recommended (examples SHA1, 6 digits, 30 s); `validate({ token, timestamp?, window? })` returns the "Token delta or null"; `counter({ timestamp? })`; "NOT recommended to use less than 128 bits (16 bytes)" for secrets; server-side throttling "essential"; `toString()` gives the `otpauth://` URI. Registry: `otpauth` 9.6.0 (published 2026-11-02; previous 9.5.2, 2026-09-03), depends only on `@noble/hashes` 2.4.0 (engines `node >= 20.19.0`); no `engines` field; MIT |
| S14 | https://github.com/yeojz/otplib README: "v13 is a complete rewrite with breaking changes"; tested on Node.js, Bun, Deno, browsers; plugins for crypto and base32 (`@noble/hashes`, `@scure/base`); the documented verify result shows only `valid`; an "AI Usage Disclosure" since v13. Registry: `otplib` 13.6.0 (published 2026-10-31), six `@otplib/*` dependencies; MIT |
| S15 | https://developers.google.com/identity/gsi/web/guides/verify-google-id-token: `iss` is "`accounts.google.com` or `https://accounts.google.com`"; `aud` "equal to one of your app's client IDs"; `exp` not passed; keys at `https://www.googleapis.com/oauth2/v3/certs` (JWK), rotated, cache per `Cache-Control`; `email_verified`. `nonce` is **not mentioned** on that page. https://accounts.google.com/.well-known/openid-configuration: `issuer` `https://accounts.google.com`, `jwks_uri` `https://www.googleapis.com/oauth2/v3/certs`, `id_token_signing_alg_values_supported` `["RS256"]` |
| S16 | https://developer.apple.com/documentation/signinwithapple/verifying-a-user: verify the signature with Apple's public key, "Verify the nonce for the authentication", `iss` "contains https://appleid.apple.com", `aud` "is the developer's client_id", time earlier than `exp` (the page says "JWS E256 signature"). https://appleid.apple.com/.well-known/openid-configuration: `issuer` `https://appleid.apple.com`, `jwks_uri` `https://appleid.apple.com/auth/keys`, `id_token_signing_alg_values_supported` `["RS256"]`. `ASAuthorizationOpenIDRequest.nonce`: "A string value to pass to the identity provider", verifiable "with the identity token"; how it appears in the token is **not stated**. Apple's `email_verified` type and the first-authorization-only name were **not confirmed** on an Apple page today (ADR-0003 states the name rule) |
| S17 | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie: `Secure` sends the cookie only over `https:` "(except on localhost)"; "The `https:` requirements are ignored when the `Secure` attribute is set by localhost"; `__Host-` requires `Secure`, no `Domain` and `Path=/`; `SameSite=Strict` sends the cookie only for same-site requests; `Path` "is not intended as a security measure" |
| S18 | https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts: potentially trustworthy origins include hosts `127.0.0.0/8`, `::1/128`, `localhost` and names ending in `.localhost`. Per-browser behaviour of `Secure` cookies on `http://localhost` and `http://127.0.0.1` is **not stated** |
| S19 | Registry: `nodemailer` 10.3.1 (published 2026-10-29), engines `node >=20.0.0`, MIT-0. `@aws-sdk/client-sesv2` 3.1163.0 (published 2026-11-05; a new version almost every working day), engines `node >=20.0.0`, Apache-2.0 |
| S20 | [Decision 0007](0007-api-platform-libraries-and-rules.md) [S6] and section 5: `@nestjs/throttler` named throttlers, `ttl` and `blockDuration` in milliseconds, IP tracker with IPv6 normalisation, `Retry-After-<name>` mapped to plain `Retry-After` |

## 1. Lifetimes and sessions (**owner**)

**Options for the access token:** 10 minutes (shortest revocation delay) or 15 minutes (fewer refreshes and fewer socket reconnects).

**Choice:** one table of constants in `modules/auth`, not environment variables (every tier must behave the same; a change is a code change with this record amended).

| Value | Customer (mobile) | Staff (admin web: `STAFF`, `MANAGER`, `ADMIN`) |
|---|---|---|
| Access token | 15 minutes | 15 minutes |
| Refresh idle (sliding) | 30 days | 24 hours |
| Refresh absolute (per family) | 90 days | 7 days |
| Grace window | 10 seconds | 10 seconds |
| Live families per user | 10 | 5 |

**Reason:**
- 15 minutes is the top of the ADR range. A role change or suspension already revokes refresh tokens and emits `session.revoked` or `user.suspended`, and sensitive admin endpoints re-read the role (ADR-0003), so the access TTL bounds only ordinary requests. ADR-0008 #8 makes each refresh a socket reconnect; 15 minutes halves the reconnects of 10 minutes on the staff orders board, which has no event replay (ADR-0008 #9).
- Customers keep the ADR's initial 30 and 90 days: the token is in the OS secure store and the account holds no payment data.
- Staff sessions are shorter because the cookie lives in a browser that may be a shared counter computer, and staff see customer contact data. An orders board left open refreshes every 15 minutes and never idles out during a shift; an overnight closure is under 24 hours; a day off or a week means a new sign-in, with TOTP for `MANAGER` and `ADMIN`.
- The client kind follows the account, not a column: customer login rejects staff accounts and staff login rejects customers (api-outline), so the role at issue time selects the profile.

**Families and sessions:**
- A family is one signed-in device or browser. `family_id` is the session id (`sid` claim, section 9) and the id behind `GET/DELETE /me/sessions/{id}` (header row 8).
- The family limit is checked when a new family starts (login, social sign-in, register). Beyond it, the family with the oldest `last_used_at` is revoked; the new sign-in never fails because of the limit. Reason: bounds the session list and the table without a user-visible error.
- Logout revokes the presented family; logout-all, a password change (other families), a completed password reset, a role change, suspension and an MFA reset revoke all of the user's families (ADR-0003, data-model `users` row, api-outline).

**`device_label` rules:**
- Taken from an optional `deviceLabel` string in the login, register and social sign-in bodies (the mobile app sends a model name, the admin web a browser and OS name it computes itself); otherwise the `X-Client` header value; otherwise `unknown`.
- NFC-normalised, control characters removed, whitespace collapsed and trimmed, at most 60 code points (longer is cut, not refused). Copied to every successor of the family.
- Display only. Never used for a security decision; never holds an IP address, location or user agent string.

## 2. Refresh rotation and the grace window

**The problem:** ADR-0008 #6 returns "the same successor" to a re-presented token within 10 s, but the database holds only hashes, so the raw successor cannot be read back.

**Options:**
- (a) **In-process cache** of the raw successor for 10 s, keyed by the hash of the presented token. Valid while one API instance runs (ADR-0003, ADR-0004). A restart empties it.
- (b) **Encrypted successor column** on the used row (AES-GCM, cleared after 10 s). Survives restarts and a second instance, but stores a live credential in the database for 10 s, needs a key and a cleanup, and adds a column for a 10-second case.
- (c) **Sibling token**: issue a second successor in the same family. Contradicts "the same successor" and leaves two live tokens in one family, which breaks the single-chain reuse rule.

**Choice: (a), as a single-flight map.**
- Refresh token: 32 bytes from the CSPRNG, base64url (43 characters). `token_hash` = SHA-256 of the raw token (high entropy, so no slow hash and no key). Lookup by the unique hash.
- On `/auth/refresh` (or `/admin/auth/refresh`), the service first looks in a process map `presentedHash → Promise<result>`. A hit within 10 s returns that result. Otherwise it stores its own promise, then in one transaction: `SELECT … FOR UPDATE` the row; checks not revoked, not expired (`expires_at` and `family_expires_at`); marks it used (`used_at`, `replaced_by_id`); inserts the successor with `expires_at = min(now + idle, family_expires_at)`. The entry stays 10 s after success and is removed at once on failure.
- The result returned within the window is the **same successor refresh token** and the access token signed for the first request (still valid for about 15 minutes).
- A row already used: if `now − used_at ≤ 10 s` and the map has the entry and the successor is neither used nor revoked → the grace answer. Otherwise it is **reuse**: every row of the family gets `revoked_at`, the event `auth.refresh_reuse` is logged and audited (no token value), and the answer is `401 UNAUTHENTICATED`.
- **Restart rule (owner):** a used row inside the 10 s window with no map entry (the process restarted) is refused with `401 UNAUTHENTICATED` **without** revoking the family. Reason: the only possible callers are the device that just rotated (it already holds the successor) or an attacker inside a 10-second window right after a restart; revoking would sign out a real user for a deploy. Alternative for the owner: treat it as reuse.
- Revoking a family deletes its map entries. The map holds at most one entry per refresh in the last 10 s.
- **Second instance:** this is a blocking condition like throttling (0007 section 5). Option (b) or a shared store is then decided in a new record.

**Columns A1-T4 needs** (`refresh_tokens`; header row 6): `id` (uuidv7), `user_id`, `family_id`, `token_hash` (`bytea`, 32 bytes, unique), `device_label`, `created_at`, `expires_at` (idle end), `family_expires_at` (absolute end, copied), `used_at`, `replaced_by_id` (nullable self-reference), `revoked_at`, `last_used_at` (set at issue; the session list's "last active" is the live row's value). Indexes: unique `token_hash`; `(user_id)` where `revoked_at IS NULL`; `(family_id)`. No raw token, no IP.

## 3. Where state lives

| State | Store | Lost on restart | Effect |
|---|---|---|---|
| Grace-window map | process memory | yes | section 2 restart rule |
| Social nonces | process memory | yes | the user starts the sign-in again (section 11) |
| IP throttle counters | process memory (0007) | yes | accepted in 0007 |
| Lockout, code attempts, resend times, families, TOTP step | PostgreSQL | no | — |

## 4. Passwords

**Options for the implementation:**
- (a) **`argon2`** 0.45.2, the package ADR-0003 names: native addon with prebuilt binaries loaded by `node-gyp-build`, an `install` script, PHC output, a re-hash check [S6, S7].
- (b) **`@node-rs/argon2`** 2.2.2: napi-rs, one optional platform package per target (`linux-x64-gnu` and `linux-arm64-gnu` cover the Debian-slim image on both platforms), no install script, defaults equal to OWASP's second configuration, PHC output, no re-hash helper [S8].
- (c) **`crypto.argon2` of Node**: no dependency; in the v26.13.0 documentation with no "Release candidate" marker [S4, S5]; no PHC formatting, PHC verification or re-hash check [S6].

**Choice: (c), `node:crypto` `argon2('argon2id', …)`, with a small PHC helper in `modules/auth`.** **owner** (header row 2).

**Reason:**
- No dependency and no native addon: nothing to build or approve per platform in the multi-arch image (decision 0005, section 9), no install script.
- The missing parts are formatting only: encode `$argon2id$v=19$m=<m>,t=<t>,p=<p>$<salt b64>$<hash b64>` (unpadded standard base64, as the PHC format uses), parse it, and compare parameters for the re-hash check. There are no legacy hashes to read (VER.01 is not migrated, `WA9`), so the helper reads only what it writes.
- The `argon2` maintainers plan to become a wrapper around the same Node function [S6].
- **Risk and its check:** which Node release first marked argon2 stable is not verified [S5], and the function needs the OpenSSL that the official Node build bundles. The task that writes the hasher adds a known-answer unit test and a PHC round-trip test; if `crypto.argon2` is missing or fails at runtime, the fallback is (b) with its 0001 row, which keeps the same PHC strings.

**Parameters:** argon2id, `memory` 19456 KiB, `passes` 2, `parallelism` 1, `tagLength` 32 bytes, salt (`nonce`) 16 bytes from `randomBytes`, version 19 [S1, S4]. These are an OWASP minimum, not a ceiling: before `prod`, the owner or engineer measures one hash on the production instance size (ADR-0003 "tuned on the production task size") and may raise `memory` or `passes`; never below [S1]. No pepper: it cannot be rotated without every user's password [S1] and adds a secret for no phase 1 gain.

**Rules:**
- **Re-hash on login:** after a successful verification, if the stored PHC parameters differ from the current ones, hash again and update `password_hash` in the same request [S1].
- **Unknown email, account with no password (social only), wrong role for the transport, locked account:** the service still runs one argon2id verification against a dummy PHC string made at first use with the current parameters, then answers exactly as for a wrong password [S2]. Comparison of the derived key uses `crypto.timingSafeEqual`.
- **Normalisation and length:** the input string is first bounded at 1024 UTF-16 units by the DTO (a cheap guard against huge bodies), then normalised to **NFC** [S3], then counted in **Unicode code points** [S3]. Customers 10 to 128, staff 12 to 128 (ADR-0003). The UTF-8 bytes of the NFC string are hashed. No trimming, no truncation, no composition rules; whitespace and any Unicode allowed [S2, S3]. The normalisation is fixed from the first stored hash: changing it later would break every existing hash.
- **Phase 1 checks beyond length:** a password equal (case-insensitively, after NFC) to the account email or its local part is refused with `VALIDATION_FAILED`. The breached-password check (k-anonymity API) and a blocklist are **out of phase 1** (header row 12, **owner**): NIST makes a blocklist a SHALL [S3]; the k-anonymity API sends a hash prefix to a third party, which needs a privacy decision; a bundled list needs a licensed source.
- Password length figures against NIST's 15 for single-factor passwords: header row 13, **owner**.

**Lockout (owner):**

| | Customers | Staff (`STAFF`, `MANAGER`, `ADMIN`) |
|---|---|---|
| Threshold `T` (consecutive failures) | 10 | 5 |
| `locked_until` after failure number `n ≥ T` | `now + min(15 min × 2^(n − T), 4 h)` | same formula |
| Failures that count | wrong password | wrong password, wrong TOTP code, wrong recovery code (data-model `users` row) |

- While `locked_until > now`: no password or code check (only the dummy hash for equal timing), no increment, the same `401 INVALID_CREDENTIALS` (header row 9).
- **Reset to 0 and `locked_until` cleared:** a completed sign-in (after the second factor for `MANAGER` and `ADMIN`), a completed password reset by code or link, a password set from an invitation. A lock never blocks the reset flow [S2].
- Reason: per-account counters [S2], far below NIST's 100 [S3]; exponential with a cap [S2] so a forgotten password costs 15 minutes, while an attacker who knows a staff email cannot lock the account for more than 4 hours at a time (staff can still reset by link).
- Every failure, lock and unlock is an auth event without the password or code (ADR-0003, data-model `audit_logs` row); an unknown email typed is not logged.

## 5. Generic responses

- Login (both transports), whatever the cause (unknown email, wrong password, wrong second factor, locked, staff account on the customer transport and the reverse, social-only account): `401 INVALID_CREDENTIALS`. `ACCOUNT_SUSPENDED` only after a correct password (api-outline, W02A decision).
- Register with an existing email, send-code, forgot-password (both transports): the same `202` body whether or not the email exists. The HTTP response never waits for the mail transport (the message is queued and sent after the response), so timing does not reveal the account.
- Code, reset and link failures (wrong, expired, used, dead after 5 attempts, unknown): `CODE_INVALID` (api-outline).

## 6. Email codes and staff links

**Customer codes** (ADR-0008 #1; `email_tokens.channel = CODE`):
- Generation: `crypto.randomInt(0, 1_000_000)`, left-padded to 6 digits.
- Stored value: `token_hash` = HMAC-SHA-256, key = the 32 bytes decoded from `OTP_HMAC_SECRET`, message = `"kd.email-code.v1\n" + user_id + "\n" + type + "\n" + code`. The version prefix lets the input change later without ambiguity; the user id and type bind a code to one account and one purpose.
- Verification: the live row for (`user_id`, `type`) is loaded; the submitted code is normalised (spaces removed; not exactly six ASCII digits → `VALIDATION_FAILED`, no attempt counted); the HMAC is recomputed and compared with `crypto.timingSafeEqual`. A wrong code runs `UPDATE … SET attempts = attempts + 1 WHERE id = $1 AND attempts < max_attempts`; at `max_attempts` (5) the code is dead. Success sets `used_at` in the same transaction as its effect.
- Lifetime 10 minutes; issuing a new code expires the previous one (ADR-0008 #1).
- Rotating `OTP_HMAC_SECRET` invalidates live codes only (at most 10 minutes); the user asks for a new one.

**Staff links** (ADR-0008 #2; `channel = LINK`):
- Token: 32 bytes from the CSPRNG, base64url. `token_hash` = SHA-256 (256-bit randomness needs no key).
- Link: `<first ADMIN_ORIGINS entry>/<admin route>#token=<token>`. The token is in the **fragment**, so it is never sent in a request line, a proxy log or a `Referer`; the admin page reads it and posts it to `/admin/auth/password/set`. The admin route path belongs to the admin slice.
- `INVITE` 48 hours, staff `RESET_PASSWORD` 30 minutes, single use (`UPDATE … SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > now()`), the password set in the same transaction.

**Resend and caps:**
- At most one message per user and type every **60 s**, from `created_at` of the newest `email_tokens` row (0007 section 5 and row 15; api-outline). The `created_at` column is confirmed for A1-T4.
- **Daily cap (owner, header row 11):** at most **5** messages per user and type in a rolling 24 hours (counted from `email_tokens.created_at`; codes are purged after 1 day, so the count is still available). Beyond it the endpoint answers as if it had sent the message (generic, section 5) and sends nothing; the event is logged. Reason: bounds SES cost and mailbox flooding by a third party; 5 covers a lost or late mail several times over.

## 7. Throttle figures (owner)

Per-IP counters are the `@nestjs/throttler` memory store (0007 section 5) [S20]; per-account counters are the PostgreSQL ones of sections 4 and 6. A blocked request gets `429 RATE_LIMITED` with `Retry-After` (0007). `blockDuration` equals `ttl` unless stated.

| Route group | Throttler | Per IP | Per account |
|---|---|---|---|
| `POST /auth/login`, `/auth/social/google`, `/auth/social/apple` | `auth` | 20 per 5 minutes | lockout, threshold 10 (section 4) |
| `POST /admin/auth/login`, `/admin/auth/mfa/verify`, `/admin/auth/step-up` | `auth` | 10 per 5 minutes | lockout, threshold 5 (section 4) |
| `POST /auth/register` | `auth` | 10 per hour | — |
| send-code and forgot: `POST /auth/email/send-code`, `/auth/password/forgot`, `/admin/auth/password/forgot` | `auth` | 5 per 15 minutes | 1 per 60 s and 5 per 24 h per user and type (section 6) |
| verify and reset: `POST /auth/email/verify`, `/auth/password/reset`, `/admin/auth/password/set` | `auth` | 10 per 15 minutes | 5 attempts per code; links single use (section 6) |
| refresh: `POST /auth/refresh`, `/admin/auth/refresh` | `auth` | 60 per 5 minutes | rotation and reuse rules (section 2) |
| logout: `POST /auth/logout`, `/auth/logout-all`, `/admin/auth/logout`; `POST /auth/social/nonce` | `auth` | 30 per 5 minutes | — |
| `/me/mfa/*` | `auth` | 10 per 5 minutes | wrong codes count toward the lockout (section 4) |
| everything else | `default` | 600 per minute | business limits per user, set by each slice (0007) |

**Reason:**
- Logins are rare (refresh tokens last days or weeks), so 20 and 10 per 5 minutes block guessing from one address without hurting a real user; the staff figure is the stricter one ADR-0003 asks for.
- **Shared addresses:** a branch's staff share one public IP, and Vietnamese mobile networks put many customers behind carrier NAT. The `default` figure (600 per minute) leaves room for an orders board refetching every 15 s on several screens; the strict figures apply only to the auth routes, where per-account counters do the precise work. This is the main reason the figures need the owner's eye after the first weeks of real traffic (**not verified** against real traffic).

## 8. TOTP and recovery codes

**Library options:** `otpauth` 9.6.0 [S13], `otplib` 13.6.0 [S14], or an own RFC 6238 implementation on `node:crypto` (needs an own Base32 codec and URI builder).

**Choice: `otpauth`.**
- **Reason:** one dependency (`@noble/hashes`, Node ≥ 20.19 [S13]); `validate` returns the step delta, which the replay rule needs; `timestamp` is injectable for tests; it builds the `otpauth://` URI [S13]. `otplib` 13 is a recent full rewrite with six packages and documents only a boolean result [S14]. An own implementation saves one small dependency at the cost of writing Base32 and URI code.
- Node 26 is not named by either library [S13, S14]; the installing task's unit test against RFC 6238's test vectors confirms it. `otpauth` 9.6.0 was published four days before this record; if the owner prefers a release with more field time, 9.5.2 (2026-09-03) is the alternative pin.

**Parameters:** HMAC-SHA-1, 6 digits, 30 s period, the defaults that authenticator apps assume and that Google Authenticator does not let us change [S11, S12]; window ±1 step [S11]; secret 20 bytes (160 bits, the SHA-1 output length [S11], above the 128-bit floor [S13]).

**Issuer and label:** issuer `Kitchen Daylight` (`WA1` working name), with the tier in brackets outside `prod` (`Kitchen Daylight (demo)`), so test entries are not confused with real ones; label `issuer:email` [S12]. A later brand change does not alter enrolled entries; it only labels new ones.

**Replay rule:** the accepted step is `counter(now) + delta`. The code is accepted only if `UPDATE mfa_credentials SET last_used_step = $step WHERE user_id = $1 AND (last_used_step IS NULL OR last_used_step < $step)` changes one row [S3, S11]; otherwise it is a wrong code.

**Enrolment:** `/me/mfa/setup` stores a new encrypted secret with `enabled_at` null and returns the URI; `/me/mfa/confirm` with a valid code sets `enabled_at`. A `MANAGER` or `ADMIN` without `enabled_at` cannot finish a sign-in except into enrolment (api-outline `MFA_REQUIRED`).

**Recovery codes** (`WA20`, data-model `mfa_credentials`):
- Ten codes, each 10 characters of Crockford Base32 from the CSPRNG (50 bits), shown as `XXXXX-XXXXX`, once.
- Input is normalised: upper case, spaces and hyphens removed, `O` → `0`, `I` and `L` → `1`.
- Stored: each code as an argon2id PHC string with the password parameters (section 4) in `recovery_code_hashes`. Reason: under 112 bits, so salted and slow-hashed [S3]. Checking a code verifies against at most ten hashes; this path is rare and throttled (section 7).
- Single use: the matched hash is removed from the array in the same transaction as the sign-in, under a row lock.
- `/me/mfa/recovery-codes` requires a current TOTP code and replaces the whole set. The console warns when three or fewer remain and requires a new set when none remain (api-outline, brief E20); the count is the array length.

**TOTP secret encryption** (header row 14):
- AES-256-GCM with `node:crypto`, a 12-byte random IV per encryption, a 16-byte tag (the default [S4]), associated data `"kd.mfa.v1:" + user_id` set before `update()` [S4], so a ciphertext copied to another user's row fails to decrypt.
- Key: **`MFA_ENCRYPTION_KEY`**, 32 random bytes, base64; separate from `OTP_HMAC_SECRET` (different purpose, different rotation).
- Stored text in `secret_encrypted`: `v1.<kid>.<iv>.<ciphertext>.<tag>`, each part base64url; `kid` = the first 16 hex digits of SHA-256(`"kd.mfa.kid\n"` + key bytes), so no separate key-id variable exists.
- **Rotation:** set a new `MFA_ENCRYPTION_KEY` and move the old key into **`MFA_ENCRYPTION_PREVIOUS_KEYS`** (comma-separated base64 keys, decrypt only). A secret decrypted with a previous key is re-encrypted with the current key at that user's next successful TOTP check; an `ops` command to re-encrypt all rows can follow (0005 section 8). A previous key is removed once no row carries its `kid`.

## 9. JWT

**Options:** `@nestjs/jwt` 12.0.3 (wraps `jsonwebtoken` 9.0.3 [S10]) for signing plus `jose` for JWKS, as ADR-0003 says; or `jose` alone.

**Choice: `jose` alone** (header row 2). **Reason:** `jose` is needed anyway for the Google and Apple JWKS (ADR-0003), has no dependencies and is ESM [S9]; one library covers signing, verification, key import and remote key sets. `@nestjs/jwt` adds only dependency-injection sugar plus a second JWT stack.

**Token:**
- Header: `alg: ES256` (P-256, the key format of `api-contract.md`), `kid` = `JWT_KEY_ID`, `typ: at+jwt`, checked on verification with the `typ` option [S9] so no other JWT (an ID token, a later step-up token) passes as an access token.
- Claims: `iss` `kd-api`, `aud` `kd-api`, `sub` (user id), `role`, `sid` (the refresh family id), `iat`, `exp`. **No `jti`:** access tokens are never revoked one by one; revocation works on families and the short TTL. `sid` lets logout, `DELETE /me/sessions/{id}` and the socket gateway target one session.
- Verification: `algorithms: ['ES256']`, `issuer`, `audience`, `typ`, `requiredClaims: ['sub', 'role', 'sid', 'iat', 'exp']`, `clockTolerance` 5 s [S9] (one server signs and verifies; the tolerance only covers a future second host).

**`kid` rotation:**
- Current key: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID` (`api-contract.md`).
- **`JWT_PREVIOUS_PUBLIC_KEYS`** (optional): comma-separated `<kid>:<base64 of the SPKI PEM>` entries, accepted for verification only. The verifier picks the key by the token's `kid`; an unknown `kid` is `401 UNAUTHENTICATED`.
- Procedure: deploy the new pair as current with the old public key in `JWT_PREVIOUS_PUBLIC_KEYS`; remove that entry at any deploy after 15 minutes plus the tolerance. Refresh tokens are opaque and are not affected. In `demo` and `prod` the values come from SSM (ADR-0003, ADR-0008 #3).

## 10. Staff refresh cookie and CSRF

- **Cookie:** `kd_refresh=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/admin/auth; Max-Age=<seconds to min(expires_at, family_expires_at)>`, no `Domain` (host only). No `__Host-` prefix, because that prefix requires `Path=/` [S17]. Logout and any revocation answer with the cookie cleared (`Max-Age=0`, same name and path).
- `Path` narrows which requests carry the cookie; it is not a security boundary [S17]. The defences are `HttpOnly`, `SameSite=Strict` and the two checks below.
- **Checks on every `POST /admin/auth/*`** (login, MFA verify, refresh, logout, forgot, password set, step-up): the header `X-Client: admin-web` must be present (a non-safelisted header, so a cross-site form cannot send it and a cross-origin script needs a CORS preflight the API never grants), and `Origin` must be present and equal to one entry of **`ADMIN_ORIGINS`**. Otherwise `403 FORBIDDEN`. Reuses the header api-outline already defines instead of adding one.
- **`ADMIN_ORIGINS`:** comma-separated origins (`scheme://host[:port]`, no path); `https` only in `demo` and `prod`; the first entry is the base of staff links (section 6). In `dev` it lists the `ng serve` origin and the Caddy origin of the Docker `apps` profile.
- **`Secure` on the local `http` origins:** MDN says the `https:` requirement "is ignored when the `Secure` attribute is set by localhost" [S17], and `127.0.0.0/8` and `localhost` are potentially trustworthy [S18]. Whether every browser the admin supports accepts a `Secure` cookie from `http://localhost` **and** `http://127.0.0.1` is **not verified** (the supported-browser list was not in this task's reading). The admin auth slice confirms it in its smoke run; until a browser fails, no insecure-cookie switch exists, and if one is ever added it is refused outside `dev` by the production guard.

## 11. Social sign-in

| Item | Google | Apple |
|---|---|---|
| Accepted `iss` | `https://accounts.google.com`, `accounts.google.com` [S15] | `https://appleid.apple.com` [S16] |
| JWKS | `https://www.googleapis.com/oauth2/v3/certs` [S15] | `https://appleid.apple.com/auth/keys` [S16] |
| `alg` allow-list | `RS256` [S15] | `RS256` (discovery document; the docs page says "E256", which the discovery list does not contain) [S16] |
| `aud` allow-list variable | **`GOOGLE_CLIENT_IDS`** | **`APPLE_CLIENT_IDS`** |

- **Client id lists:** comma-separated, because the `aud` differs per platform (Google iOS, Android and web client ids; Apple bundle ids per build profile, later a Services ID). Required in `demo` and `prod`; in `dev` and `test` an empty list disables that provider (sign-in answers `401 INVALID_CREDENTIALS`).
- Issuers, JWKS addresses and algorithms are constants in code, not variables.
- Verification: `jwtVerify` with `createRemoteJWKSet` (key cache 10 minutes, refetch on an unknown `kid` after a 30 s cooldown, 5 s timeout [S9]); `clockTolerance` 30 s for provider clocks. Google asks to follow `Cache-Control` [S15]; `jose`'s fixed 10-minute cache is shorter than a key rotation overlap, so the difference is accepted. The key set is created lazily, never at import (no I/O at import time).
- **Nonce:** `POST /auth/social/nonce` returns 32 random bytes in base64url. Kept in process memory (`sha256(nonce) → expiry`), **10 minutes**, single use, at most 10 000 live entries (oldest dropped). The app passes it unchanged to the native SDK; the server requires the token's `nonce` claim to equal it, then deletes it. Lost on restart: the user starts again (section 3). No table is added. Whether each native SDK used by the app (Google on iOS and Android, Apple through Expo) passes the nonce through unchanged is **not verified** [S15, S16]; the mobile social slice confirms it, and a provider that hashes or drops it goes back to the owner.
- Linking (`email_verified` from both sides, never email alone) stays as ADR-0003 says. Apple's `email_verified` may come as a string or a boolean (**not verified** on an Apple page): the verifier accepts `true` and `"true"` only.
- **Test tier:** the remote key sets are a network call to a third party. The social slice decides how tests verify tokens without the network (for example a local key set through `createLocalJWKSet` [S9]) and how that fits the production guard (0005 section 5).

## 12. Variables and pins

**Variables for A1-T2** (each validated by `loadConfig` only when the code reading it ships, 0005 section 4):

| Name | Format | Tiers | Dev value |
|---|---|---|---|
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID` | as `api-contract.md` | required everywhere | `env:sync` / `gen-dev-secrets.sh` (existing) |
| `JWT_PREVIOUS_PUBLIC_KEYS` | `<kid>:<base64 SPKI PEM>`, comma-separated | optional | unset |
| `OTP_HMAC_SECRET` | 32 bytes, base64 | required everywhere | existing |
| `MFA_ENCRYPTION_KEY` | 32 bytes, base64 | required everywhere | **new** in `env:sync` and `gen-dev-secrets.sh` |
| `MFA_ENCRYPTION_PREVIOUS_KEYS` | base64 keys, comma-separated | optional | unset |
| `ADMIN_ORIGINS` | origins, comma-separated; `https` in `demo`/`prod` | required everywhere | the `ng serve` and Caddy origins |
| `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | ids, comma-separated | required in `demo`/`prod`; may be empty in `dev`/`test` | empty |

Lifetimes, thresholds, throttle figures, argon2 and TOTP parameters are code constants (section 1), not variables. The Docker repository's `gen-dev-secrets.sh` and `api-contract.md` change through P6-T4 (header row 19).

**Pins** (registry `latest` on 2026-11-06; each row goes into [0001](0001-toolchain-versions.md) from the task that installs it, which re-runs `npm view` that day):

| Package | Version | Published | Engines, licence | Installed by |
|---|---|---|---|---|
| password hashing | none: `node:crypto` (Node 26.13.0) | — | — | — (fallback `@node-rs/argon2` 2.2.2, 2026-10-06, MIT [S8]) |
| `jose` | 6.2.15 | 2026-11-01 | no `engines` field; MIT [S9] | the first auth task that signs a token |
| `otpauth` | 9.6.0 (alternative 9.5.2) | 2026-11-02 | no `engines`; depends on `@noble/hashes` 2.4.0 (`node >= 20.19.0`); MIT [S13] | the MFA task |
| `nodemailer` | 10.3.1 | 2026-10-29 | `node >=20.0.0`; MIT-0 [S19] | A1-T8 (`smtp` adapter) |
| `@aws-sdk/client-sesv2` | 3.1163.0 | 2026-11-05 | `node >=20.0.0`; Apache-2.0 [S19] | A1-T8 (`ses` adapter); the version is fixed on the day of install, since a new one ships almost daily |
| `@nestjs/jwt` | not installed (12.0.3 seen) | 2026-10-12 | [S10] | — |

Whether A1-T8 uses `nodemailer`'s SES transport or the SES client directly is A1-T8's choice; both rows are listed so the mail transport has a dated source.

## 13. Questions only the owner can answer

1. Access token 15 minutes for both clients (section 1)?
2. Staff sessions 24 hours idle and 7 days absolute; customers 30 and 90 days (section 1)?
3. Live families: 10 per customer, 5 per staff member, oldest revoked silently (section 1)?
4. `GET`/`DELETE /me/sessions` in phase 1 (A2-T4) instead of phase 2 (header row 8)?
5. Grace window after a restart: refuse without revoking (proposed) or treat as reuse (section 2)?
6. Password hashing with `node:crypto` (proposed) instead of the `argon2` package ADR-0003 names (section 4)?
7. Password minimums: keep 10 (customers) and 12 (staff), or follow NIST's 15 for single-factor passwords (customers and `STAFF`) (header row 13)?
8. Breached-password check and blocklist out of phase 1 (header row 12)?
9. Lockout: 10 failures for customers, 5 for staff, 15 minutes doubling to 4 hours (section 4)?
10. One identical `401 INVALID_CREDENTIALS` for a locked account, instead of a lock message (header row 9)?
11. Daily cap of 5 codes or links per user and type (section 6)?
12. Throttle figures of section 7, to be reviewed after real traffic?
13. Authenticator issuer `Kitchen Daylight` until the real brand is chosen (`WA1`)?
14. `otpauth` 9.6.0, or 9.5.2 for a release with more field time (section 8)?

## Consequences

- **A1-T2:** the variables of section 12 with their validation, `.env.example`, the 0005 table rows and the dev generation in `env:sync`; text for the Docker repository (`gen-dev-secrets.sh`, `api-contract.md`) in [follow-ups.md](follow-ups.md) through P6-T4.
- **A1-T4:** the `refresh_tokens` columns of section 2 and `email_tokens.created_at`; each column not in data-model is logged in [api-divergences.md](api-divergences.md).
- **Auth tasks:** the constants of sections 1 and 7, the PHC helper with a known-answer test, the single-flight refresh map, the lockout formula, the code HMAC, the link fragment, the cookie and CSRF checks, the JWT claims and `kid` lookup; tests per testing-strategy "Auth and sessions" plus: re-hash on login, dummy-hash timing path, NFC and code-point length, grace window after a simulated restart, family limit eviction, recovery-code normalisation and single use, TOTP replay across one step, ciphertext bound to the user id, previous-key decryption, `kid` rotation, missing `X-Client` or foreign `Origin`.
- **A1-T8:** the mail transport pins of section 12.
- **A2-T4:** the session list over families with `device_label` and `last_used_at`.
- **Logging:** the redaction list of 0005 section 11 gains the secret field names these flows introduce (`*.code`, `*.recoveryCode`, `*.nonce`); the `kd_refresh` cookie is already covered by the `cookie` and `set-cookie` header rules.
- **Revisit triggers:** a second API instance (grace map, nonces and throttle counters move to a shared store, new record); a production hash time far from the measured target (section 4 parameters); NIST or OWASP changing the argon2id minimums; the real brand (issuer string); a provider SDK that cannot pass the nonce unchanged.
