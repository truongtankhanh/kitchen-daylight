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
