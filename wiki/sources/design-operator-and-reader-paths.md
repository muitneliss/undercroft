---
title: 'Design: Operator and reader paths'
type: source
date: 2026-09-30
tags: []
source: docs/design/operator-and-reader-paths.md
source_path: docs/design/operator-and-reader-paths.md
source_hash: ca65c51c921325478382cf062d9b100b54bd591e84d14efd28dfecde62a8eaf7
ingested: 2026-09-30
---

# Design: Operator and reader paths

An accepted design contract (#346, #347, #348) for three walks through the book that break today, made continuous without changing any permission: each step opens the next already narrowed to the same account, run, model or filter values; each count leads to what it counts ([[ADR 0039 A Count Has a Route to Its Constituents]]); and a limit the server enforces is shown before the person reaches it. A runnable prototype with synthetic data lives on the unmerged branch `review/ui-r5b`.

**What changes from today.** The document separates the proposal from the code on `main`. Server work, none of it adding or widening a gate: an optional `source` on `runs.list`; a migration adding `app.run_scope`, the scope each run read with, one row per run and kept out of `ops.run` because BI reads every column there (ADR 0091; older runs show an em dash); an optional run id on `lake.records`/`lake.documents`, where `raw.records.run_id` names only the last writer, so a run's view counts the records later runs rewrote as its own count less those still naming it; and a read-only lineage procedure built on `readJinja`, the reader `models.check` uses. Reader-visible changes: a gauge or progress with no bound stops drawing a guessed share (today `readings.tsx` uses the largest value, else 100); a pivot sum over a missing value is marked incomplete (today `pivot.ts` prints the partial sum plainly); source-card write plates become absent rather than disabled for member and viewer; withdrawing an invitation takes a second press naming the address; a tile opens its question on the dashboard's values with a way back; the last admin's row offers no lower role or removal.

**Operator path.** A source card opens the Journal filtered to that account, the filter in the address. A run shows its starting scope and, for an admin, its created/changed counts open the records it wrote. Saving a scope says what happens to held records: Drive items outside the pick are marked removed at source by the next complete read ([[ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source]]), Gmail messages stay live; never an erasure. The Models list gains one count per build state that filters it. Lineage sits inside Models ([[ADR 0019: the wheel is full]]) and draws only declared relations, `ref()` and `source('undercroft', ...)` with literal arguments, including those declared inside a called macro such as `gmail_letters()`; no edge from a source account ([[ADR 0043 A Second Mailbox Is a Second Source]]) or to a report. A dynamic reference, an unknown macro or a raw table named directly is marked "upstream not declared"; a `ref` to a deleted model is a missing dependency ([[ADR 0077 Deleting a Model Drops What It Built]]).

**Reports.** Chart.js and all sixteen types stay, with no drill-through ([[ADR 0020: BI is first-party, Metabase leaves the stack]]). Every chart offers its rows as a table to every role that can see it, and a CSV of exactly those rows: all digits, a missing value empty never 0, formula-leading text neutralised, a truncated result announced before download. The list is searchable with accents ignored (`foldForSearch`), and its time is named as when the definition was saved, never as data freshness.

**People and Customers.** The last admin's row is marked; the guard in `membership.ts` (#168) stays the control. Each role's rights are stated beside the invitation form and must match the router's gates; inviting stays admin-only and a re-invite refreshes the open invitation ([[ADR 0010 Invite-Only Sign-In with Better Auth]]). The customer list narrows by the reader's role together with search.

Across all three: stepped motion ([[ADR 0014 Frames Are Size, Nothing Eases]]), no modal (`apps/ui/DESIGN.md`), usable below 760 px, filter values in the address and second presses in a `<details>` fold rather than `useState`, every word a dictionary entry with Vietnamese first. Out of scope: edges to source accounts or reports, drill-through to records, model versions, a review step before every role change, and any change to roles or grants.
