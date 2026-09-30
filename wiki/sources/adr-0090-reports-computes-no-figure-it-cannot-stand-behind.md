---
title: ADR 0090 Reports Computes No Figure It Cannot Stand Behind
type: source
date: 2026-09-30
tags: []
source: docs/adr/0090-reports-computes-no-figure-it-cannot-stand-behind.md
source_path: docs/adr/0090-reports-computes-no-figure-it-cannot-stand-behind.md
source_hash: 0c97ab033974fe9a4a4c86d2f279fbe60cfd77c8b8f6a55d4b10e7c29c2ff772
ingested: 2026-09-30
---

# ADR 0090 Reports Computes No Figure It Cannot Stand Behind

# ADR 0090 Reports computes no figure it cannot stand behind

Status: Accepted, 2026-09-30. Builds on [[ADR 0020: BI is first-party, Metabase leaves the stack]] (Reports is first-party on Chart.js, and what a drawing cannot say a table can). Supersedes nothing: the behaviour it replaces was a fallback in code, never a decision.

## Context

Almost every figure in Reports is one the database sent. Two drawings computed a figure of their own and both guessed: a gauge or progress bar with no bound set (`chart.options.max`) was drawn against the largest value in the result, else 100, and a missing reading as a needle at zero; a pivot summed the values present and printed the result as the total even when a value that belonged in it was missing.

## Decision

* **A gauge or progress bar draws a share only against its author's bound.** With none it prints the reading, says the bound is missing, and draws nothing; with a bound but no reading it draws nothing either. One wordless function decides: `readingShare` in `apps/ui/src/lib/readingBound.ts`.
* **A pivot figure carries `incomplete`** when anything summed into it was missing or unreadable, propagating to row, column and grand totals. The partial sum is printed with the word "incomplete" beside it and a note defines the word; a whole group prints plainly. A combination no row mentions is missing but taints no total. `apps/ui/src/lib/pivot.ts`.
* **The mark is text, not colour**, so it survives a screen reader, a print and a copy.

## Consequences

An existing gauge or progress question saved with no bound stops drawing a share until its author sets one -- the rule applied, not a regression. Any future figure Reports computes in the browser must carry its own incompleteness or not be computed.

## Options rejected

Withholding an incomplete total (a partial sum is still worth reading, as the truncated-result note already qualifies rather than hides); marking by colour or asterisk alone; keeping the gauge fallback with a label; defaulting the bound to 100 for percentage-looking columns (the browser cannot know a column is a percentage).
