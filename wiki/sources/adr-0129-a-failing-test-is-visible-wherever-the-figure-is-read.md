---
title: ADR 0129 A Failing Test Is Visible Wherever the Figure Is Read
type: source
date: 2026-10-13
tags: []
source: docs/adr/0129-a-failing-test-is-visible-wherever-the-figure-is-read.md
source_path: docs/adr/0129-a-failing-test-is-visible-wherever-the-figure-is-read.md
source_hash: 1d3748ce5f1c79319f83227630d9fa4ec6c9da8a43b0f74123f11a15a4ec0654
ingested: 2026-10-13
---

# ADR 0129 A Failing Test Is Visible Wherever the Figure Is Read

Issues #456 and #457. Every model is a table and `dbt build` tests after it builds, so a failing test leaves the new rows in place and Reports served them bare; and building one model alone copied a parent's rows that had just failed their tests.

**A derived verdict, no fourth status.** The ledger keeps `running`, `ok`, `failed` ([[ADR 0051: A deploy stops a run at a safe point, and the run keeps its counts]]). `runVerdict(status, testsFailed)` in `@undercroft/contracts/runs` gives `running`, `failed`, `tests-failing` (`ok` with a failing or erroring test) or `clean`, computed on every read. Run reads and `models.build` carry it; success is `clean`. The Journal row and run detail show "tests failing"; the operators' Lark recovery card for a build that runs again with failing tests is orange and says so rather than "working again".

**Test attribution from dbt's manifest.** The worker reads `target/manifest.json` and writes each test step's model to `ops.run_step.model` (migration 560): a generic test's `attached_node` (column, `accepted_values` and `relationships` tests); a SQL test of [[ADR 0130 A Rule About a Model's Rows Is a Test of That Model, Not a Model of Its Own]], named `<model>__<name>`, belongs to the model before the last `__` when it reads it and to none otherwise; any other test with no attached node to the one model it depends on. Never from a generic test's name, which is ambiguous and hashed when long. Older steps belong to no model.

**A model's `lastTests`.** From the newest run in which the model built successfully (the build serving its rows): `failing` if any attributed test is `fail`/`error`, `passing` if at least one passed or warned and none failed (`warn` counted in `warnings`, visible), else `unknown`, never a pass. On `models.list` (summary) and `models.get` (failing and warning tests by name); the Models list and a model's facts show it.

**Reports qualifiers.** `bi.answer`, `bi.runQuestion` and `bi.questions.answer` return `qualifiers`: each analytics table the query read whose tests are failing or unknown, with the run; rows never withheld. The tables read come from `EXPLAIN (VERBOSE, FORMAT JSON)` of the framed statement as the BI login, in the same read-only transaction, never from the SQL text; the control plane joins in the state since the BI login cannot read `ops`. `null` means not known. The question view and each dashboard tile word them, Vietnamese first.

**Build guard.** Before a build, the set it builds is computed from the selection (`+name` adds ancestors, `name+` descendants) over stored `ref()` edges ([[ADR 0092 Lineage Draws Only Declared Relations]]); a direct parent outside the set whose `lastTests` are failing refuses with `PRECONDITION_FAILED` naming the parent, tests and run, and the way on (rebuild it, or `+name`). A parent with unknown tests does not refuse and is named in `parentTestsUnknown`, because refusing would make most models unbuildable alone. The web Build button calls the same procedure.

Extends [[ADR 0126 A Build Is Several Models in One Run, and Need Not Be Waited For]].
