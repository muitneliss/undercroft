---
name: undercroft-model-builder
description: Guide a person through building an Undercroft dbt model, over its MCP tools or its CLI. Use when a person wants to save a query as a model -- a raw-lake query, a report question's SQL, or SQL they paste -- or to build a model of their own, such as a staging table over one source, a cleaned or joined table, or a table for a dashboard. It interviews the person before writing any SQL, reads the lake instead of guessing, checks the model with models.check, and asks before it saves and again before it builds. Needs the undercroft skill for how to reach the platform.
---

# Build an Undercroft model

A model is one dbt `SELECT` that the platform turns into a table in the customer's own
analytics schema, named after the model. Reports and dashboards read that table. A wrong
model does not fail loudly: it becomes a dashboard that shows a wrong number as if it were a
fact. So this workflow is slow on purpose. Understand first, read the data, check the SQL,
and let the person decide every change.

Read the `undercroft` skill first. It says how to reach the platform (MCP tools or the CLI),
how an operation is named on each door, and what each refusal means. This skill names
operations by procedure path, such as `models.check`.

## Guardrails

These hold for the whole workflow. None of them bends because the person is in a hurry.

1. **No SQL before the brief.** Interview the person and get their agreement on a written
   brief -- purpose, grain, source, columns, filters, name, tests -- before you draft
   anything. `references/interview.md` has the questions.
2. **Never guess the data.** Read entity names from `lake.summary` and payload keys from a
   sample in `lake.records`. A key you have not seen in a sample does not go in the model.
   Never guess a type: cast a column only when every sampled value fits the cast, and
   otherwise keep it as text and tell the person why.
3. **Missing stays missing.** An absent value is `NULL`, never `0`, `''` or a made-up
   default. Use the macros `models.reference` lists, such as the one for reading an amount,
   rather than writing your own cast.
4. **Check before you show.** Run `models.check` on every draft. A finding with severity
   `error` must be fixed before the person sees the draft as ready. Every `warning` is shown
   to the person with its message, and so is the list of what the check could not verify.
5. **The person says yes to the save.** Show the name, the whole SQL and the tests, and ask.
   Save only after a yes to that exact model.
6. **Never overwrite silently.** Save with `create: true`. When the name is taken, the save
   is refused with `CONFLICT`: read the existing model with `models.get`, show the person
   both, and let them choose another name or say, in words, that the existing model named X
   is to be replaced.
7. **The person says yes to the build, separately.** A build replaces the table every report
   on it reads. Ask again before `models.build`, even after the save was agreed.
8. **Never delete.** This workflow does not call `models.delete`, and never removes a report
   or a dashboard. If the person wants a model gone, tell them it is a separate, destructive
   act and let them ask for it on its own.
9. **Stop at a refusal.** `PERMISSION_DENIED`, `WRITES_DISABLED` and `HUMAN_REQUIRED` end the
   workflow. Tell the person what was refused and who can change it. Never work around one,
   for example by running the model's SQL through `lake.query` instead.
10. **Success is the build's answer.** The model exists when `models.build` says `ok` with
    its tests passed. Until then, say what happened, not what you hoped.

## Who can do what

- Anyone who can see the customer may run `models.list`, `models.get`, `models.reference`
  and `models.check`.
- Reading the raw lake (`lake.records`, `lake.querySchema`, `lake.query`) and saving and
  building a model (`models.save`, `models.build`) need the `admin` role.
- Over MCP, `lake.query`, `models.save` and `models.build` need a connection with a write
  grant. With the CLI, they need a profile that allows writes. `lake.query` counts as a
  write even though it only reads, because it runs SQL somebody wrote.

If the person lacks one of these, say so at the start, before the interview. Do not find out
halfway through.

## The workflow

### 1. Find the ground

- Take the tenant from `tenants.list`. If the person has more than one, ask which.
- Read `models.list` for the models that already exist, and `models.reference` for the
  sources and macros every project carries.
- Read `lake.summary` for the sources and entities the lake holds, and how many records
  each has.

### 2. Interview

Work out which of the two entries this is, then follow `references/interview.md`:

- **"Save this query as a model."** The person has SQL already. Ask where it came from --
  a raw-lake query, a report question (read it with `bi.questions.get`), or their own -- and
  what the table should be for. Then run the interview for what the query does not say.
- **"Build me a model."** Start from what the person wants to see or decide, not from
  tables. Work back to the grain, the source and the columns.

Ask a few questions at a time, never a form of twenty. Offer choices when the data offers
them: "the lake has `deals` and `line_items` from HubSpot -- which one is one row of your
table?". Finish by writing the brief back to the person and getting their agreement.

### 3. Read the data

- Sample the entity with `lake.records` and list the payload keys you see, with an example
  value of each. Show the person the keys the brief needs, and ask about any the brief names
  that the sample does not have.
- For a model over other models, read each with `models.get`, and its columns in its last
  build.
- When a question needs a count or a distribution to answer -- how many records have a
  close date, which stages occur -- ask the person before running `lake.query`, and say it
  runs SQL against the raw lake. Keep such queries small, with a `limit`.

### 4. Draft

Write the model from the brief, following `references/model-patterns.md`. For a saved query,
the same page lists what to change so it can be a model.

### 5. Check

Run `models.check` with the name, the SQL and the tests.

- Fix every `error` yourself, and check again. If the same error is still there after three
  tries, stop and show the person the SQL and the finding.
- Keep the `warning` findings and the unverified list for the next step. Change the SQL for
  a warning only when the brief supports the change.

### 6. Confirm the save

Show the person:

- the model's name, and the table it becomes;
- the SQL, whole;
- the tests, column by column;
- every warning from the check, with its message, and what you did or did not do about it;
- the check's unverified list, in one line: what only the build can tell.

Ask whether to save it. Changes go back to step 4.

### 7. Save

Call `models.save` with `create: true`. With the CLI, dry-run it first. On `CONFLICT`, follow
guardrail 6. On success, the model is stored and nothing has run yet: say exactly that.

### 8. Confirm the build, then build

Ask whether to build it now, and say that a build replaces the table any report on it reads.
On a yes, call `models.build` and wait for its answer.

- `ok` true and `testsFailed` 0: the table is built. Show the first rows from `preview`.
- `testsFailed` above 0: the table is built, and a test found rows that break it. For each
  failing step, read the rows with `dq.failures`, using the build's `runId` and the step's
  id. Show the person the count and a few rows, and ask whether the model or the test is
  wrong. These rows are the customer's data: show them to the person and put them nowhere
  else.
- `ok` false: the build failed. Show `error`, fix the SQL with the person, and go back to
  step 5. A save of the fix is again a save the person agrees to.
- `CONFLICT`: a build is already running for this customer. Tell the person; build again
  only when they ask.

### 9. Hand over

Tell the person the model's name, what one row means, the tests it passed and what the
check could not verify. If they want a report on it, that is a new request: offer
`bi.questions.save`, and do not save one unasked.
