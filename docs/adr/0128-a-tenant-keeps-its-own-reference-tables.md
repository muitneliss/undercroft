# 128. A tenant keeps its own reference tables, typed by its author and loaded by the build that reads them

- Status: Accepted
- Date: 2026-10-13
- Builds on: [ADR 0086](0086-a-tenant-writes-its-own-macros.md) (a tenant's authored text lives
  in `app` and is rendered into each build), [ADR 0077](0077-deleting-a-model-drops-what-it-built.md)
  (a delete drops what it built, or nothing),
  [ADR 0127](0127-lists-answer-summaries-and-the-server-hashes-what-it-stores.md) (the server
  hashes what it stores, and an identical save writes nothing) and
  [ADR 0130](0130-a-rule-about-a-models-rows-is-a-test-of-that-model.md) (a test may name another
  node with `ref()`).

## Context

Issue 446. A tenant that needed a small table kept by hand -- accounts mapped to groups, the
people a reviewer listed with the role each was given, a dictionary of patterns -- had one place
to put it: inside a model's SQL, as a `VALUES` list. In the audit of MCP calls behind issues 444
and 445, 368 of 655 `models.save` calls carried a `VALUES` list, and those lists were 9.1 M of
the 11.5 M characters the calls sent. One changed row meant sending the whole model again, and
reading the model meant reading the table. Every model that needed the same mapping carried its
own copy, and the copies drifted.

dbt has the feature for this: a **seed**, a CSV file in the project that `dbt build` loads into
a table, which models read with `ref('name')` like another model
(<https://docs.getdbt.com/docs/build/seeds>). Its loader is the hard part. Left to itself it
infers each column's type from the cells, reads several spellings as NULL, and translates line
endings, each without a word.

## Decision

**A tenant owns seeds, in `app.seed`** (tenant, name, `columns`, `rows`, who saved, when), in
`app` for the reason `app.model` and `app.macro` are there: a cell is text a person wrote and may
name people, and neither the BI role nor any dbt role has USAGE on `app`. Postgres is the only
copy. The worker renders every seed of the tenant into the throwaway project of each build, as
`seeds/<name>.csv` under `seed-paths: ["seeds"]`
(<https://docs.getdbt.com/reference/project-configs/seed-paths>), and removes it with the
directory. `undercroft_app` has all four verbs on the table and `undercroft_worker` SELECT
(`540_seeds.sql`). The table dbt loads lives in `analytics_<slug>`, owned by the tenant's dbt
login, and the BI role reads it by the default privileges every model's table already has, so
no grant is added for it.

**Types are declared, never inferred.** Each column is `{ name, type }`, `type` one of seven:
`text`, `integer`, `bigint`, `numeric(18,4)`, `boolean`, `date`, `timestamptz`. Each is a type
whose text form the platform can check exactly before dbt sees it, and `numeric(18,4)` is the
platform's one money type. A cell is a string or `null`, never a JSON number: an amount is the
string it was written as, all the way into `numeric(18,4)` (`.claude/rules/money.md`). **`null`
means NULL** in every column.

**Every cell is validated against its column's type at save**, and a table with one bad cell is
refused whole (`seedRefusal`, `packages/contracts/src/seeds.ts`, the one place the rules live).
`integer` and `bigint` are plain integers in range with no leading zero; `numeric(18,4)` a plain
decimal of at most 14 integer and 4 fraction digits, checked as text and never through a float,
because a fifth decimal would be rounded away; `boolean` is `true` or `false`; `date` a real
calendar day as `YYYY-MM-DD`; `timestamptz` an ISO timestamp with an explicit offset or `Z`,
because one without would be read in the session's time zone, which is a guess.

**What dbt's loader would change is refused, not worked around.** Every column carries a
`column_types` entry (<https://docs.getdbt.com/reference/resource-configs/column_types>), so dbt
forces each one to agate's `Text` and Postgres casts the text into the declared type on insert:
`load_agate_table` passes the seed's `column_types` to `from_csv` as `text_columns`, and
`build_type_tester` forces every one of them to `Text(null_values=("null", ""))`
([dbt-core 1.9 `context/providers.py`](https://github.com/dbt-labs/dbt-core/blob/1.9.latest/core/dbt/context/providers.py),
[dbt-common `clients/agate_helper.py`](https://github.com/dbt-labs/dbt-common/blob/main/dbt_common/clients/agate_helper.py)).
Four things happen on that path:

- **A text cell that would read as NULL is refused, as `reads-as-null`.** agate's `Text.cast`
  returns `None` for a value that, stripped by Python's `str.strip` and lower-cased, is one of
  those null values
  ([agate `data_types/text.py`](https://github.com/wireservice/agate/blob/master/agate/data_types/text.py)).
  So an empty cell, one of only whitespace, and `null`, `NULL` or `Null` all load as NULL, and
  a CSV cannot say "the empty string" to it. Storing such a cell would mean the table a
  dashboard reads differs from the table the author saved. The author sends `null` for a
  missing value, which renders as the empty field and loads as NULL -- what they meant.
- **A carriage return is refused.** `from_csv` opens the file with `open(abspath,
encoding="utf-8")`, Python's universal-newline mode, so a `\r` inside a quoted field reaches
  the table as `\n`.
- **A NUL and a lone UTF-16 surrogate are refused**: Postgres text cannot hold the first, and the
  second cannot be written as UTF-8 at all.
- **A cell longer than 131,072 characters is refused**: that is Python's
  `csv.field_size_limit()` default, which neither dbt nor agate raises, so a longer field fails
  the load.

**Bounds.** At most 10,000 rows, 100 columns, and 1 MB as the JSON the columns and rows are
stored as. A seed is a reference table, not a data file; larger data is landed in the raw lake.

**A refusal is `BAD_REQUEST`, worded in Vietnamese first and English second, naming the cell as
facts**: `reason` the problem's code, `row` the index into `rows` from 0, `column` the declared
column's name, so a script that wrote the table can point at the cell without parsing the
sentence. The sentence says what to send instead.

**Hashed in SQL, and an identical save writes nothing**, as ADR 0127 has it for models. A seed's
content is its columns and rows together, so it carries one `sha256`: hex SHA-256 of
`jsonb_build_array(columns, rows)::text`, as Postgres prints it, computed where it is stored. It
is compared with a hash the server gave before, never with one of a local file. A save of the
stored columns and rows answers `{ ok: true, unchanged: true }`, touches neither `updated_at` nor
`updated_by`, and writes no audit row; the upsert's own `WHERE ... IS DISTINCT FROM` decides it.
`seeds` is a part of `models.revision`, `[name, sha256]` per seed.

**The audit row names the seed and who saved it, never a cell.** The cells are in the table.

**The file is RFC 4180 as Python's reader takes it** (`seedCsv`): a header of the column names,
then one line per row, every value quoted with a quote doubled, so nothing in a value is read as
syntax; `null` alone is the empty unquoted field. Lines end in `\n`, with no byte-order mark. It
is not `@undercroft/contracts/csv`: that encoder writes a file for a person to open in a
spreadsheet and puts a quote before text that starts like a formula, which here would change the
value dbt loads.

**`dbt_project.yml` carries the seeds' configuration.** `+quote_columns: true` for every seed, so
a column called `order` stays a column
(<https://docs.getdbt.com/reference/resource-configs/quote_columns>), and under each seed its
`+column_types`, one entry per column. dbt loads an existing seed table by truncating it and
inserting the file's rows (`default__reset_csv_table`,
[dbt-adapters `materializations/seeds/helpers.sql`](https://github.com/dbt-labs/dbt-adapters/blob/main/dbt-adapters/src/dbt/include/global_project/macros/materializations/seeds/helpers.sql)).
That is right while the standing table has exactly the declared columns and wrong the moment it
does not: an added column fails the insert, a removed one stays as NULLs, and a changed type
casts every cell into the old type. So before the build the worker reads the standing table as
the tenant's dbt login, and a seed whose columns differ in name, order or type gets
`+full_refresh: true`, which makes dbt drop the table `cascade` and create it again from the
declaration (<https://docs.getdbt.com/reference/resource-configs/full_refresh>,
`should_full_refresh` in dbt-adapters' `materializations/configs.sql`). It is set only then
(`seedLoad.ts`), because the cascade also drops a view another model built over the table.

**A build loads the seeds its selection reaches.** dbt does not add a model's parents to a
selection, so a build of `stg_deals` alone would read whatever its seed's table held, or none.
Each selector brings its seeds through dbt's own graph, as one more value after the same
`--select`, which dbt unions
(<https://docs.getdbt.com/reference/node-selection/set-operators>): `name` brings
`1+name,resource_type:seed`, `+name` brings `+name,resource_type:seed`, and `name+` brings
`@name,resource_type:seed`, the seeds above anything it builds. `,` is dbt's intersection, `n+`
its depth and `@` its "ancestors of all descendants" operator
(<https://docs.getdbt.com/reference/node-selection/graph-operators>), and `resource_type` its
method (<https://docs.getdbt.com/reference/node-selection/methods>). A tenant with no seeds gets
none of these, since a `resource_type:seed` that matches nothing is a warning in dbt's log. A
build with no selection is the whole project, every seed included. **A tenant with seeds and no
models still builds**; only one with neither spawns nothing.

**A seed load is a step in the ledger, and a failed one fails the run.** `run_results.json`
reports each load as a node of its own, `seed.undercroft.<name>`, with status `success` or
`error` (<https://docs.getdbt.com/reference/artifacts/run-results-json>). `parseRunResults` keeps
it as a step of kind `seed`; migration `550_run_step_seed.sql` widens `ops.run_step.kind` to
admit it, and `runs.get`'s `stepKind` filter takes it. A seed in error is the build's error, in
dbt's words: the models reading it were skipped, or would have read what the last load left.

**A name is a model's or a seed's, never both, refused either way round.** Both are what
`ref('name')` reads and both are relations of `analytics_<slug>`; dbt refuses a project holding
the two, so every build of the tenant would fail. `seeds.save` and `models.save` each answer
`CONFLICT` for the other's name.

**Every reader of `ref()` knows seeds.** `models.check` and `macros.check` take a seed's name as
a `ref()` they know, and a seed's table named bare is read around dbt exactly as a model's is.
`checkTests` counts seeds among what `relationships.to` and a SQL test's `ref()` may name (ADR
0130). `models.lineage` has a node kind `seed`, present whether or not anything reads it, with
edges to the models that `ref()` it.

**Delete refuses while a model reads the seed**: by `ref()` in its own text or through a macro
it calls, as the lineage reads it, or in one of its tests, a `relationships` to the seed or a SQL
test that `ref()`s it, as `checkTests` reads them. It answers `CONFLICT` naming the models: dbt
compiles every model and test with the project, so either would fail the tenant's next build.
Otherwise the seed's table is dropped through the worker as the tenant's dbt login, under ADR
0077's refusals (no build running, nothing outside reading it), and only then is the row removed,
in one statement that removes nothing while a build runs. Without a worker nothing is deleted.

**Procedures**: `seeds.list` (names or `match`; name, column and row counts, `sha256`, who and
when, no cells) and `seeds.get` (the columns and every row) for any member; `seeds.save` (admin,
a `write`, `create` refusing a taken name with `CONFLICT`) and `seeds.delete` (admin,
`destructive`). Saves and deletes are audited as `seeds.save` and `seeds.delete`. The assistant
is given none of them, as it has no `macros.save`. The web UI shows seeds read-only.

## Consequences

- A mapping is kept once and read by every model that needs it; changing a row sends that
  table, not a model. The model-builder skill recommends a seed over an inline `VALUES` list.
- A table that dbt would load differently from how it was saved cannot be stored, so the save is
  where its author hears about it, in words that name the cell -- not a dashboard, later, as a
  NULL or a rounded figure.
- An empty string cannot be a seed's value. A text column that needs one keeps NULL, which is
  what a reader of a hand-kept table almost always meant by an empty cell anyway.
- Changing a seed's columns drops its table at the next build that loads it, and a view another
  model built over that table with it. The view comes back when that model builds.
- A seed loaded by a build of one model reloads a table every other reader of the seed sees at
  once: the seed is one table, as a model is.
- The loaded table is as readable by the tenant's BI role as a model's. A seed that names
  people puts them one question from a dashboard, exactly as the `VALUES` list it replaces did;
  dbt's own guidance keeps sensitive data out of seeds, and the stored copy stays in `app`.
- The guard in `delete` is read from text, as a macro's is (ADR 0086): a model saved with a
  `ref()` to the seed in the instant it is deleted is not caught, and fails its next build with
  dbt's own "not found".

## Options rejected

- **Inline `VALUES`, the status quo.** It is what the measurement above shows: most of what
  agents send is tables carried inside models, copied into each model that needs them, and
  resent whole for one changed row.
- **Landing a CSV as a raw-lake document and reading it through `raw.document_rows`.** It works
  today, but it is heavyweight for a table a person edits -- a land, an extraction and a
  projection for each edit -- and the raw lake is for data from outside, kept immutably. A
  hand-kept mapping is configuration, and an edit to it is not a new fact to keep forever.
- **Inferring types, as dbt does by default.** It is a guess (rule 2): a code `007` becomes `7`,
  a column of amounts becomes whatever the first cells look like, and an edit to one cell can
  change the type of the whole column.
- **Seeds as files in a git repository.** The platform has no repository of the tenant's
  project; its project is rendered from Postgres for each build, and a second home for the
  tenant's authored content would drift from the first.
- **Coercing a bad cell** -- trimming, rounding, reading `1,234` as a number. Each is a value the
  author did not write, stored without a word.
- **Accepting an empty text cell as the empty string.** dbt reads it as NULL, so storing it would
  mean the table loaded differs from the table saved; the only honest answers are to refuse it or
  to call it NULL, and silently calling it NULL is the guess this ADR exists to avoid.
- **Edit patches to `models.save`**, the issue's smaller alternative: send only the changed lines
  of a model. It shrinks the calls but keeps the table inside the model and copied into each one
  that needs it. It is left for a separate change.

## Follow-ups

- **CSV input to `seeds.save`.** This change takes `columns` and `rows` only; a CSV parsed on the
  server would have to make the same refusals and would need its own decision about dialects.
- **Editing seeds in the web UI.** It shows them read-only; they are written through the CLI, MCP
  or an agent following the model-builder skill.
