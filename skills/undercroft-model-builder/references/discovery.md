# Discovery

A person who asks for a model usually wants an answer, and does not yet know which layer
should give it. It may already be on a dashboard. It may be one question over a model the
tenant already has, one column added to an existing model, a macro, or nothing more than a
look at the data. A new model is one possible result of this page, not its purpose.

The best result is the smallest change that answers the person's real question, with
evidence behind it. Ending with "the existing model already answers this; here is a
question over it" is a success, not a failure to build.

This page owns everything from the first read to the approved plan, and how the plan is
carried out and checked. `references/interview.md` takes over for the model's own brief once
Modeling is the route.

## 1. Reconnaissance

Read the tenant before you ask the person anything detailed. The point is to give the
interview real choices: "this tenant has Xero invoices and HubSpot deals" is a question a
person can answer; "which source do you want?" is not.

Read all seven, once, at the start. The lists answer summaries -- names, kinds, hashes and
counts, never an item's body -- so reading all seven is cheap; take a body from `get`, or ask a
list for it with `include`, only for the items that bear on the request.

| Read                 | What it tells you                                                                   |
| -------------------- | ----------------------------------------------------------------------------------- |
| `models.list`        | The models that exist, each with its last build and how many columns it found.      |
| `macros.list`        | The customer's own macros, what each is for and its parameters; no definitions.     |
| `seeds.list`         | The customer's reference tables (seeds): columns and rows counted, no cells.        |
| `models.reference`   | The sources a model can read and the platform's macros: `parts`, once (see below).  |
| `lake.summary`       | The sources and entities the lake holds, how many records each, how fresh.          |
| `bi.questions.list`  | The saved questions: kind and chart type. `include: ["definition"]` for the models. |
| `bi.dashboards.list` | The dashboards, and which questions sit on each.                                    |

`models.reference` returns three parts: `sources` and `platformMacros`, which are the same on
every call, and `tenantMacros`, the customer's own with their text. Read it whole once, or
with `parts`; after that, `macros.list` and `macros.get` are the cheaper way to the tenant's
macros. Every list takes `names` (exactly these) and `match` (a fragment of the name,
case-insensitive); a name that is not there is refused as `NOT_FOUND`, naming it.

A tenant with many models, macros or questions answers more than one result holds: over MCP a
list is cut at 50 items and says so. Then page: `models.list`, `macros.list` and
`bi.questions.list` take `limit` and `cursor`, and answer `{ items, nextCursor }`. Ask again with
`cursor: nextCursor` and the same filters until `nextCursor` is `null`; the inventory is not
whole before then. A cursor refused as `unknown-cursor` means the list changed under you: start
again from the first page.

Do not paste what they return. Write the person a short inventory of what bears on the
request, and keep the rest to yourself:

```text
Sources:     xero (invoices, contacts, payments), hubspot (deals, companies)
Models:      stg_xero_invoices, fct_revenue, dim_customer, and 9 more
Macros:      parse_amount (platform), normalise_company_name (tenant)
Seeds:       account_groups (3 columns, 40 rows)
Questions:   Monthly revenue (reads fct_revenue), Deals by stage (reads stg_hubspot_deals)
Dashboards:  Finance overview (3 questions)
```

Read these when the request touches them:

- `models.get` for a model that might already own the concept: its SQL, its tests, the
  columns of its last build. `models.list` with `include: ["columns"]` gives the columns of
  every build at once, when you are comparing several.
- `models.lineage` before you propose to change a model, or to build one beside it: the
  models that `ref` it read what it builds, and a second model over the same entity is
  often the first sign of a duplicate. Name the model: `name` with `direction: "down"` for
  what reads it, `"up"` for what it reads, and `depth` to stop after a few steps. The whole
  graph of a large tenant will not fit in your context; when even the part around a model is
  cut, page it with `limit` and `cursor`, which answers `{ nodes, edges, nextCursor }`.
- `macros.get` when a macro's description leaves you unsure what it returns.
- `seeds.get` for a reference table that might already hold the mapping the request needs:
  its columns with their declared types, and every row.
- `bi.questions.get` and `bi.dashboards.get` for a report that might already answer the
  request, or that the request would change.
- `bi.schema` for the columns a report can read in each built model. Pass `tables` with the
  models you are weighing, or `match` with a fragment of their names; `columns: false` lists
  the names alone. A table you name that is not built is refused as `NOT_FOUND`, naming it.
- `lake.records` for a sample of an entity's payloads, and `lake.documents` for the files
  and attachments a source landed.
- `lake.querySchema` and `lake.query` for a count or a distribution (section 3). Narrow
  `lake.querySchema` with `tables` the way you narrow `bi.schema`.

### Is what you read still current?

A session that read the tenant an hour ago, or keeps the customer's SQL in a repository, does
not need to read it all again to know whether it changed.

- `models.revision` answers one hash each for the models, the macros, the seeds and the
  questions, and one over all four. Equal to the one you kept means nothing a save writes has
  changed since; different means something did, and the part that moved says which kind. Read
  it before a plan you made earlier is carried out, and again before each save if time has
  passed.
- Each model carries `sqlSha256` and `testsSha256`, each macro `sqlSha256` and
  `descriptionSha256`, each question `definitionSha256` and each seed `sha256`, on the list and
  on `get`. A `*Sha256` of text (a model's or a macro's SQL, a description) is the SHA-256 of
  its UTF-8 bytes: hash your local file the same way, and equal means the server holds exactly
  your text, with no need to fetch it. `testsSha256`, `definitionSha256` and a seed's `sha256`
  are of the JSON as the server stores it, which you cannot reproduce: compare them only with a
  hash the server gave you before.
- Saving a model, a macro or a seed with exactly what is stored answers `unchanged: true` and
  changes nothing, `updatedAt` included. It is safe, but it is not a write: do not report it as
  one.

## 2. The interview: the outcome before the implementation

Find out five things, in the person's words: the outcome they want, who uses it, the
decision or action it supports, what success looks like, and the constraints. When the
request already says one, write it back rather than ask it again.

- **One question at a time.** Ask the one question whose answer changes the most, wait,
  and let the answer choose the next. Never send a form.
- **Ground each question in what you read.** Offer choices the tenant actually has: "Are
  you measuring revenue as Xero invoices billed, HubSpot deals won, or comparing the two?"
  The person may always answer outside the choices.
- **Start from the outcome.** What are you trying to understand, decide, monitor or
  produce? Who will read it, and what will they do next? Is it a one-off look or something
  that runs every week? What would make the answer clearly wrong?
- **Not from the implementation.** A model's name, its SQL, its tables and how dbt
  materialises it are decided later, from the answers. Never open with them.
- **Ask the person for meaning, ask the data for facts.** Which statuses count as "paid"
  is the person's to say. Which statuses occur is the lake's: read it (section 3), then ask
  about what you found. Never ask the person what a read can tell you, and never guess what
  only they can.

### How to ask

Every decision the person makes in this workflow -- the next interview question, the route,
the approach, the plan, each save and each build -- is asked the same way.

- **Through the host's question tool, when it has one.** Claude Code's `AskUserQuestion`,
  for one, shows the choices as options the person picks, and always leaves them a box to
  answer in their own words. Use it rather than a numbered list at the end of a long
  message, where the question is easy to miss and has to be answered by typing.
- **The evidence in the message, the decision in the tool.** Write the inventory, the
  findings, the plan or the SQL as text first. The tool carries only the question and short
  options, each with a line on what it means; it is not a place for tables or code.
- **One question per call**, though a tool may take several. The next question depends on
  this answer.
- **Two to four options, drawn from what you read**, the one you recommend first and marked
  as recommended. Do not add an "other" option: the person can always write their own.
- **A gate is an explicit choice.** For the plan, a save or a build, the options name the
  act -- "Approve this plan", "Save `stg_xero_contacts`", "Build it now" -- beside one to
  change something and one to stop. A dismissed or unanswered question is not a yes.
- **Without such a tool** -- over MCP in a chat host, say, or when the tool is refused --
  ask the same single question in text, with the options numbered, and wait for the answer.

## 3. Read the evidence

Never guess the data. That covers source and entity names, payload keys, workbook headers,
types, identifiers, status values, currencies, date formats, relationships, cardinality and
which copy of a duplicate wins. `lake.summary` gives the names; a sample from `lake.records`
gives the keys. A key you have not seen in a sample is a question, not a column.

When a fact about the data changes the design, answer it with the smallest read that can.
`lake.query` runs SQL against the raw lake, so ask the person before you run one and say
that. Keep each small, with a `limit`. Typical questions, written as `lake.query` reads them
-- they name raw tables directly, which a model may not, so none of them is a model:

```pgsql
-- Which values occur, before the design filters on one.
select payload ->> 'Status' as status, count(*) as records
from raw.records
where source = 'xero' and entity = 'invoices' and deleted_at is null
group by 1
order by 2 desc
```

```pgsql
-- Is the key one row, and how often is it missing?
select count(*)                                           as records,
       count(distinct payload ->> 'InvoiceNumber')        as distinct_numbers,
       count(*) filter (where payload ->> 'InvoiceNumber' is null) as missing
from raw.records
where source = 'xero' and entity = 'invoices' and deleted_at is null
```

```pgsql
-- Which currencies, before anything is summed.
select payload ->> 'CurrencyCode' as currency, count(*) as records
from raw.records
where source = 'xero' and entity = 'invoices' and deleted_at is null
group by 1
```

The same goes for a join key before you assume one-to-one, and for a date's form before you
choose how to read it. Over the models rather than the lake, `bi.answer` runs SQL against the
built tables by their bare names.

A query written to look at the data stays a look. It is never saved as a model or a question
because it was written; persisting it is a decision the plan makes.

**A workbook or a document.** When the request depends on Excel, CSV or another document,
read what actually landed before anything is designed: which document, its sheets and their
names, whether each is visible, the row numbers, where the header sits, a few data rows, the
`formats` and `faults` of the cells, whether the sheet is `complete`, any refusal, and the
merged ranges where they matter. Row 1 is not assumed to be the header, column A is not
assumed to be a date, numeric text is not assumed to be an amount, hidden rows and totals are
not assumed to be ignorable, and two clients' workbooks are not assumed to share a layout.
`references/model-patterns.md` says how each is read.

## 4. Classify the need

Once the evidence and the answers allow, name the route. Include only the stages the
request actually needs. Say the route and why out loud, so the person can overrule it, and
when a later finding shows the route was too small -- a report that turns out to need a
definition no model owns -- stop, say so, and show the changed plan.

- **Explore.** The person is still learning the data or testing an idea: "what do we have
  for customer profitability?", "can Xero contacts be matched to HubSpot companies?", "why
  do these two totals disagree?". Stay read-only, run bounded reads, and return findings
  with a recommended next step. Nothing is saved to make progress look real.
- **Reporting.** The meaning the person needs is already in a model: a KPI, a chart, a
  question, a dashboard, a different grouping or filter. Keep the question thin -- pick,
  filter, group and sort one model -- and look at the existing questions and dashboards
  before adding another.
- **Modeling.** A reusable meaning is missing: cleaning one entity, deduplicating, a fact
  or a dimension several reports need, a join more than one question would repeat, a
  definition that must have one owner. Continue with `references/interview.md` for the
  brief.
- **A combination.** Explore, then Report. Explore, then Model, then Report. Model, then
  Report. Each stage only when it is needed.

## 5. Reuse before you create

Look for an owner in this order, and stop at the first that correctly owns the logic:

```text
an existing question or dashboard
    -> an existing model
    -> an existing macro
    -> an existing seed
    -> an existing raw entity
    -> a change to an existing component
    -> a new component
```

It is an order to search in, not a rule that a report always wins. Choose the lowest layer
that should own the logic:

- another grouping or filter over a model that already means the right thing: a question;
- a business definition that more than one report needs: a model;
- an expression repeated across models: a macro;
- a table a person keeps by hand, such as accounts mapped to groups: a seed, read with
  `ref()`, never a `VALUES` list inside a model;
- the data is not understood yet: Explore;
- an existing model already answers it: reuse it, and say so.

**One concept, one owner.** A definition -- what counts as revenue, which invoices are
overdue, who a customer is -- lives in one model, and every report reads it there. A filter
that decides what a metric means, copied into each question, is a definition with as many
owners as copies: when one changes, the dashboards disagree.

Before you propose anything new, answer in one sentence: **why can the existing components
not satisfy this?** If you cannot, the proposal is the wrong one.

A project that grew one request at a time shows the same signs. Look for them in the
inventory, and do not add to them:

- the same business filter written into several questions instead of one model column;
- a hand-kept list of models copied into more than one question;
- many more models than reports read, or a model that only one question reads and that
  only renames or filters another model;
- a cluster of models around one concept with overlapping grains, so nobody can say which
  one is authoritative;
- a formula copied into many models before it became a macro;
- a `VALUES` list of a hand-kept table inside a model's SQL, or the same list in several
  models, where one seed would be read by each.

When one bears on the request, tell the person. Do not fix it unasked: that is its own plan.

## 6. Shared understanding

Before you propose anything, write this back and let the person correct it. Keep observed
facts and assumptions apart; a sentence that is both is the kind that becomes a wrong number.

```text
Goal:          what the person is trying to accomplish
Consumer:      who uses the result
Decision:      what they will decide or do with it
Evidence:      what was actually read -- entities, keys, counts, distributions
Existing:      the models, macros, questions, dashboards and raw entities that bear on it
Route:         Explore | Reporting | Modeling | a combination, and why
Assumptions:   what is believed but was not observed
Unknowns:      what is still open, and who can close it
Success:       how the person will know the result is right and useful
```

## 7. Compare approaches

When more than one approach is reasonable, propose two or three, lead with the one you
recommend, and say why. When only one is reasonable, say so and do not invent rivals. For
each, state what changes, what is reused, what is new, how complex it is, what it does to
the existing reports and models, how it will be maintained, and its downside.

```text
A  Reuse fct_revenue, add one question                     <- recommended
   Changes: nothing existing. New: one question.
   Downside: none found; fct_revenue already has month and customer.

B  Add a column to fct_revenue
   Only if the question needs a field fct_revenue lacks at its own grain.
   Impact: every report on fct_revenue sees the new column after the next build.

C  New model int_monthly_revenue
   Only if a new reusable relation is needed. Here it would be a second owner of revenue.
```

The smallest correct design wins. A component nobody needs yet is not built.

## 8. The reuse map

Before the plan is approved, show where every piece comes from, so a duplicate is visible:

```text
raw: xero invoices        [REUSE]
    |
parse_amount()            [REUSE macro]
    |
stg_xero_invoices         [REUSE model]
    |
fct_revenue               [REUSE model]
    |
Monthly revenue by customer   [NEW question]
    |
Finance overview          [MODIFY dashboard: one tile added]
```

Every item is `REUSE`, `MODIFY` or `NEW`. Each `NEW` carries its one-sentence reason from
section 5.

## 9. The plan, and the gate

The plan is the shared understanding, the chosen approach, the reuse map, and for each
component what will be written and how it will be checked. Show it and ask the person to
approve it.

**Until the person explicitly approves the plan, nothing is written.** Not a model, a macro,
a question or a dashboard, whether new or an overwrite; no build; no change of
configuration; no delete. Before the approval you may list and read the tenant, sample and
query the lake (with the person's yes for `lake.query`), read lineage, draft designs,
compare approaches, and prepare the plan.

The approval covers the plan you showed, and nothing after it. A plan that changes is shown
again. And approving the plan is not approving each write: every save still shows exactly
what it will write and waits for a yes to that, and a model's build waits for its own yes
(the guardrails in `SKILL.md`).

## 10. Write the plan down

After the approval and before the first write, write the plan to one file in the person's
workspace, when there is one you can write to:

1. where their project already keeps plans or docs;
2. where the person says;
3. otherwise `docs/undercroft/<YYYY-MM-DD>-<topic>-plan.md`.

If you cannot write a file, give the whole plan in the conversation and say plainly that it
was not saved. Never say a file exists that you did not write.

One file, with these sections; a section that does not apply says so in a line:

1. Goal
2. Business question
3. Consumer and decision
4. Data inventory
5. Raw evidence
6. Existing components
7. Reuse map
8. Selected approach, and the ones rejected
9. Components to reuse
10. Components to modify
11. Components to create
12. Model grain and brief, if any
13. Question or dashboard definition, if any
14. Macro changes, if any
15. Configuration changes, if any
16. Validation plan
17. Execution steps
18. Risks and how to undo each step
19. Acceptance criteria

Record evidence as shapes, keys, counts and distributions, never as copied rows: the
records are the customer's data, and this file may end up in a repository. Write another
file only when the plan needs one -- a model's SQL or a macro's definition the person keeps
in their own project, say. No placeholder files.

## 11. Carry it out, one step at a time

For each step of the plan:

1. Say what this step changes.
2. Read the component again if it may have changed since you planned.
3. Make the smallest change the plan approved, after the person's yes to that exact write.
4. Read it back: `models.check`, `macros.check`, `bi.compile` or `bi.answer`, or a get.
5. Compare the result with the plan and with the raw evidence.
6. If the design had to change, update the plan file and show the person the change.
7. Go on only when this step is right.

Never batch changes the plan did not name.

**Explore.** Answer with what was found, what it means, what stays unknown, and the next
step you recommend. Nothing is saved; the route can end here.

**Reporting.** Draft the question's definition and run it with `bi.answer` before anyone
saves it; render a visual definition's SQL with `bi.compile`. Show the person the name, the
definition, the chart and the first rows, and save it with `bi.questions.save` after their
yes. A new question or dashboard is saved without an `id`. Saving with an `id` replaces that
question or dashboard whole, so read it first with `bi.questions.get` or
`bi.dashboards.get`, change only what the plan says, and show the person what changes. A
dashboard's layout is its whole list of tiles: to add one, send every existing tile and the
new one, because a tile left out is a tile removed.

**Modeling.** Follow the model steps in `SKILL.md`, from the brief in the plan.

**A macro.** Follow `references/macro-patterns.md`.

## 12. Validate the meaning, not only the run

A build that says `ok` and a question that returns rows prove the SQL ran. Before you hand
over, answer each of these that applies:

- Does one row mean what the plan says one row means?
- Did a join multiply rows? Compare counts before and after it.
- Is the key unique where the plan says it is? The `unique` test, or a count.
- Are records deleted at the source left out, or kept on purpose?
- Is a missing value still `NULL`, never `0` or `''`?
- Is every amount read with the amount macro, and are currencies never added together?
- Is every date read in the form the data showed?
- Do the result's totals reconcile with a bounded total over the raw lake, where they should?
- Did the result reuse the definitions the plan said it would?
- Does the report answer the question the person actually asked?

## 13. Before you say it is done

Check for duplication once more, now that it exists:

- Does an existing model now overlap the new one?
- Is the same business concept defined in two places?
- Was an expression copied where a macro should have been called or proposed?
- Was a hand-kept table written into a model as `VALUES` where a seed should have been read
  or proposed?
- Did business logic that other reports need end up inside one question?
- Was a model created for one report when a question over an existing model would do?
- Is it obvious which component is authoritative for the concept?
- Is every new component justified by a reusable responsibility nothing else had?

If a duplicate was introduced, resolve it with the person before you call the work done.

## Worked examples

The tenants below are invented.

**"Create another model for monthly revenue."** The inventory shows `fct_revenue`, one row
per invoice line with month, customer and an amount read with `parse_amount`, and a question
over it. One question first: "what will the monthly figure be used for, and does revenue
mean billed invoices here, or cash received?" Billed, for a board pack. `fct_revenue`
already owns billed revenue, so the plan is approach A above: one new question over it,
added to the finance dashboard. No model is written, and that is the right outcome.

**"I need overdue invoices by customer in a dashboard."** The lake has Xero invoices and
contacts; the tenant has `stg_xero_invoices` with a due date and an amount due, and
`dim_customer`. A sample shows the statuses that occur, and a read shows some invoices with
no due date. One question: "should an invoice with no due date count as overdue, not due, or
its own group?" The route is Reporting: a question over `stg_xero_invoices` joined to
`dim_customer`, with the no-due-date group named rather than hidden. Had "overdue" been a
definition three questions repeat, the route would add one column to the staging model
instead, so it has one owner.

**"What can we build with the data in this tenant?"** Explore. Give the inventory, ask which
business area or decision matters most, run a few bounded reads there, and return what the
data can and cannot support, with a recommended first step. Nothing is saved.

**"Save this SQL as a model."** Ask where the SQL came from and what will read the result.
If only one dashboard tile needs it and it reads one existing model, it is a question, and
the plan says so. If it defines something several reports need, it becomes a model through
the brief, the check, the save and the build.

**"Build a model from this Excel source."** Read the sheets and rows that landed first: the
sample shows two title rows above the header, dates typed as text in one column, and a
totals row. Ask the person which date form the text is in and whether totals are left out,
then continue with the brief. Nothing about the layout is taken from convention.
