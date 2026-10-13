# 130. A rule about a model's rows is a test of that model, not a model of its own

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0005](0005-the-role-and-grant-model.md) (failing rows are stored in `dq_<slug>`, which BI cannot read),
  [ADR 0127](0127-lists-answer-summaries-and-the-server-hashes-what-it-stores.md) (the server hashes what it stores, and an identical save writes nothing)

## Context

Issue 458. A model could declare two tests per column, `not_null` and `unique`, and nothing
else. Every other business rule -- a status is one of a known set, a payment points at an
invoice that exists, a total equals the sum of its lines, a date is not after another -- became
a **check model**: an extra `chk_*` table that counts violations, with a `not_null` or `unique`
arranged so a violation produces a NULL or a duplicate. One tenant had about 25. They grew the
model count, showed up in lineage and in `bi.schema` as if they were business tables, and
invited questions to read them.

## Decision

**`ModelTests` declares the rule where it belongs.** In `packages/contracts/src/models.ts`:

- A column test is a bare kind -- `"not_null"`, `"unique"`, the short form every row stored
  before this ADR is in -- or an object naming its kind: `not_null`, `unique`,
  `accepted_values` with `values` (strings, 1 to 100, no brace or control character, and with
  `quote: false` each a plain decimal) and `relationships` with `to` (a model name; a seed once
  seeds land, since `ref()` reaches both) and `field`. A column takes each kind once.
- A model takes `sql`, a list of SQL tests `{ name, sql }`: a SELECT returning the rows that
  break the rule. A name is lowercase words joined by single underscores, never `__`, and
  unique within the model.
- Every test takes `severity: "error" | "warn"`; `error` is dbt's default.
- The schema is strict: an unknown kind or key is refused, never dropped.

No migration. The old shape is the short form, so every stored row parses unchanged and keeps
its `testsSha256`. `canonicalTests` gives one spelling to one meaning before a save stores it --
`{"kind": "not_null"}` is `"not_null"`, `severity: "error"` is no severity, no SQL tests is no
`sql` key -- so ADR 0127's no-op save and its hashes hold for the new shapes.

**Rendering, in dbt 1.9's syntax** (`dbtProject.ts`). Column tests go in `models/schema.yml`
with their arguments as the test's own top-level properties and severity under `config:`. The
`arguments:` property is dbt 1.10.5's, and 1.9 would read it as one argument named `arguments`
(<https://docs.getdbt.com/reference/resource-properties/data-tests>). `relationships.to` is
written `ref('<model>')`. An accepted value is a YAML string with its single quotes doubled,
because dbt's `accepted_values` puts each value inside `'...'` without escaping it. A SQL test
is written to `tests/<model>__<name>.sql` (with `test-paths: ["tests"]`) as a dbt singular
test. A warn test starts with `{{ config(severity = 'warn') }}`, the one config its text is
given (<https://docs.getdbt.com/reference/resource-configs/severity>). Its failing rows land in
`dq_<slug>` through the project's `data_tests: +store_failures`, like every other test's.

**A SQL test is held to a model's checks, and a save refuses it.** `checkTests`
(`modelCheck.ts`) reads each SQL test the way `checkModel` reads a model's SQL: one statement,
no write keyword, no `select into`, every `ref()` and `source()` known, no relation read
around dbt. It reuses those same functions. It adds three errors:

- `test-model-unread`: the test reads its own model through no `ref()`. dbt would neither
  build the model before the test nor select the test with `--select <model>`, so the test
  would judge a table the build had not made yet.
- `test-forbidden-call`: `config`, `run_query`, `statement` or `adapter`. The first could send
  the failing rows -- source rows, verbatim -- out of `dq` into a schema a dashboard reads. The
  others run SQL the lexer never sees.
- `test-name-too-long`: `<model>__<name>` is a relation name, and Postgres cuts one past 63
  characters without saying so.

A `relationships` whose `to` names no model the tenant has, and is not this model, is
`unknown-ref`. `models.check` reports all of these, each finding naming its `test`.
`models.save` refuses on the first error, BAD_REQUEST with the same worded sentence, and writes
nothing. A model's own SQL is still never refused at save (ADR 0086's line for macros is the
precedent here, not the model editor's). The difference is deliberate. A broken model breaks its
own table, which the person sees and fixes in the editor. A broken test is in a JSON field that
no form edits, and it fails the compile of the whole tenant's project, so every model stops
building. Refusing at save is the only point where the author hears about it. The tests still
run as the tenant's dbt login, exactly like model SQL, and that login's grants stay the security
boundary.

**Run recording.** A singular test's `unique_id` is `test.undercroft.<model>__<name>`, with no
hash, and `parseRunResults` records its step under that name. The ledger's step-to-model
attribution belongs to issue 456. It reads the manifest's `depends_on`, which contains the
model because the test must `ref()` it. Where a test reads several models, the convention
decides: the model is everything before the last `__`, which a test name cannot contain. A warn
test that found rows is dbt's status `warn`. That status is recorded as it is, visible, never
counted in `testsFailed`, which counts `fail` and `error` alone, and never folded into `pass`.
`dq.failures` needs no change: it reads the relation a step names, whatever its kind.
`relationsOfModel` names the new tests' failing-rows tables as dbt 1.9's
`synthesize_generic_test_names` does: arguments sorted by name, lists flattened, `False` written
the Python way, and an md5 at 64 characters. With those names, deleting a model also drops what
its new tests stored.

**The editor keeps what it cannot show.** The model editor's form edits `not_null` and
`unique`. Its draft now carries the stored tests whole, and a save sends every test it does not
edit back unchanged. Without that, saving from the editor would have deleted the model's other
tests.

## Consequences

- A tenant's `chk_*` models can become tests, which leaves lineage and `bi.schema` with only
  business tables. The model-builder skill teaches tests and says never to write a check model.
- A model must exist before another model's `relationships` or SQL test can name it. Deleting a
  model that another model's test names leaves that test naming nothing, as a `ref()` in model
  SQL already does. Nothing here adds a guard to delete.
- When seeds land (issue 446), `checkTests` must count a seed's name among the names
  `relationships.to` and `ref()` may reach.

## Options rejected

- **`accepted_values` and `relationships` only, no SQL.** This is safer and smaller, but it
  cannot express a rule across columns or over an aggregate, which is most of what the check
  models were for.
- **dbt 1.10's `arguments:` form.** The worker pins dbt-core 1.9.1, which reads it wrongly.
- **A migration rewriting stored tests into object form.** It would change every stored
  model's `testsSha256` and gain nothing, since the short form stays valid.
- **Advisory only, like model SQL.** A test with an unknown `ref()` breaks every model's build,
  not its own. The editor never shows the test, so the save is the only place to say so.
- **Accepted values as JSON numbers when `quote: false`.** A number in JavaScript is a float,
  and `money.md` keeps an amount out of one. The value stays the text written.
