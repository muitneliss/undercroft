---
name: undercroft-model-builder
description: Guide a person from a question about their data to the smallest change in Undercroft that answers it, over its MCP tools or its CLI -- an exploratory answer, a report question or dashboard over models they already have, a change to an existing model or macro, or a new dbt model. Use when a person wants to save a query as a model (a raw-lake query, a report question's SQL, SQL they paste) or build one, wants a report or dashboard and may not know which layer it needs, or asks what they can build with their data. It inventories the tenant's lake, models, macros, seeds, questions and dashboards first, asks one question at a time, reads the lake instead of guessing, compares approaches and gets a plan approved before any write, writes the plan down, then checks a model with models.check, previews what it returns with models.preview, and asks before it saves and again before it builds. Needs the undercroft skill for how to reach the platform.
---

# From a question to a model, or to something smaller

A person who asks for a model usually wants an answer. The answer may already be on a
dashboard, or be one question over a model the tenant already has, one column added to an
existing model, a macro, or a look at the data. A new model is one possible outcome of this
workflow, and ending without one is often the right result.

A model is one dbt `SELECT` that the platform turns into a table in the customer's own
analytics schema, named after the model. Reports and dashboards read that table. A build writes
into a staging schema first, and the table is replaced only when the build passed its tests:
a build that failed leaves the last passing version in place, and a first build that failed
leaves nothing for Reports to read. A wrong
model does not fail loudly: it becomes a dashboard that shows a wrong number as if it were a
fact. A second model for a concept the tenant already defines is wrong more quietly still:
two tables that will disagree. So this workflow is slow on purpose. Find out what the tenant
already has, understand what the person needs, read the data, agree a plan, and let the
person decide every change.

Read the `undercroft` skill first. It says how to reach the platform (MCP tools or the CLI),
how an operation is named on each door, and what each refusal means. This skill names
operations by procedure path, such as `models.check`.

## Guardrails

These hold for the whole workflow. None of them bends because the person is in a hurry.

1. **Discover before you design, and the brief before model SQL.** Read the tenant and
   understand the need (`references/discovery.md`) before you propose anything. A model's
   SQL waits for its brief -- purpose, grain, source, columns, filters, name, tests -- which
   `references/interview.md` gets from the person.
2. **No write before the plan is approved.** Until the person explicitly approves the plan
   you showed, save, overwrite, build, configure and delete nothing -- no model, macro, seed,
   question or dashboard. Reading, sampling, bounded queries and drafting are allowed. The
   approval covers that plan only; a changed plan is shown again.
3. **Never guess the data.** Read entity names from `lake.summary` and payload keys from a
   sample in `lake.records`. A key you have not seen in a sample does not go in the model.
   Never guess a type: cast a column only when every sampled value fits the cast, and
   otherwise keep it as text and tell the person why. The same holds for statuses,
   currencies, date forms, keys, relationships and a workbook's layout.
4. **Missing stays missing.** An absent value is `NULL`, never `0`, `''` or a made-up
   default. Use the platform's macros, such as the one for reading an amount
   (`models.reference` with `parts: ["platformMacros"]`), rather than writing your own cast.
5. **Reuse before you create.** An existing question, dashboard, model or macro that owns
   the concept is used, not copied. Before you propose a new component, say why the
   existing ones cannot do it. Before you write an expression, look in `macros.list` for a
   macro of the customer's that does it, and call it. When the same expression would appear
   in a second model, or the person asks, propose a macro instead of a second copy: write it
   following `references/macro-patterns.md`, run `macros.check`, show the person the
   definition, its description and the models that will call it, and save it with
   `macros.save` and `create: true` only after their yes. Then call it from the model.
6. **Check before you show.** Run `models.check` on every draft. A finding with severity
   `error` must be fixed before the person sees the draft as ready. Every `warning` is shown
   to the person with its message, and so is the list of what the check could not verify.
7. **The person says yes to each save.** Approving the plan is not approving the write.
   Show the name, the whole SQL or definition, and the tests, and ask. Save only after a yes
   to that exact model, macro, question or dashboard.
8. **Never overwrite silently.** Save a model with `create: true`. When the name is taken,
   the save is refused with `CONFLICT`: read the existing model with `models.get`, show the
   person both, and let them choose another name or say, in words, that the existing model
   named X is to be replaced. A question or dashboard saved with an `id` replaces that one
   whole: read it first, and show the person what changes.
9. **The person says yes to the build, separately.** A build replaces the table every report
   on it reads. Ask again before `models.build`, even after the save was agreed. When several
   models changed, ask once for the set and build them in one call with `names` -- naming each,
   and saying when a `+` brings in the models upstream (`+name`) or downstream (`name+`) too.
10. **Never delete.** This workflow does not call `models.delete`, `macros.delete` or
    `seeds.delete`, and never removes a report or a dashboard. If the person wants a model
    gone, tell them it is a separate, destructive act -- it drops the table the model built and
    the failing rows its tests stored -- and let them ask for it on its own. A macro is the
    same: its own act, its own yes, and refused while any model or other macro still calls it.
    So is a seed: deleting it drops the table it was loaded into, and it is refused while any
    model reads it.
11. **Stop at a refusal.** `PERMISSION_DENIED`, `WRITES_DISABLED` and `HUMAN_REQUIRED` end
    the workflow. Tell the person what was refused and who can change it. Never work around
    one. `models.preview` is the one way to run a model's SQL before it is saved: never render
    its Jinja yourself -- `ref()`, `source()`, a macro -- and run the result through
    `lake.query`, which answers for what you rendered, not for what dbt compiles. A `CONFLICT`
    is reported, not looped: a deactivated customer refuses every operation until an admin
    reactivates it, and that is not yours to do.
12. **Success is the platform's answer.** A build succeeded when `models.build` (or, after
    `wait: false`, `runs.get` on its run) says `verdict: "clean"`, and the model is trustworthy
    when `models.get` says `lastTests.state` is `passing`. `ok` with `verdict: "tests-failing"` is
    a build held back from Reports because its tests refused rows -- the model's step says
    `promoted: false` and Reports still reads its last passing version -- not a success; `lastTests.state`
    `unknown` is no test record, never a pass. A question exists when `bi.questions.save`
    returned its id, and an answer whose `qualifiers` name a table is a figure to qualify when
    you show it. Until then, say what happened, not what you hoped. A row count of `null` is
    "not counted", never zero rows.
13. **Ask one decision at a time, through the host's question tool when it has one** --
    Claude Code's `AskUserQuestion`, for example -- and otherwise as numbered options in
    text. The evidence, the plan or the SQL goes in the message; the tool carries the
    question and two to four options, yours first. A dismissed question is not a yes.
    `references/discovery.md`, "How to ask", has the detail.
14. **A table a person keeps by hand is a seed, not a `VALUES` list.** A mapping or a list no
    source holds -- accounts to groups, codes to labels, the people a reviewer listed -- goes
    in a reference table (a dbt seed) that models read with `{{ ref('name') }}`, never inside
    a model's SQL, where each model that needs it carries its own copy and one changed row
    means saving the whole model again. Look in `seeds.list` for one the customer already
    keeps, and read it with `seeds.get`. To propose one, give every column a declared type
    (`text`, `integer`, `bigint`, `numeric(18,4)`, `boolean`, `date` or `timestamptz`) and
    every cell as a string or `null`: nothing is inferred, a code with a leading zero is
    `text`, and an amount is a string in `numeric(18,4)`. A missing cell is `null`; an empty or
    `null`-looking text cell is refused, because dbt would load it as NULL. Show the person the
    columns, their types and the rows, and save with `seeds.save` and `create: true` only after
    their yes. A refusal names the row (`rows[n]`) and the column: fix that cell with the
    person, never coerce it. A changed row is the whole table sent again to `seeds.save`, not a
    model save, and the next build that reads the seed loads it.

## Who can do what

- Anyone who can see the customer may run `models.list`, `models.get`, `models.reference`,
  `models.revision`, `models.check` and `models.lineage`, `macros.list`, `macros.get` and
  `macros.check`, `seeds.list` and `seeds.get`,
  `lake.summary`, and `bi.questions.list`, `bi.questions.get`, `bi.dashboards.list`,
  `bi.dashboards.get` and `bi.schema`.
- Running a definition against the built models (`bi.answer`, `bi.compile`) and saving a
  question or dashboard (`bi.questions.save`, `bi.dashboards.save`) need the `member` role
  or above.
- Reading the raw lake (`lake.records`, `lake.documents`, `lake.querySchema`, `lake.query`),
  saving and building a model (`models.save`, `models.build`), saving a macro
  (`macros.save`) and saving a seed (`seeds.save`) need the `admin` role.
- Previewing an unsaved model (`models.preview`) needs the `admin` role and the write grant
  below, as `lake.query` does: it saves nothing, but it runs the draft as the login that reads
  the raw lake.
- Over MCP, `lake.query`, `models.preview`, every save and `models.build` need a connection
  with a write grant. With the CLI, they need a profile that allows writes. `lake.query` and
  `models.preview` count as writes even though they only read, because each runs SQL somebody
  wrote.

If the person lacks one of these, say so at the start, before the interview. Do not find out
halfway through. A person who can read but not write can still be helped to the end of
discovery, and leave with a plan someone else can carry out.

## The workflow

```text
Find the ground -> Reconnaissance -> Interview and evidence -> Shared understanding
  -> Route: Explore | Reporting | Modeling -> Reuse and approaches -> Plan approved
  -> Plan written down -> Carry out the route step by step -> Validate -> Duplication check
```

Steps 2 to 7 and 10 to 11 are `references/discovery.md`, which owns their detail.

### 1. Find the ground

Take the tenant from `tenants.list`. If the person has more than one, ask which. Note what
the person's role and grant allow (above).

### 2. Reconnaissance

Read `models.list`, `macros.list`, `seeds.list`, `models.reference`, `lake.summary`,
`bi.questions.list` and `bi.dashboards.list`, and give the person a short inventory of what
bears on the request.
The lists are summaries; `references/discovery.md` says what each leaves out and how to ask
for it, and how `models.revision` and the content hashes tell you whether what you read is
still current.
To see what each model reads without walking the graph, ask `models.list` with
`include: ["dependsOn"]`; each model's own `description`, where its author wrote one, is on the
list already.
Read further -- `models.get`, `models.lineage`, `macros.get`, `seeds.get`, `bi.questions.get`,
`bi.dashboards.get`, `lake.records` -- when the request touches it. Before changing a model,
or building one beside it, read `models.lineage` for the models that `ref` it: they read what
it builds. Name the model (`name`, with `direction: "down"`) rather than reading the whole
graph, and narrow `bi.schema` to the tables you are weighing. Lineage lists only what the
models declare, and says so where it cannot read one.

### 3. Interview and read the evidence

Start from the outcome the person wants, who uses it and what they decide with it, not from
tables. Ask one question at a time (guardrail 13), offering choices the inventory shows. Answer every
factual question about the data with the smallest read that can, and ask the person only
what the data cannot say. When a count or a distribution is needed, ask the person before
running `lake.query`, and say it runs SQL against the raw lake. Keep such queries small,
with a `limit`.

Two entries need one more question each:

- **"Save this query as a model."** Ask where it came from -- a raw-lake query, a report
  question (read it with `bi.questions.get`), or their own -- and what will read the result.
  Whether it should be a model at all is what discovery decides.
- **"Build me a model."** The person has named a layer, not yet a need. Work back from what
  they want to see or decide.

### 4. Shared understanding and the route

Write back the goal, the consumer, the decision, the evidence, the existing components, the
route, the assumptions, the unknowns and what success looks like, and let the person
correct it. The route is Explore, Reporting, Modeling or a combination of them. When it is
Modeling, run the model interview in `references/interview.md` now: its brief becomes part
of the plan.

### 5. Reuse and approaches

Look for an owner in order: an existing question or dashboard, an existing model, an
existing macro, an existing raw entity, a change to one of them, and only then a new
component. When more than one approach is reasonable, compare two or three and lead with
your recommendation. Show the reuse map, with every piece marked `REUSE`, `MODIFY` or `NEW`.

### 6. Approve the plan

Show the plan and ask the person to approve it. Nothing is written before they do
(guardrail 2).

### 7. Write the plan down

Before the first write, save the plan as one file in the person's workspace, or give it in
full in the conversation and say it was not saved. Never claim a file you did not write.

### 8. Carry out the route

One step at a time: say what changes, re-read what may have moved, make the smallest change
after the person's yes to that exact write, read it back, compare with the plan and the
evidence, and only then go on.

- **Explore** ends with findings and a recommended next step. Nothing is saved.
- **Reporting** is drafted and run with `bi.answer` before it is saved with
  `bi.questions.save` or `bi.dashboards.save` (`references/discovery.md`, section 11).
- **A macro** follows `references/macro-patterns.md`.
- **Modeling** follows the model steps below.

### 9. Validate and hand over

Check the meaning, not only the run: what one row is, whether a join multiplied rows, whether
the key is unique, whether missing values stayed missing and currencies were kept apart, and
whether totals reconcile with a bounded read of the raw lake. Then check for duplication: no
concept with two owners, no copied expression, no business logic left in one report.
`references/discovery.md`, sections 12 and 13, list both.

Tell the person what was reused, what changed and what was created, what one row of each new
table means, the tests it passed and what the check could not verify. A report the plan did
not include is a new request: offer `bi.questions.save`, and do not save one unasked.

## The model steps

For the Modeling route, after the plan with its brief is approved and written down.

### M1. Read the data

- Sample the entity with `lake.records` and list the payload keys you see, with an example
  value of each. Show the person the keys the brief needs, and ask about any the brief names
  that the sample does not have.
- For a model over other models, read each with `models.get`, and its columns in its last
  build.

### M2. Draft

Write the model from the brief, following `references/model-patterns.md`. For a saved query,
the same page lists what to change so it can be a model. Call the customer's macros where
they do what the brief needs; an expression another model already repeats is a macro to
propose (guardrail 5), not a second copy.

### M3. Check

Run `models.check` with the name, the SQL and the tests.

- Fix every `error` yourself, and check again. If the same error is still there after three
  tries, stop and show the person the SQL and the finding.
- Keep the `warning` findings and the unverified list for the step after next. Change the SQL
  for a warning only when the brief supports the change.

### M4. Preview

Run `models.preview` with the name and the SQL. dbt compiles the draft in the customer's own
project -- in place of the saved model of that name, or beside the others -- and the answer is a
sample of its rows with `compiled`, the SQL dbt produced. Nothing is saved or built. It runs
the draft against the customer's data, as `lake.query` does: ask the person before the first
one, and keep `limit` small.

- Read the sample for meaning: what one row is, and whether missing values stayed missing.
- Check the grain with `query`, an outer query that reads the model by its own name, such as
  `select count(*), count(distinct deal_id) from stg_deals`. Equal counts mean the key is
  unique; unequal ones are a join that multiplied rows or a key that is not one.
- `BAD_REQUEST` with `reason: "COMPILE_FAILED"` is dbt's account of why the project would not
  compile. A broken saved model fails it too, so read which model it names. Fix the draft and go
  back to M3. `reason: "QUERY_FAILED"` is Postgres's sentence about the compiled SQL or your
  outer query.
- A parent is read as published, which is what a build of this model alone would read. A parent
  that is itself an unsaved draft cannot be previewed with it: save and build it first, with the
  person's yes, or preview each over the saved versions of the others.
- Without the `admin` role or a write grant (above), skip this step and say so in the next.

### M5. Confirm the save

Show the person:

- the model's name, and the table it becomes;
- the SQL, whole;
- the tests, column by column;
- what the preview showed: a few rows and the grain check, or that it was not run and why;
- every warning from the check, with its message, and what you did or did not do about it;
- the check's unverified list, in one line: what only the build can tell.

Ask whether to save it. Changes go back to M2. A change that departs from the approved plan
goes back to the plan.

### M6. Save

Call `models.save` with `create: true`. With the CLI, dry-run it first. On `CONFLICT`, follow
guardrail 8. On success, the model is stored and nothing has run yet: say exactly that.

Offer the brief's grain sentence as the model's `description` -- "one row per HubSpot deal that
has not been deleted" -- and save it only if the person agrees: it is optional, and it is their
words, not a check. Write no `{` or `}` in it; it is refused. Saving a model again without
`description` keeps the one it has, and `null` clears it.

### M7. Confirm the build, then build

Ask whether to build it now, and say that a build replaces the table any report on it reads.
When the change touched several models, or models read from the one you changed, ask once for
the set: `names` takes up to 20, each `name`, `+name` (with everything upstream) or `name+`
(with everything downstream), and builds them as one run. Every name must be a saved model.

On a yes, call `models.build`. It waits for dbt by default, up to about two and a half minutes.
If your host gives up on a tool call sooner, pass `wait: false`: the answer is `waited: false`
with the `runId` at once, and `runs.get` with that `runId` and `waitSeconds` (at most 50 a call)
waits for it instead. Never call `models.build` again to find out how a build went.

A waited answer leads with `stepSummary` (every step counted by kind and status) and lists only
the steps that did not pass. Read those; ask for `steps: "all"` only when the person wants every
step, and page further with `runs.get` on the same `runId` and its `stepCursor`.

- `verdict: "clean"`: the table is built, published (each model step says `promoted: true`)
  and no test of the run failed. Say how many rows each
  model has from `rowCounts` and, for one model, show the first rows from `preview`. A count of
  `null` was not read: say so, never "0 rows". If `parentTestsUnknown` names a parent, say its
  rows went in untested: it has no test record, which is not a pass.
- `verdict: "tests-failing"` (`ok` true, `testsFailed` above 0): the model was built but a test
  found rows that break it, so it was not published (`promoted: false`, `rowCounts` and
  `preview` null): Reports still reads its last passing version, or nothing if it never had
  one, and so does any model built over it in the same run. Do not call it a success. For each
  failing step, read the rows with `dq.failures`, using the build's `runId` and the step's
  id. Show the person the count and a few rows, and ask whether the model or the test is
  wrong. These rows are the customer's data: show them to the person and put them nowhere
  else, the plan file included.
- A test step with status `warn`: a `severity: "warn"` test found rows. It is not in
  `testsFailed` and is not a pass. Read its rows with `dq.failures` the same way and show the
  person the count; it is theirs to decide whether that rule should stop builds.
- `ok` false: the build failed. Show `error`, fix the SQL with the person, and go back to
  M3. A save of the fix is again a save the person agrees to.
- `NOT_FOUND`: a name is not a saved model; the message and `missing` in the details name it.
  Nothing was built. Fix the name, or save the model first.
- `PRECONDITION_FAILED` with `reason: "PARENT_TESTS_FAILING"`: a parent this build reads without
  rebuilding failed its latest tests, and building now would copy those rows. The details name
  the `parent`, its failing `tests` and the `runId`. Nothing was built. Offer the two ways the
  message gives: fix and rebuild the parent, or build with its parents as `+name`, which rebuilds
  and tests them first in the same run.
- `CONFLICT`: a build is already running for this customer, often your own earlier one. The
  details name its `runId` and `startedAt`. Tell the person, and with their yes wait on that run
  with `runs.get` and `waitSeconds`; build again only when it has ended and they ask.

Then return to step 9.
