---
title: ADR 0132 A Model Is Previewed by Compiling It, Not by Building It
type: source
date: 2026-10-13
tags: []
source: docs/adr/0132-a-model-is-previewed-by-compiling-not-building.md
source_path: docs/adr/0132-a-model-is-previewed-by-compiling-not-building.md
source_hash: f63becb9d5c2742a1b62d8519a287326c471cf9e2c3136e06f24e87d5dc26138
ingested: 2026-10-13
---

# ADR 0132 A Model Is Previewed by Compiling It, Not by Building It

Issue #466. Before `models.save` an author wants to see what an unsaved model's SQL returns -- a sample, or an outer query such as a count of rows against a count of distinct keys. `models.check` reads text and lists "compiles" as unverified, and `models.build` needs a save, opens a run and replaces a table, so people hand-rendered dbt's Jinja and ran the result through `lake.query`: a copy of dbt that drifts exactly where a model is subtle.

**Compile, then run in the frame.** `models.preview` sends the draft to the worker verb `POST /v1/models/preview` (service token). The worker checks the tenant is provisioned (it provisions nothing), reads the saved models, macros and seeds, and renders the project through `tenantProjectFiles` -- the one rendering a build uses -- with the draft in place of the saved model of its name or beside the others, with no tests. It runs `dbt compile --no-use-colors --no-introspect --no-populate-cache --indirect-selection empty --select <name>` in a temporary directory removed afterwards (60-second deadline), takes `nodes["model.undercroft.<name>"].compiled_code` from the manifest (ephemeral parents inlined), and runs it as `lake.query` runs SQL: the read-only frame, as the tenant's dbt login, `raw` as the search path. An outer query sees the model as `WITH "<name>" AS (\n<compiled>\n)\n<query>`; the newline before `)` matters because compiled code can end in a `--` comment.

**No credential at compile.** The child gets the `CHILD_ENV` allowlist with the dbt password set to empty, and no lease on the dbt login is taken: with these flags dbt never connects, and `--no-introspect` refuses `run_query`, so a draft cannot execute a statement through Jinja. `projectSeeds` only reads staging's columns to set a flag compile never acts on.

**Answers and refusals.** `{columns, rows, truncated, compiled}`; a compile that failed or left no code is `compile_failed` with dbt's own cause (a broken sibling fails it, as it fails a build), and SQL Postgres refused is `query_failed`; both reach the caller as BAD\_REQUEST with facts `COMPILE_FAILED` / `QUERY_FAILED`, a worker that did not answer as PRECONDITION\_FAILED. Admin-only and a `write` for a credential's grant, like `lake.query`; audited as a read; drawn by the MCP grid widget.

**Capacity.** Its own turn kind, `preview`, two at once per worker, ten seconds to get one or `tenant_busy`; no build lock, no run. The worker holds the request ninety seconds (turn, compile, query, five around them), the control plane waits ninety-five, and `holdsOpenSeconds` is 105 ([[ADR 0124 A Procedure That Waits Holds Its Request Open to Its Own Cap, and Nothing Else Does]]).

**Evidence.** A spike with dbt-core 1.9.1 / dbt-postgres 1.9.0 over `renderProject` output: the compile exits 0 and every `ref()` resolves to `analytics_<slug>` through the platform's override ([[ADR 0131 A Build Publishes Only What Passed]]), ephemeral CTEs included and a seed's `ref()` too; it succeeds with a wrong or empty password; a `run_query('create table ...')` model exits 2 ("connection never acquired") and nothing executes; a broken sibling fails the compile with exit 2.

**Rejected.** A TypeScript re-render of Jinja (the drifting workaround); save under a scratch name, build and delete (runs, audit and lineage noise, the build lock, ADR 0077 drops); `dbt show` (outside the read-only frame, its own LIMIT, needs the credential); stubbing sibling models (an ephemeral parent must inline its real SQL, and a stub hides a broken sibling).
