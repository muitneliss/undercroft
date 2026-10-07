---
title: ADR 0114 The Model Builder Finds Out What Is Needed Before It Builds Anything
type: source
date: 2026-10-07
tags: []
source: docs/adr/0114-the-model-builder-discovers-before-it-builds.md
source_path: docs/adr/0114-the-model-builder-discovers-before-it-builds.md
source_hash: 16d30c1c838279c82edc0d69aaed34d9be7ab596acf6b4e95b39857e066e69fa
ingested: 2026-10-07
---

# ADR 0114 The Model Builder Finds Out What Is Needed Before It Builds Anything

Widens the `undercroft-model-builder` skill of [[ADR 0067: The published skills are one family, installed by npx skills and served by /mcp]] without renaming it, and keeps the reasoning of [[ADR 0112 A Model Carries No Business Context]]: a model's meaning lives in the brief and its tests. The workflow used to start at the model brief, so "build me a model" always produced a model. The production tenant showed the cost: about 185 models behind about 20 questions and 3 dashboards, one business filter repeated across questions, a hand-kept model list copied into two questions, overlapping models around one concept, and a formula made a macro only after eight models copied it.

Decision. The builder is discovery-first; a new model is one outcome, not the premise. It reads `models.list`, `macros.list`, `models.reference`, `lake.summary`, `bi.questions.list` and `bi.dashboards.list` first and gives a short inventory; interviews outcome before implementation, one question at a time, reading facts from the data and asking only for meaning; routes to Explore, Reporting, Modeling or a combination; searches for an owner in order (question or dashboard, model, macro, raw entity, a change to one, then new) and justifies any new component in one sentence; shows approaches and a reuse map (`REUSE`/`MODIFY`/`NEW`); writes nothing until the person approves the plan, which opens the gate but does not replace each save's yes or the build's separate yes; writes the plan to one file in the person's workspace (their docs location, where they say, or `docs/undercroft/`), or says it was not saved; validates meaning and checks for duplication before handing over. Detail lives in `references/discovery.md`; `SKILL.md` is the map and keeps every guardrail; `references/interview.md` is the Modeling route's brief. `publishedSkills.test.ts` pins that the skill names every discovery read.

Rejected: renaming the skill (installed by name; ADR 0067's rename already cost installers a step), a second discovery skill (would compete for the same request and let an agent skip discovery), new procedures such as a platform-stored plan (every read exists; ADR 0112 removed per-model prose nobody kept), and testing prose wording. Consequences: a model request may end with a question, a tile, one column or an exploratory answer; a few more reads up front; a read-only person can still leave with a plan; saving a question or dashboard with an `id` replaces it whole, so the skill reads it first.
