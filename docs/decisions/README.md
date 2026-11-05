# Decision records

Decisions taken while building this repository. Product-wide architecture decisions live in the project ADRs; the records here pin how this repository implements them.

Since P6-T1 (2026-11-05) the project ADRs are in this repository: [../adr/](../adr/), ADR-0001 to ADR-0010, indexed in [../README.md](../README.md#decisions). The records below were not moved or renumbered, because code, CI and configuration cite them by number: they stay a separate series, cited as "decision NNNN", while the project records are cited as "ADR-NNNN".

## Format

One file per decision, named `NNNN-short-title.md`, numbered in order and never reused. Each record has:

- **Status** line: `proposed`, `accepted`, `superseded by NNNN` or `rejected`, with the task and date.
- **Context:** the problem and the constraints that force a decision.
- **Options:** the alternatives considered.
- **Evidence:** what was checked, with sources and the date read; anything not verified is marked "to confirm in <task>".
- **Choice:** what was decided.
- **Reason:** why this option over the others.
- **Consequences:** what follows, including follow-up work and the triggers to revisit.

An accepted record is not rewritten: a change of decision is a new record that supersedes it.

## Index

| ID | Title | Status | Date | Task |
|---|---|---|---|---|
| [0001](0001-toolchain-versions.md) | Toolchain versions and compatibility | accepted | 2026-11-03 | P0-T2 |
| [0002](0002-quality-tooling.md) | Quality tooling: tests, lint, hooks, commits, secrets | accepted | 2026-11-03 | P0-T3 |
| [0003](0003-workspace-packages-and-boundaries.md) | Workspace packages and dependency boundaries | accepted | 2026-11-03 | P0-T4 |
| [0004](0004-contract-and-client.md) | Contract workflow and client generator | accepted | 2026-11-03 | P0-T5 |
| [0005](0005-api-foundation-conventions.md) | API foundation conventions | accepted | 2026-11-03 | P0-T6 |
| [0006](0006-admin-and-mobile-platform-facts.md) | Admin and mobile platform facts | accepted | 2026-11-03 | P0-T7 |
| [0007](0007-api-platform-libraries-and-rules.md) | API platform libraries and rules | proposed | 2026-11-05 | A0-T1 |

Not a decision record: [follow-ups.md](follow-ups.md) holds the paste-ready text that P6-T4 hands to the Docker repository and the design documents, and the slice 1 readiness checklist. [api-divergences.md](api-divergences.md) lists where the API as built differs from `data-model.md` or `api-outline.md` (decision 0007, section 13).
