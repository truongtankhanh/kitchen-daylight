# 0011. Staff refresh cookie: `Secure` by tier

Status: **accepted** (phase A3 review, proposed 2026-11-09; accepted by the owner 2026-11-09). Amends one bullet of [decision 0008](0008-authentication-implementation.md), section 10; the rest of 0008 stands. Numbered 0011 because 0009 and 0010 are already reserved and cited by the plan (0009 media and storage, A6-T1, also cited in `apps/api/src/modules/settings/dto/public-config.dto.ts`; 0010 ordering engine, A8-T1).

## Context

Decision 0008, section 10, sets the staff refresh cookie as `kd_refresh=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/admin/auth` in every tier. Its last bullet adds that whether every supported browser accepts a `Secure` cookie from `http://localhost` and `http://127.0.0.1` is not verified, that the admin auth slice confirms it in its smoke run, and that "until a browser fails, no insecure-cookie switch exists".

The A3-T1 prompt then asked for `Secure` "in every tier except `dev` and `test`", because Safari ignores `Secure` cookies on `http://localhost`, with a unit test proving that `demo` and `prod` always set it. A3-T1 built exactly that (`f6ab211`): `refreshCookieSecure(appEnv)` in `apps/api/src/modules/auth/refresh-cookie.ts` returns `false` for `dev` and `test` only. No record named the departure from 0008; api-divergences D-078 cites `api-outline.md` only. The phase A3 review (2026-11-09) found it: the decision record wins over code and prompts, so the code needs a record or a change.

## Options

1. **`Secure` in every tier** (0008 as written). The cookie never travels without `Secure`. If a browser used for local development drops a `Secure` cookie set over `http://localhost` or `http://127.0.0.1`, the admin console cannot refresh its session locally, and a switch has to be added then.
2. **`Secure` by tier, fixed in code** (built). `dev` and `test` leave `Secure` out; `demo` and `prod` always set it. No variable can change it: the rule reads the validated `APP_ENV` only.
3. **A configuration switch** (for example `REFRESH_COOKIE_SECURE=false`), refused outside `dev` by the production guard, as 0008 foresaw "if one is ever added". One more variable, one more guard case, and a value that can be set wrong in `dev`.

## Evidence

- The code and its spec, read 2026-11-09: `refresh-cookie.ts` lines 17 to 23 (`INSECURE_COOKIE_TIERS = ['dev', 'test']`); `refresh-cookie.spec.ts` lines 22 to 35 (`demo` and `prod` always set `Secure` on the cookie and on its clearing; `dev` and `test` leave it out); `admin-auth.controller.ts` line 186 reads `this.config.appEnv`.
- `ADMIN_ORIGINS` is `https` only in `demo` and `prod` (0008 section 10; D-077), so the tiers that leave `Secure` out are the ones whose admin runs on `http` loopback origins.
- The A3-T7 smoke run (`docs/smoke-runs/api/phase03.md`, step 3, 2026-11-07, `dev` on `http://127.0.0.1:3001`) saw `Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict` with no `Secure`, and the cookie jar refreshed and rotated (step 4). That run used `curl`, not a browser.
- MDN (0008 sources S17, S18): the `https:` requirement of `Secure` is ignored for cookies set by `localhost`, and loopback hosts are potentially trustworthy; per-browser behaviour on `http://localhost` and `http://127.0.0.1` is not stated.
- **Not verified:** that Safari, or any browser the admin supports, drops a `Secure` cookie set over `http://localhost` or `http://127.0.0.1`. The A3-T1 prompt states it without a source. To confirm in the first admin-console smoke run in a browser.

## Choice

Option 2. The staff refresh cookie sets `Secure` in `demo` and `prod`, always, and leaves it out in `dev` and `test`. The rule is a fixed function of `APP_ENV` in `refresh-cookie.ts`, covered by `refresh-cookie.spec.ts`; there is no variable to change it.

## Reason

- It keeps local development working whatever a browser does with `Secure` on a loopback `http` origin, without waiting for a failure.
- It cannot weaken a deployed tier: `demo` and `prod` are decided by the validated `APP_ENV`, the same value that already forces `https` admin origins there, and a unit test fails if either tier loses `Secure`.
- Option 3 would add a variable and a guard case for the same effect, and a misconfigured `dev` could still be wrong; option 1 defers the problem to the first developer whose browser drops the cookie.

## Consequences

- In `dev` and `test` the refresh token travels in a cookie without `Secure` over plain `http`. That is acceptable only on loopback origins. If a `dev` admin is ever served to another device on the network (for example a tablet on the LAN), the cookie crosses the network unencrypted: serve that setup over `https` or treat the tokens as exposed.
- `HttpOnly`, `SameSite=Strict`, the `Path`, and the `X-Client` and `Origin` checks of 0008 section 10 are unchanged in every tier.
- Revisit when a browser smoke run of the admin console shows that every supported browser keeps a `Secure` cookie on the `dev` origins (then option 1 is enough), or if a new tier is added (it must be placed in or out of `INSECURE_COOKIE_TIERS` explicitly).
- Accepted 2026-11-09: the index in [README.md](README.md) shows `accepted`, and the A3 gate row of the API STATUS records it.
