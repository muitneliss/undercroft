# 129. A failing test is visible wherever the figure is read, and a single-model build cannot publish rows that failed upstream

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0051](0051-a-deploy-stops-a-run-at-a-safe-point-and-the-run-keeps-its-counts.md) (a run's three statuses),
  [ADR 0090](0090-reports-computes-no-figure-it-cannot-stand-behind.md) (Reports computes no figure it cannot stand behind),
  [ADR 0092](0092-lineage-draws-only-declared-relations.md) (lineage draws only declared relations),
  [ADR 0126](0126-a-build-is-several-models-in-one-run-and-need-not-be-waited-for.md) (a build is several models in one run)

## Context

Every model is `+materialized: table`, and `dbt build` builds a model and then tests it. A failing
test skips only the models downstream, so the failing table already holds the new rows, and
nothing rolls them back. Issue 456: such a build closed `ok`, `models.list` and `models.get`
showed `lastBuild` as a success, and a Reports question over the table served the rows with no
qualifier. `transform.test.ts` pins "a failing test is counted on an otherwise successful
build", so the status is deliberate; what was missing is any reader being told.

Issue 457: a customer guards a published model by putting a tested draft in front of it, so a
failing draft test stops the published model in a scheduled build. `models.build` of the
published model alone runs `dbt build --select published` with none of the draft's tests, copies
whatever the draft holds, and reports success.

## Decision

**A run keeps its three statuses and gains a derived verdict.** `runVerdict(status,
testsFailed)` in `@undercroft/contracts/runs` gives `running`, `failed`, `tests-failing` (`ok`
with at least one failing or erroring test) or `clean`. It is computed on every read, never
stored, so it cannot disagree with the two columns it reads. Run reads (`runs.list`, `runs.get`,
the parent and child links) and `models.build` answers carry it; the Journal row and the run
detail show "tests failing". A fourth status was rejected: ADR 0051 and every consumer of
`status` (the one-running index, the alerts' claims, the journal filters) would have had to
learn that `ok` sometimes means "written but suspect", and the table WAS written. The recovery
card in the operators' Lark group, the one alert that fires on an `ok` run, now says "runs
again, but some of its tests are failing" in orange for a build whose verdict is
`tests-failing`, instead of "working again".

**A test belongs to the model dbt's manifest attaches it to.** After each build the worker reads
`target/manifest.json` beside `run_results.json` and writes each test step's model to the new
`ops.run_step.model` (`560_run_step_model.sql`): a generic test's `attached_node`; for a test
with none, the one model it depends on; depending on several, the one its file name leads with
before the last `__` (the singular-test naming of ADR 0130), and otherwise none. Reading the
model out of a test's name was rejected: `not_null_a_b_c` is column `b_c` of `a` or column `c`
of `a_b`, and dbt hashes a long name. A test that cannot be attributed, and every step recorded
before this, belongs to no model.

**A model's latest tests are those of the build serving its rows.** `latestTestsPerModel` takes
the newest transform run in which the model built successfully, because that build wrote the
table every question reads; a later run where the model failed to build left that table in
place, and a run that built only a child never touched it. Its attributed tests give
`lastTests` on `models.list` (state, failing and warning counts, the run) and on `models.get`
(the failing and warning tests by name):

- `failing`: any test `fail` or `error`, the two statuses `testsFailed` counts.
- `passing`: at least one test `pass` or `warn`, none failing. A `warn` is a test its author
  asked to be told about rather than stopped by; it does not fail the model, and it is counted
  in `warnings` and listed, so it is visible.
- `unknown`: no such build, or no attributed test that passed, warned or failed. It is never
  reported as passing (CLAUDE.md rule 2): the absence of a failing test is not a passing one.

**A Reports answer names the tables it read whose tests are not passing.** `bi.answer`,
`bi.runQuestion` and `bi.questions.answer` return, beside `{columns, rows, truncated}`,
`qualifiers`: one per analytics table the query read whose `lastTests` are `failing` or
`unknown`, with the run. The rows are never withheld; ADR 0090's rule is to qualify, not to
hide. Which tables a query read is taken from Postgres's own plan: the worker runs
`EXPLAIN (VERBOSE, FORMAT JSON)` of the framed statement, in the same read-only transaction, as
the tenant's BI login, and collects every scan node's `Relation Name` whose `Schema` is the
tenant's analytics schema. Parsing the SQL text was rejected: a CTE, an alias, a name in a string
literal and a name `search_path` resolves are each a guess. The BI login cannot read `ops`, so
the worker returns the relations and the control plane joins in their test state. `qualifiers`
is `null` when the relations are not known (a worker older than this, or a plan it could not
read), which a screen words as "not known", never as "nothing to say".

**A build refuses to copy a parent's failing rows.** Before a build, `guardParents` computes the
set the selection builds (`name`; `+name` with every ancestor; `name+` with every descendant,
over the stored models' `ref()` edges, raw sources ignored), then reads `lastTests` of every
direct parent of that set that is outside it. One `failing` refuses the build with
`PRECONDITION_FAILED`: the sentence names the parent, its failing tests and the run, and gives
the way on (fix and rebuild the parent, or build `+name`); the facts carry the same, plus every
failing parent. A parent inside the set is rebuilt and tested in the same run before its
children, and dbt skips them if it fails, so `+name` and a selection that names the parent need
no guard. The web Build button calls the same procedure and shows the same sentence.

**A parent with unknown tests does not refuse; it is named.** It goes in the build's
`parentTestsUnknown`, as unknown and not as passing. Refusing on unknown was rejected: most
parents today have no tests, so every model over one would become unbuildable alone, and the
guard would be bypassed by habit rather than read. The person or agent is told the rows went in
untested, which is the fact.

## Consequences

- A build whose tests fail is still `status: ok`; anything that wants "succeeded" reads
  `verdict: "clean"`. The skills say so (guardrail 12 of `undercroft-model-builder`).
- Every model reads `unknown` until its first build after this release, because older steps
  carry no attributed model. That is the honest reading of what the ledger knows.
- Each Reports answer costs one more planning pass (EXPLAIN executes nothing) and one ledger
  read for the tables it read.
- The guard is read before the worker takes the tenant's build lock; a scheduled build that
  finishes in between can change a parent's state after the check. Builds of a tenant are
  serialised by that lock, so the window is one build wide.
- A read a model's text does not declare (ADR 0092) is not a parent to the guard.
- Not done here: keeping the last passing version of a table (#459), and richer tests (#458,
  ADR 0130), whose singular tests this attribution already covers.
