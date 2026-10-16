# 142. Object reach: grants on models, raw streams and reports, enforced through scope logins

- Status: Accepted
- Date: 2026-10-16
- Builds on: [ADR 0139](0139-tenant-access-is-casbin-policy.md), whose "What follows" named this
  change (PR 3 of 4), and [ADR 0141](0141-custom-roles-and-grants-under-the-subset-rule.md), whose
  grants table, subset rule and projection it extends. The model, the matcher, the load-only
  adapter and the one statement per request are unchanged.
- Supersedes, in part: ADR 0141, where `access_grant_permission_only` admits only `perm:` objects
  with `use`: `access_grant_object_shape` admits the three object forms below as well.
- Keeps: [ADR 0016](0016-the-worker-seals-the-control-plane-consents.md) (only the worker mints a login's
  password), [ADR 0018](0018-per-tenant-roles-and-row-level-security.md) and [ADR 0036](0036-a-definition-is-restated-not-migrated.md)
  (a tenant's grants are stated in `repeatable/010_provision_tenant.sql` alone), [ADR
  0087](0087-a-tenant-login-is-leased-not-rotated-per-session.md) (the password lease), [ADR
  0088](0088-tenant-logins-reach-postgres-through-a-pooler-and-runs-take-a-turn.md) (the pooler and its auth query), and
  [ADR 0131](0131-a-build-publishes-only-what-passed.md) (write-audit-publish).

## Context

After ADR 0141 a customer can say what a person may DO, and not which of its things they may do
it to. "Let the Sales department see only `fct_sales`" had no answer: every member read every
model, every raw stream they had `lake:read` for, and every saved report. The BI login that
answers a report, `undercroft_bi_<slug>`, reads all of `analytics_<slug>`, and the worker never
learns who asked.

Reads happen in two places, and they need two kinds of enforcement:

- **The control plane reads some data itself**: `lake.records` and `lake.documents` (as
  `undercroft_app`, `WHERE tenant_id = $1`), the model and seed rows, the saved questions and
  dashboards. A filter there is enough, because nothing a person writes runs there.
- **The worker runs a person's SQL**: `bi.answer`, a saved question, a dashboard tile, an export,
  `bi.schema`. A raw-SQL question is the reader's own text. A filter in the control plane cannot
  see what that text reads, so the boundary has to be below it, in Postgres.

## Decision

### Objects, and who reaches what

- **Three object forms beside `perm:`**, each granted with `read`, in one grammar shared by the
  control plane, the browser and a CHECK (`parseReachObject` in `@undercroft/contracts/access`,
  `access_grant_object_shape` in `610_object_grants.sql`):
  - `model:<name>` for a model or a reference table (a seed is a table to a reader), and `model:*`;
  - `raw:<source>/<entity>`, `raw:<source>/*` and `raw:*`. A source's document catalogue is its
    `documents` stream, the entity a run's ledger already counts it under;
  - `report:question:<uuid>`, `report:dashboard:<uuid>` and `report:*`.
- **A `*` only where it means "the whole of".** `keyMatch` reads a `*` in a policy object as
  "anything from here", so a stored `model:fct_*` would grant every model whose name starts so. The
  name patterns forbid `*` everywhere else; the projection projects no line the grammar does not
  admit, and a bare `*` never.
- **The raw separator is `/`, not the `.` first proposed.** A second mailbox is the source
  `gmail.3fa9c1d2e0ab` ([ADR 0043](0043-a-second-mailbox-is-a-second-source.md)), so `raw:gmail.*` would have reached every mailbox the customer
  connects. No source instance holds a `/`.
- **Default reach.** The four built-in roles reach the whole customer, as every member did before:
  their projected policy gains `model:*`, `raw:*` and `report:*` with `read`, in code beside their
  permissions. **A customer's own role reaches only what is granted to it**, and a grant to a
  person adds to whatever their role reaches. Reach composes with permissions: paging a raw stream
  needs `lake:read` and that stream's reach, and neither alone is enough.
- **Custom roles that exist keep what they had.** Before this change every role reached
  everything, so the migration grants every existing custom role `model:*`, `raw:*` and
  `report:*` -- what it already had -- rather than taking every model and report from it at the
  deploy. A customer narrows it by deleting those grants.
- **Reach is decided by Casbin, like a permission.** For each domain the wildcard is asked of the
  enforcer; if it is refused, every object of that domain a projected line names is asked in turn.
  The answer is a `Reach` -- `"all"`, or the named models, streams, sources, questions and
  dashboards -- carried on the request's context beside `permissions`. A list is narrowed and a
  single read refused by asking that answer (`reachesModel`, `reachesStream`, `reachesReport`),
  never by reading the grants back. A stream whose source is outside the grammar is reached only
  through `raw:*`.
- **`grants.reach`** answers what a role, a member or -- naming nobody -- the caller may do and
  read. About oneself any member may ask; about anyone else it needs `people:manage`, because who
  holds what is the roster's information ([ADR 0119](0119-who-has-access-is-read-by-an-admin-alone.md)). The skill and the access view ask it before a
  grant and after.

### The subset rule, extended

A caller may give or take away reading only what they reach themselves: an object grant needs the
object covered by the caller's reach -- `model:*` only by `model:*`, `raw:<source>/*` by that
source or `raw:*`. Inviting at a role, setting one and removing a member weigh what the role, or
the member, reaches as well as what they hold, so a holder of `people:manage` who reads three
models cannot make anybody a viewer, who reads every one -- the puppet account the rule exists to
refuse. Deleting a role weighs its object grants too. The refusal is FORBIDDEN with
`{ reason: "REACH_NOT_HELD", object, objects }`, the objects spelled as grants spell them.

### Integrity

- **An object grant goes with what it names.** Deleting a model, a seed, a question or a dashboard
  deletes its grants, by an AFTER DELETE trigger on each table -- in the database, for ADR 0141's
  reason about foreign keys: it binds every writer. Names are reused, and a grant that outlived
  `fct_sales` must not hand the next `fct_sales` to whoever held the first.
- **A dangling grant projects nothing.** The membership statement reads an object grant on one
  model or report only while that thing exists, for the grant saved in the instant its object went.
- **A grant on one thing must name a thing the customer has** (`OBJECT_NOT_FOUND`). A raw grant
  need not: a grant on a source not yet connected is how an admin prepares for it, and a stream is
  not a row the customer deletes, so raw grants are never cascaded.
- **A report a person makes is granted to them** when they do not reach every report, or what they
  saved would vanish from their own list the moment they saved it. It is an ordinary grant, listed
  and removable.

### Enforcement where the control plane reads

`lake.summary`, `lake.records` and `lake.documents` are narrowed to the reachable streams; one the
reader does not reach answers as a stream with nothing in it does -- an empty page -- which is the
repo's convention and confirms nothing. `models.list`, `models.get`, `seeds.list`, `seeds.get` and
`models.lineage` are narrowed to the reachable models, a name outside it as unknown to the
`names` filter as one nobody has. The questions and dashboards, their answers, and exports are
narrowed and refused per `report:`. **A dashboard names the tiles a reader may not open**
(`ungranted`), which the screen draws as "not granted" rather than leaving out or mistaking for a
question that was deleted.

`lake.search` is narrowed **inside the worker's candidate lookups**, which take the reachable
streams as two parallel arrays and apply them beside the tenant's own condition, before the cap.
Narrowing the page afterwards would rank, count and cut matches the reader cannot see, and the
page, `truncated` and `capped` would describe a lake that is not theirs.

### What needs the whole

`lake.query`, `lake.querySchema`, `models.preview` and `dq.failures` run SQL as the customer's
build login, and `models.save`, `models.delete`, `models.build`, the macros and the seeds change
what that login runs. That login is one per customer and reads every model and the whole raw lake
-- `raw.records` is one generic table -- so a narrower reach cannot be enforced below it: a reader
of three streams who could write the SQL would read the rest, and an author of one model could
make it select everything and read it back. These procedures need the permission AND the whole of
every model and the raw lake (`requireWholeReach`, `WHOLE_REACH_REQUIRED`), which every built-in
role holding the permission already has. The manifest and the assistant's tool descriptions say so,
read off the same middleware chain.

**What stays unscoped, and why:** a build's row counts and its one model's preview are read as the
BI login. Only a caller who reaches every model can build, so a scoped read would show them nothing
they do not reach already. The raw console stays the build login for the reason above.

### Enforcement where the worker runs SQL: scope logins

A reader whose model reach is the whole customer -- every built-in, or a role or person with
`model:*` -- reads as the BI login, unchanged. **Anyone narrower reads as a SCOPE LOGIN**,
`undercroft_bi_<slug>__<hash7>`, which has USAGE on `analytics_<slug>` and SELECT on exactly the
tables of the models in their reach. Everyone with the same reach shares one.

- **The name** carries the first seven hex characters of the scope's SHA-256: 14 + at most 40 + 2
  - 7 = 63, exactly NAMEDATALEN - 1, which is why the slug is capped at forty. The separator is two
    underscores because no slug can hold two (`ops.tenant_slug` folds every run of other characters
    into one): with one, a customer whose id were `acme-1a2b3c4d` would own a BI login named as
    `acme`'s scope login, and whichever came second would adopt the other's grants. Seven characters
    can collide; the full hash is the row's key, and a taken name is refused, never shared. Eight
    would not fit beside the second underscore.
- **The canonical form** is `undercroft.scope/1;models=<names, sorted bytewise, comma-separated>`,
  computed in one place, `ops.provision_scope`. It is versioned and named by field, so row and
  column rules (PR 4) extend it under `/2` without an existing scope hashing to a new one's name.
  The control plane sends the model SET, not a hash; the worker never computes one.
- **What it is granted.** SELECT on a relation that holds its rows -- a table, a partitioned table,
  a materialised view -- by name. **Never a view**: a view runs with its owner's rights, so granting
  one would let it read whatever the build login reads; a scoped reader asking for a
  view-materialised model is refused by Postgres in its own words. **Never by default
  privileges**, which would hand every scope the next table dbt makes. Nothing in `raw`, `app`,
  `ops`, `dq_<slug>` or `staging_<slug>`, refused explicitly; `raw.tenant_of` answers only for a
  login in `ops.tenant_role`, so a scope login matches no tenant's rows even with USAGE.
- **Where it is stated.** `ops.provision_scope`, `ops.apply_scope`, `ops.drop_stale_scopes` and
  `raw.grant_staged_to_scopes` live in `repeatable/010_provision_tenant.sql`, the one place a
  tenant's reach is written (ADR 0036). `620_scope_logins.sql` holds only what is applied once: the
  `ops.tenant_scope` table, and the password functions taught to admit a scope login.
- **Its grants are only ever added.** A scope's model set is fixed by its hash, so a reader whose
  reach changes moves to another login rather than having this one narrowed -- no grant is ever
  revoked from a login someone still uses.

**Provisioning moment: lazily, at the first session.** The control plane computes the reader's
model set on every request and sends it; the worker's first holder of a scope's lease calls
`ops.provision_scope`, which makes and grants the login if it is new, marks it in use, and -- if a
table of its models stands in analytics without its grant -- grants it then. Then the password is
leased exactly as a tenant login's. So a grant changed a moment ago is in force at the reader's
next session with nothing to push, and a swept login comes back on its next use.

- **Rejected: provisioning on change, through a `scopes/apply` verb.** A grant, a role edit, a
  membership change, a role's deletion, an expiry passing and a model created or deleted each
  change somebody's effective set, and every one of those writers would have to compute every
  affected person's reach and push it. An expiry has no writer at all. A path forgotten leaves a
  login granted what nobody reaches, or not granted what someone does. Lazy provisioning has one
  caller and no paths to forget, and it costs one function call when the lease is taken -- beside
  the `ALTER ROLE` the rotation already makes.

**Applying on publish.** A promotion (`promote.ts`) calls `raw.grant_staged_to_scopes` as the
build login, inside its transaction and before it moves anything: each scope login is granted
SELECT on the STAGED relations it reaches, and the grant travels with the relation through
`ALTER ... SET SCHEMA`, as BI's default grant does (ADR 0131). So a republished table is readable
by exactly the scopes that reach it from the instant it is published -- never ungranted to one in
between and never granted to one that should not -- and while it is still in staging no scope can
reach it: none has USAGE there. The function answers only for the calling login's own customer, by
the test `raw.tenant_of` makes. `provision_tenant`, before every build and on every deploy, restates
every scope's grants on the tables standing there.

**One lock.** `ops.lock_scopes` -- a transaction-scoped advisory lock per customer -- serialises a
new scope's first grants, a promotion's grants and the sweep. A promotion takes it before it locks
any relation, so no two of them can wait on each other.

**Password leasing.** `ops.rotate_tenant_password` and `ops.extend_tenant_password` take one more
argument, the login, for the kind `scope`, and refuse any login that is not one of this customer's
own scope logins. They were dropped and created rather than overloaded, so an older worker's
three-argument call still resolves. The lease is keyed by the canonical model set, which names one
login exactly as the hash does: two keys for one login would be two holders rotating each other
out (ADR 0087). `ops.pgbouncer_auth` answers for a live scope login as for a tenant login.

**Cleanup.** `ops.drop_stale_scopes` drops a customer's scope logins unused for seven days, and only
one whose password is unset or expired and with no backend open as it -- a lease keeps a password
valid for as long as any holder runs, and the pooler closes an idle server connection after fifteen
seconds. It runs inside `provision_tenant`, so before every build and on every deploy. The row is
locked and the test asked under it, so a reader touching the scope in that instant either keeps it
or makes it again.

**Routing, and version skew.** The control plane computes the scope from the request's reach
(`scopeOf`): `null` for a reader of every model, otherwise their models. A scoped read goes to a
route of its own -- `/v1/queries/scoped/run`, `/scoped/schema`, `/scoped/export` -- and a narrowed
search to `/v1/queries/raw/search/within`. The worker and the control plane deploy separately; a
worker older than this change would strip an unknown `scope` field and answer as the BI login,
which reads every model, so a field on the old route would widen everybody's reach for the length
of a deploy. On a route the older worker does not have it answers 404, which is a refusal, and
nothing is read. The precedent is `DropSeedRequest`'s own route.

**Exports** store the asker's model set with the SQL (`app.bi_export.scope_models`), and the
download runs under the narrower of that and what the asker reaches when they download it: reach
given in between does not widen a file asked for before it, and reach taken away narrows it.

**`bi.schema`** lists only a scope login's tables with no filter of ours: `information_schema`
shows only what the login holds a privilege on.

### PgBouncer

Each scope login is a pool of its own of up to `MAX_USER_CONNECTIONS` (8), under the same
`MAX_DB_CONNECTIONS` (50) as every tenant login, and the same `CONNECTION LIMIT 10`. The number of
scope logins is the number of distinct reaches in use, not the number of people, and a session
holds its connection for one query.

## Consequences

- "Let Sales see only `fct_sales`" is a custom role with a `model:fct_sales` grant (and a report
  grant for each report they should open), said in People's access view, with `undercroft grants
save --role sales --object model:fct_sales`, or over MCP (`grants_save`). The skill
  `undercroft-access-control` walks it and checks `grants.reach` before and after.
- Opening a report does not widen what it reads: a question over `fct_sales`, opened by somebody
  granted the question and not the model, is refused by Postgres. Sharing a dashboard is a report
  grant and a model grant.
- A customer's own role that holds `lake:read` or `models:write` and reaches only some models or
  streams is refused the console, the preview, the test failures and every change to the dbt
  project, worded with what it would need. Every built-in is unchanged.
- A holder of `people:manage` or `roles:manage` in a customer's own role needs the reach of the
  roles they assign and the grants they give.
- The audit log records an object grant's object (`grants.save`, `object`) as it records a
  permission.

## Options rejected

- **Row security keyed on a session setting** (`current_setting('undercroft.scope')`). A SELECT can
  call `set_config` on itself; the frame sets `search_path` exactly that way. A policy a reader can
  `SET` past is not one (`privileges.md`).
- **`SET ROLE` to a NOLOGIN scope role from the BI login.** `RESET ROLE` escapes it, and the
  reader's SQL can issue it; the itest proves a scope LOGIN has nothing to reset to.
- **A view per scope over the published tables.** A view over a published table holds back that
  table's next publication (`settle`, `dependentsOf` in `promote.ts`), so every grant would freeze a
  model; and a view runs as its owner, which reads everything.
- **Rewriting the reader's query** to read only reachable tables. A raw-SQL question is the reader's
  own text, `bindParams` splices values into it, and the planner -- not a parser of ours -- decides
  what it reads. A rewrite would be a second reading of SQL that the plan already contradicts.
- **One login per person.** The pooler holds a pool per login, so logins and pools would grow with
  people rather than with distinct reaches; every person's first read would provision; and two
  people with the same grants, which is the common case, would hold two of everything.
- **Provisioning on change** -- see above.
- **A field on the existing routes.** An older worker strips it and reads as the BI login.
- **Filtering the search page after its LIMIT.** It ranks and counts what the reader cannot see.
