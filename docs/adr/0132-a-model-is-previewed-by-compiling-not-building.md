# 132. A model is previewed by compiling it, not by building it

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0016](0016-the-worker-seals-the-control-plane-consents.md) (the worker is the
  one process that holds a tenant's credentials), [ADR 0086](0086-a-tenant-writes-its-own-macros.md)
  (dbt sees only an allowlisted environment), [ADR 0088](0088-tenant-logins-reach-postgres-through-a-pooler-and-runs-take-a-turn.md)
  (turns), [ADR 0124](0124-a-procedure-that-waits-holds-its-request-to-its-own-cap.md) (holding a
  request open), [ADR 0131](0131-a-build-publishes-only-what-passed.md) (`ref()` reads the
  published version of a parent the build does not select)

## Context

Issue 466. Before `models.save`, an author wants to see what an unsaved model's SQL returns: a
sample, or an outer query over it such as `select count(*), count(distinct k) from <name>` to
check a grain. `models.check` reads text and lists "compiles" among what it cannot verify, and
`models.build` needs a save, opens a run and replaces a table. So people rendered dbt's Jinja
themselves -- each `ref()`, `source()` and macro by hand -- and sent the result through
`lake.query`. That copy drifts from what dbt compiles, and it is wrong exactly where a model is
subtle: an ephemeral parent, a tenant macro, the platform's `ref` override.

## Decision

**`models.preview` compiles the draft with dbt inside the tenant's own project and runs what dbt
compiled in the read-only frame, as the tenant's dbt login.** Nothing is saved, built or entered
in the run ledger.

1. **The worker verb `POST /v1/models/preview`**, behind the service token, beside the query
   verbs (`apps/worker/src/services/modelPreview.ts`). It checks the tenant is provisioned (it
   provisions nothing), reads the saved models, macros and seeds, and renders the project through
   `tenantProjectFiles` -- the function `runTransform` renders with, so the two cannot drift --
   with the draft in place of the saved model of its name, or beside the saved ones, with no
   tests. The seeds go through `projectSeeds` as a build's do; it reads the columns standing in
   staging to decide each seed's full refresh, writes nothing, and the flag it sets is one only a
   seed load acts on.
2. **`dbt compile --no-use-colors --no-introspect --no-populate-cache --indirect-selection empty
--select <name>`**, in a directory removed afterwards, with a 60-second deadline.
3. **Compile holds no credential.** The child's environment is the `CHILD_ENV` allowlist with
   `UNDERCROFT_DBT_PASSWORD` set to `""`, and the lease a build takes on the dbt login
   (`withPassword`) is not taken. With these flags dbt does not connect; with no password it
   could not authenticate if a later dbt decided to; and `--no-introspect` refuses `run_query`,
   so a draft cannot execute a statement through Jinja at compile time.
4. **The compiled SQL** is `nodes["model.undercroft.<name>"].compiled_code` in
   `target/manifest.json`, which includes the CTEs dbt injects for ephemeral parents. A compile
   that exited non-zero, or left no code, is `compile_failed` with dbt's own cause (`causeOf`). A
   broken sibling fails it, as it fails a build.
5. **It runs as `lake.query` runs SQL** (`runRawQuery`): the read-only frame -- one statement
   through the extended protocol, our LIMIT, a statement timeout -- as the dbt login, with `raw`
   as the search path. The frame is the boundary: the dbt login can create in its own schemas,
   and the read-only transaction is what takes that away. The compiled SQL names everything in
   full, so the path decides only where an unqualified name in an outer query looks: the same
   place the raw console looks.
6. **An outer query** sees the model as `WITH "<name>" AS (\n<compiled>\n)\n<query>`. The name is
   a validated identifier. The newline before `)` is required, because compiled code can end in
   a `--` comment.
7. **Capacity.** A preview takes a turn of its own kind, `preview`, two at once per worker, and
   waits ten seconds for one before it is `tenant_busy`. It takes no build lock and opens no run.
   The worker holds the request open for the preview's own deadline (ninety seconds: the turn,
   the compile, the query, and five around them); the control plane waits ninety-five, and
   `models.preview` declares `holdsOpenSeconds` of 105.
8. **The procedure.** `models.preview` is a mutation, because the SQL does not fit a query
   string, like `models.check`. It is admin-only and a `write` for a credential's grant, as
   `lake.query` is, because it runs author SQL as the login that may read raw; it is audited as a
   read. `compile_failed` and `query_failed` are BAD_REQUEST quoting dbt and Postgres, with the
   facts `COMPILE_FAILED` and `QUERY_FAILED`; a worker that did not answer is
   PRECONDITION_FAILED. Its answer is `{columns, rows, truncated, compiled}`, drawn by the MCP
   grid widget like `lake.query`'s.

**Evidence.** A spike with real dbt-core 1.9.1 and dbt-postgres 1.9.0 over this repo's
`renderProject` output:

- With the flags above, `--select child` exits 0. `compiled_code` is
  `with __dbt__cte__eph as (\n\nselect * from "postgres"."analytics_t1"."base"\n) select e.* from
__dbt__cte__eph e join "postgres"."analytics_t1"."base" b using (id) -- trailing`. Every
  `ref()` resolves to `analytics_<slug>` through the platform's `ref` override, an ephemeral
  parent's included; a seed's `ref()` compiles to `analytics_t1.lookup`; and the injected
  ephemeral CTEs are part of `compiled_code`.
- The same compile succeeds with a wrong password and with an empty one: it never connects.
- A model with `{% set r = run_query('create table ...') %}` exits 2 under `--no-introspect`:
  `Runtime Error in model rq (models/rq.sql)` / `connection never acquired for thread ...`.
  Nothing executes.
- A broken sibling model fails the whole compile with exit 2, `Compilation Error in model base2
...`, the same as a build does.

## Consequences

- An author sees what the model returns, and what dbt compiled, before the save, with the same
  `ref()` resolution, macros and ephemeral inlining a build would use.
- The preview reads a parent's published version, which is what a build of the draft alone would
  read (ADR 0131). A preview of a model whose parents are also unsaved drafts is not possible;
  each is previewed over the saved versions of the others.
- Each preview costs a dbt process of a few hundred megabytes for a few seconds; the turn bounds
  how many at once.
- **Proven against PGlite, with a fake dbt** that writes the manifest a compile writes: the draft
  replaces the saved model in the project, the child has no password and none of the worker's
  secrets, the compiled SQL runs as the dbt login read-only (a write in an outer query is
  refused), and a refused compile carries dbt's cause. That real dbt compiles as above is the
  spike's evidence, not the gate's.

## Options rejected

- **Render the Jinja in TypeScript.** It is the issue's workaround, and the copy drifts from dbt
  the moment a tenant writes a macro, an ephemeral model or anything the platform's `ref`
  override decides; it also returns a confident wrong answer where dbt would have refused.
- **Save under a scratch name, build it, read it, delete it.** It needs a save, so it leaves runs,
  audit rows and lineage behind for something nobody saved, holds the build lock against real
  builds, and needs ADR 0077's drops to clean up a table it should never have made.
- **`dbt show`.** It runs the query itself, through dbt's connection rather than our read-only
  frame, with dbt's own LIMIT handling, and it needs the credential this design keeps away from
  the child.
- **Stub the sibling models.** An ephemeral parent must inline its real SQL, and a stub would
  inline the stub; it would also hide a broken sibling that a build of the draft would fail on.
