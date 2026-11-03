# Decision records

Decisions taken while building this repository. Product-wide architecture decisions live in the project ADRs; the records here pin how this repository implements them.

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
| [0001](0001-toolchain-versions.md) | Toolchain versions and compatibility | proposed | 2026-11-03 | P0-T2 |
| [0002](0002-quality-tooling.md) | Quality tooling: tests, lint, hooks, commits, secrets | proposed | 2026-11-03 | P0-T3 |
