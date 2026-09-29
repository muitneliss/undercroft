# 86. A tenant writes its own dbt macros, and dbt no longer sees the worker's environment

- Status: Accepted
- Date: 2026-09-29
- Builds on: [ADR 0007](0007-dbt-runs-as-a-subprocess-in-the-worker.md) (dbt is a child of the
  worker), [ADR 0018](0018-per-tenant-roles-and-row-level-security.md) (a tenant's dbt login and
  its two schemas), [ADR 0077](0077-deleting-a-model-drops-what-it-built.md) (a delete that
  would leave something broken does not happen) and
  [ADR 0067](0067-the-published-skills-are-one-family-over-both-doors.md) (the published skills
  teach only what the platform accepts).

## Context

A tenant's dbt project carries the platform's three macros (`parse_amount`,
`generate_schema_name`, `gmail_letters`) and nothing of its own. A tenant cannot factor out an
expression it needs in several models -- a company name brought to one comparable form, a status
mapped to a label -- so each model carries its own copy, and the copies drift: two tables then
disagree about the same company, and nothing fails.

A macro file is not like a model file. dbt reads every macro in the project, and a macro defined
in the root project silently replaces one of the same name that dbt or the platform ships. A
tenant's `generate_schema_name` would move where its tests store failing rows; a `test_not_null`
would make every `not_null` test pass; a `postgres__create_table_as` would change how every model
is materialised. Each builds green and means something else.

Exploring this found a hole beside it. The worker spawned `dbt build` with its own `process.env`,
whole, and dbt's `env_var()` reads that environment into a model. A model saying
`{{ env_var('UNDERCROFT_SECRET_KEY') }}` would have copied the master key into a table its tenant
can read -- and likewise the worker's database DSN and the OAuth client secrets.

## Decision

- **A tenant owns macros**, `app.macro` (tenant, name, description, the whole definition), in
  `app` for the reason `app.model` is there: it is text a person wrote, and neither the BI role
  nor any dbt role has USAGE on `app`. The control plane writes the rows; the worker reads them.
- **One row is one whole definition**, `{% macro name(args) %} ... {% endmacro %}`, written by
  the author. `macros.save` REFUSES, with `BAD_REQUEST` and a worded reason, anything that is not
  exactly one macro block whose name is the row's name (`not-one-macro`, `name-mismatch`), that
  holds a `materialization`, `test`, `data_test`, `snapshot` or `docs` block
  (`forbidden-block`), or whose name is reserved (`reserved-name`). Nothing but comments may stand
  outside the block. The Jinja is read by one block reader (`jinjaBlocks` in `jinja.ts`) that
  skips strings inside a tag and honours `{% raw %}`, as Jinja does, so a block cannot be hidden
  from the check inside a string.
- **Reserved names**: the platform's macros; every name `DBT_CONTEXT` lists (`ref`, `source`,
  `config`, `var`, `is_incremental` and the rest); any name containing `__`, which is how dbt's
  adapter dispatch names implementations; the prefixes `generate_`, `test_` and
  `materialization_`; and `should_full_refresh` and `get_where_subquery`, which dbt calls from
  inside a build. `macroDefinition.ts` is the one place the list lives.
- **A description is required**, 1 to 500 characters, and `macros.list` returns it with each
  macro's parameters: it is what an agent reads to reuse a macro rather than write the
  expression again.
- **Every macro of the tenant is rendered on every build**, to `macros/tenant/<name>.sql`, a
  directory apart from the platform's.
- **`models.check` knows the tenant's macros**, so a call to one is not `unknown-macro`, and
  `models.reference` returns them beside the platform's. `macros.check` holds a definition to
  the same reading: the refusals above as errors, then unknown calls, bare names nothing binds
  (`unbound-name`), `ref()` and `source()` as for a model, a `;` and a write keyword.
- **Delete is refused while anything calls the macro**: `macros.delete` answers `CONFLICT`
  naming every model and other macro whose text calls it, found by reading their Jinja.
- **Procedures**: `macros.list` and `macros.get` (any member), `macros.check` (any member, a
  `read`), `macros.save` (admin, a `write`, `create` refusing a taken name with `CONFLICT`),
  `macros.delete` (admin, `destructive`). Saves and deletes are audited as `macros.save` and
  `macros.delete`. The assistant is given none of them, for the reason it has no `models.save`:
  authoring text that runs as the customer's database role is not done by description.
- **The web UI shows a tenant's macros read-only**, in the model editor's reference panel. They
  are written through the CLI, MCP or an agent following the model-builder skill.
- **dbt's environment is an allowlist**: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`,
  `LC_CTYPE`, `TZ`, `SSL_CERT_FILE` and `SSL_CERT_DIR` from the worker's environment, plus the
  tenant's own password in `UNDERCROFT_DBT_PASSWORD`. Nothing else reaches a model or a macro.

## Consequences

- An expression written once is called from every model that needs it, and the model-builder
  skill proposes a macro when the same expression would appear in a second model.
- **A broken macro fails every build of its tenant**, not only the models that call it: dbt
  parses the whole project before it builds any of it. `macros.check` catches what text alone
  can show; what only compiling shows surfaces at the next build, for the whole tenant.
- The delete guard is read in application code, not in the statement: a model saved calling a
  macro in the instant that macro is deleted is not caught, and fails its next build with dbt's
  own "macro not found". Calls are Jinja, which SQL cannot read.
- A macro added to the platform's `MACROS` later takes a name a tenant may already hold, and dbt
  refuses a project with two macros of one name: every build of that tenant would fail until
  one is renamed. A new platform macro is checked against `app.macro` before it ships.
- A stored macro that a later rule would refuse -- a name reserved after it was saved -- is still
  rendered; `macros.list` reports its parameters as unknown (`null`) rather than guessing them.
- dbt's global macros beyond the reserved list (`create_table_as` and the rest) can be
  overridden by a tenant. That changes only the tenant's own build, inside its own grants; the
  database remains the security boundary, as `privileges.md` has it.
- A variable a future dbt needs from the environment must be added to `CHILD_ENV` in
  `apps/worker/src/services/transform.ts` by name. That is the point: a secret added to the
  worker tomorrow is not handed to a model by default.

## Options rejected

- **A local dbt package per tenant, namespaced** (`tenant.normalise(...)`). A package's macros
  cannot override the root project's, which would make reservation unnecessary -- but every call
  would need the namespace, `models.check` and the skills would need to learn a second calling
  form, and a package needs its own `dbt_project.yml` and `packages.yml` rendered and installed
  (`dbt deps`) on every build, for a problem a name check solves.
- **Macros written inline at the top of a model's SQL.** dbt would parse them, but only that
  model could call them -- the drift this ADR exists to end.
- **No name reservation**, trusting the tenant's admin. The failures it prevents build green and
  are found, if ever, as a wrong number on a dashboard.
- **Removing the known secrets from the environment instead of allowlisting.** Whatever is added
  to the worker next would reach dbt until someone remembered to remove it too.
