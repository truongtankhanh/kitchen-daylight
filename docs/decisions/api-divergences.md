# API divergences

Not a decision record. This file lists every place where the API, as built, differs from [data-model.md](../data-model.md) or [api-outline.md](../api-outline.md). The API track never edits those two documents ([decision 0007](0007-api-platform-libraries-and-rules.md), section 13): a task that builds something different adds one row here in the same change, and a later documentation task folds the answered rows into the documents.

## Row format

| Column | Content |
|---|---|
| `id` | `D-NNN`, numbered in order, never reused |
| `task` | the task that built it (for example `A1-T3`) |
| `document and section` | the file and the section or table row, for example `data-model.md`, `users` row |
| `what the document says` | a short quote or paraphrase |
| `what was built` | the table, column, constraint, endpoint, status or code as it exists in the code |
| `why` | the reason, with the decision record or evidence that forced it |
| `owner decision` | empty until the owner answers: `accepted` (the document follows the code), `rejected` (the code follows the document, with the task that fixes it) or another instruction, with the date |

A contradiction already listed in a decision record's header table is logged here only when a task builds it.

## Divergences

| id | task | document and section | what the document says | what was built | why | owner decision |
|---|---|---|---|---|---|---|
| D-001 | A0-T3 | `api-outline.md`, "Error code catalogue (stable)", "Field-level codes" | 29 field-level codes, each for a named rule; no generic code, and none for a property the DTO does not declare | `FieldErrorCode` has a 30th code, `INVALID`: the validation pipe uses it for a class-validator constraint with no catalogue code (for example `matches`, `minLength`, a failed nested-object check) and, with the message `is not allowed`, for an unknown property rejected by `forbidNonWhitelisted` | Every `errors[].code` must be a catalogue code (decision 0007 section 9), and the global pipe meets rules that no slice has named yet. A slice that needs a precise code adds it to the catalogue and maps its constraint | |
| D-002 | A0-T3 | `api-outline.md`, "Error code catalogue (stable)", the 18 codes "unchanged from v2" | the codes are listed with no HTTP status | `ERROR_STATUS` gives them the statuses of decision 0007 section 9 (answered 2026-11-05): `VALIDATION_FAILED`, `CODE_INVALID` and `UPGRADE_REQUIRED` 400; `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` 401; `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, `SELF_CHANGE` 403; `NOT_FOUND` 404; `STALE_VERSION`, `ALREADY_EXISTS`, `IN_USE`, `LAST_ADMIN`, `REVIEW_EXISTS` 409; `RATE_LIMITED` 429; `MAINTENANCE` 503 | Decision 0007 contradiction row 11, built here | |
| D-003 | A0-T3 | `api-outline.md`, Conventions, "Errors" | `type`, `title`, `status`, `detail`, `code`, `errors[]`; no value given for `type` and `title` | `type` is always `about:blank` and `title` the RFC 9110 reason phrase of the status (`Content Too Large` for 413, `Unprocessable Content` for 422). A Nest exception mapped by status carries no `detail`, because Nest's message repeats the URL (`Cannot GET /…`); `500 INTERNAL_ERROR` carries a fixed `detail` | Decision 0007 contradiction row 13 and RFC 9457 section 4.2.1, built here | |
| D-004 | A0-T4 | `api-outline.md`, Conventions, "Pagination"; "Field-level codes", `INVALID_CURSOR` | "a malformed or expired cursor" returns `INVALID_CURSOR`; no cursor format and no meaning of "expired" | `encodeCursor` and `decodeCursor` (`apps/api/src/common/pagination/cursor.ts`): an unsigned `base64url(JSON)` of `{ v: 1, d: 'n' \| 'p', k: [<sort values>, <id>], f }`, where `f` is the first 16 hex characters of the SHA-256 of the list's canonical filters and sort. `INVALID_CURSOR` when the cursor is longer than 512 characters, not base64url JSON, of an unknown `v` or `d`, missing or adding a member, of the wrong key arity or types, or when `f` no longer matches the filters ("expired"); there is no time-based expiry | Decision 0007 contradiction row 7 and section 6, built here | |
| D-005 | A0-T4 | `api-outline.md`, Conventions, "Optimistic concurrency"; "Payloads added to existing codes", `STALE_VERSION` | `current { rowVersion, updatedBy { id, name }, updatedAt }` | `StaleVersionPayload` in `@kd/contracts` and `assertRowVersion`: `updatedBy` is `{ id, name }` or `null` for a system change, `updatedAt` an ISO 8601 instant. The settings `value` member is not built yet (A4-T2) | Decision 0007 section 7 and contradiction row 8: a change made by a job or a trigger has no user | |
| D-006 | A0-T4 | `data-model.md`, Conventions, "Time zone" | one zone (`Asia/Ho_Chi_Minh`) "as configuration, not a column" | `BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh'`, one exported constant in `apps/api/src/common/time/vietnam-time.ts`; no environment variable | Decision 0007 contradiction row 10 and section 8: the zone defines stored values (`business_date`, the date in `order_number`), so a per-tier value could make tiers disagree | |
