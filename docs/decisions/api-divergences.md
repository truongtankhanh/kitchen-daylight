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
