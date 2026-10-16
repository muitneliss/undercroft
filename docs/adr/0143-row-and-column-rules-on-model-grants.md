# 143. Row and column rules on model grants, enforced by the scope login

- Status: Accepted
- Date: 2026-10-16
- Builds on: [ADR 0139](0139-tenant-access-is-casbin-policy.md), whose "What follows" named this
  change (PR 4 of 4), [ADR 0141](0141-custom-roles-and-grants-under-the-subset-rule.md) and
  [ADR 0142](0142-object-reach-and-scope-logins.md), whose grants, subset rule, scope logins and
  promotion it extends.
- Supersedes, in part: ADR 0142, where a scope's canonical form is always
  `undercroft.scope/1;models=…`: a scope with rules hashes as `undercroft.scope/2;models=…;rules=…`.
  A scope without rules keeps `/1`, its name and its grants. Also where "its grants are only ever
  added" covers SELECT on a whole table only: a scope with hidden columns is granted SELECT on its
  visible columns instead, and a table some scope has a row rule on carries row-level policies.
- Keeps: [ADR 0018](0018-per-tenant-roles-and-row-level-security.md) (row security keyed on the
  login, never a setting), [ADR 0036](0036-a-definition-is-restated-not-migrated.md) (a tenant's
  reach is stated in `repeatable/010_provision_tenant.sql` alone), [ADR
  0131](0131-a-build-publishes-only-what-passed.md) (write-audit-publish), and every rule of ADR
  0142 about who reads as which login.

## Context

After ADR 0142 a customer can say which models a person reads, and not how much of one. Issue 481's
"read groups" asked for the two cases that come up in every customer: _the head of Sales sees only
their department's rows_ ("trưởng phòng Sales chỉ thấy dòng của phòng mình") and _staff do not see
the salary column_ ("nhân viên không thấy cột lương"). A reader's SQL is their own text, so, as in
ADR 0142, the boundary has to be in Postgres and keyed on which login they are.

## Decision

### What a rule is

**A rule narrows the grant it belongs to.** A grant on one model (`model:<name>`, `read`) may carry
a **row rule** -- one to ten conditions `{column, op: "eq" | "in", values}`, ANDed -- and **hidden
columns**. A grant with neither reaches the whole table. `model:*` cannot carry a rule (a rule
names one model's columns), nor can a permission, a raw stream or a report.
`access_grant_rules_on_one_model` (`630_grant_rules.sql`) says so in the database, beside two
shape CHECKs that restate the bounds every door validates with (`@undercroft/contracts/rowRules`).

Saving the same grant again **replaces** its rules, as it moves its expiry: `access_grant_once` is
unchanged, one grant per subject, object and action.

At `grants.save` every column a rule names, hidden ones included, must be one the model's last
build found (`app.model.columns`) or the reference table declares; an unknown one is refused
(`COLUMN_NOT_FOUND`), and a model never built has no columns to name. An `eq` with more than one
value is refused rather than read as `in`.

### Effective access is a union

Like every other grant, rules add. For one model, what a person reads is the **union** over every
grant that reaches them on it, from their role and their own: a grant with no row rule is every
row, `model:*` is the whole table, otherwise a row is seen when it meets **any one** grant's rule;
the visible columns are the union of each grant's, so a column stays hidden only when every grant
hides it. Casbin still decides WHETHER a model is reached; how much of it is that union, computed
from the same grant rows in `rbac.ts` (`limitsOf`) and carried on the reach as `limits`. Every
built-in role holds `model:*` and is never narrowed.

### Hidden columns are refused, not blanked

A blank would pass for a real value (CLAUDE.md, rule 2). So a scope login with hidden columns is
granted `SELECT (<visible columns>)` on the table instead of table-level SELECT: naming a hidden
column, or `SELECT *`, is a permission error, and `information_schema` -- which `bi.schema` reads --
leaves the column out with no filter of ours. Postgres words it "permission denied for table";
`bi.answer` rewords it, when the table is one the reader reaches with hidden columns, as
`COLUMN_NOT_GRANTED` naming the columns. A table outside their reach is still refused in Postgres's
words, which confirm nothing. `models.list`, `models.get` and `seeds.get` leave hidden columns out.

**The visible columns are computed when the grant is written**: the table's real columns, less the
hidden list. **Trade-off, accepted:** hiding is a list of what to hide, so a column a later build
adds is VISIBLE until somebody hides it. The alternative -- a list of what to show -- would hide a
new column from everyone narrowed, including the readers it was added for, and a grant would need
editing at every model change; and a deny-list is what both examples in the issue are. The access
view, `scopes.preview` and the skill say it in those words.

### Row rules are row-level security, keyed on the login

- A table some scope has a row rule on gets `ENABLE ROW LEVEL SECURITY` -- **not `FORCE`**: its
  owner is the customer's dbt login, which builds, tests and previews it and must read every row,
  and an owner bypasses unforced policies.
- `undercroft_open`, `FOR SELECT TO <the BI login>, <every scope login with no row rule on it>
USING (true)`, so everyone who read every row still does. The role list is explicit: a scope
  left off it reads no row (fail closed), where a policy `TO PUBLIC` with an exclusion list would
  have let a new rule-bearing scope read everything.
- One policy per rule-bearing scope, named for its login, `TO <that login> USING (<rule> OR …)`.
  Each rule is `(<column> = ANY (ARRAY[<value>::<type>, …]) AND …)`, built with `%I` and `%L` only,
  never free text (`ops.row_predicate`).
- **The comparison is typed**, against the column's own type as `format_type` names it without a
  modifier -- so `region_id = '7'` is the integer 7, `1.50` and `1.5` are one numeric, and a value
  longer than a `varchar(10)` is compared whole rather than cut to ten characters and matched. A
  literal cast in a policy is converted when the policy is created and stored as a constant, so a
  reader's `SET TimeZone` or `SET DateStyle` cannot move which rows match; the settings it is read
  under are pinned on the function that writes it. NULL never matches. Text comparison was
  rejected: a value would have to match the column's text output exactly (`1.50`, a timestamp's
  zone), and nothing would say so.
- Policies are compared with what they should say by a fingerprint in each policy's comment and
  rewritten only when it differs: creating or dropping one takes the table's ACCESS EXCLUSIVE lock,
  and the restatement runs before every build and on every deploy.
- A materialised view cannot carry row security, so a scope with a row rule on one is granted
  nothing on it.

`privileges.md` forbids row security keyed on a session setting or on `SET ROLE`; this is keyed on
`current_user`, which a scope login cannot change -- it is NOINHERIT and a member of nothing, so it
has nothing to `SET ROLE` to -- and `SET row_security = off` makes Postgres refuse its query rather
than answer it whole. The Docker tier proves both.

### Never let a broken rule widen access

A rule naming a column the table no longer has -- a rebuild dropped it -- or a value its column's
type refuses, compiles to nothing (`ops.row_predicate` answers NULL), and that scope's policy on
the table becomes `USING (false)`: they see no row of it. Everyone else is unaffected, and the
promotion still publishes. Nothing is stored about it: `ops.scope_faults` asks the same function
against the table standing now, so what an administrator is told is broken (`broken` in
`scopes.preview`, in the access view, in the assistant's facts) and what the reader is shown cannot
disagree. A hidden column the table lacks hides nothing, which is not a fault.

### Applied where PR 3 applies grants, and re-applied on every change

Policies and column grants die with a table, so they are re-written exactly where ADR 0142 writes
table grants: `raw.grant_staged_to_scopes`, inside the promotion's transaction and before it moves
anything, now writes each reaching scope's column grants and the staged relation's policies
(`ops.apply_relation`), and both travel through `ALTER … SET SCHEMA`. A republished table is never,
at any instant a reader can see, unlimited or ungranted. A rule changed is a new hash and so a new
login, provisioned lazily at its first session (`ops.provision_scope`), which writes the policies
of every published table it reaches -- adding itself to `undercroft_open` or adding its own policy
-- under the customer's scope lock. `provision_tenant` restates every relation any scope reaches,
once each (`ops.apply_scopes`). `ops.drop_stale_scopes` is unchanged: `DROP OWNED` takes a swept
login out of every policy naming it, and when a table's last rule-bearing scope is gone its
policies, and row security, are dropped at its next restatement.

### The scope hash, version 2

`ops.provision_scope(tenant, models, limits)` takes the rules beside the model set. A scope with no
rules hashes as before, `undercroft.scope/1;models=<names>`; one with rules as
`undercroft.scope/2;models=<names>;rules=<ops.scope_limits>`, where `ops.scope_limits` validates the
rules and writes them in one canonical order (values, conditions, rules, hidden columns and models
each deduplicated and sorted bytewise; `op` dropped, because `eq` is `in` with one value). Two
readers with different rules never share a login; every scope made before this change keeps its
name. The worker keys its password lease by `scopeKey`, which reads the same set by the same rules,
and the gate pins that the two agree. The two-argument `ops.provision_scope` stays, for a worker
older than this change, and means no rules.

### Routing, and version skew

A scope with rules is sent to routes of its own -- `/v1/queries/limited/run`, `/limited/schema`,
`/limited/export` -- because a worker that knows scopes but not rules would strip `limits` and read
as a login that sees every row of the scope's tables. A scope without rules keeps ADR 0142's
`/scoped/…` routes. An export stores the rules it was asked under (`app.bi_export.scope_limits`)
and downloads under the intersection of those and what the asker reaches when they download: a row
both allow, a column neither hides.

### The subset rule over rules

A caller may grant only what they reach themselves, and that now includes how much of a model.
**Containment is checked, not refused wholesale**: a grant is within the caller's reach of a model
when every rule it gives implies one of the caller's rules -- condition by condition, on the same
column, with values among the caller's -- and it hides every column hidden from the caller. It is
sound and not complete: a rule written another way that happens to say the same thing may be
refused, never the reverse. The same test weighs a role being given or a member removed
(`unreached`), and taking away or replacing a grant: replacing one gives what the new one says and
takes away what the old one said, and the write is guarded on the old rules in its own statement,
so a grant changed meanwhile is not replaced (`CONFLICT`, `GRANT_CHANGED`).

### What a reader is told

- `scopes.preview` (`people:manage` about anyone else, anyone about themselves) answers, resolved
  against what the customer has: the permissions; every model and reference table the subject
  reads, each with its rows, its hidden columns and `broken`; the raw streams; the reports.
  `grants.reach` stays the decision; this is what it comes to.
- An answer that read a table whose rows the reader sees only some of names it in `rowsLimited`,
  and Reports says the figure is of the rows they may see. `models.lineage` names them too.
- The assistant is told how many models the reader sees, which are row-limited, which columns are
  hidden and which rules are broken, so it can say why a total differs or a column is refused.
- `seeds.get` leaves hidden columns out, and with a row rule shows no rows (`rowsWithheld`): which
  rows a rule matches is the database's to decide, by the column's type, and a second reading of the
  rule here could disagree with it.

## Consequences

- "Sales sees only Sales's rows of `fct_sales`" is a grant on `model:fct_sales` with
  `rowRule: [{column: "dept", op: "eq", values: ["Sales"]}]`, to a role or a person; "staff do not
  see `salary`" is `hiddenColumns: ["salary"]`. Both in People's access view, with the CLI
  (`undercroft grants save … --input-json`) and over MCP (`grants_save`).
- A reader's total over a row-limited table is the total of what they may see, said beside it.
- The first read of a new rule set takes the ACCESS EXCLUSIVE lock of each published table it
  reaches, for the instant its policies are written.
- A held build whose columns changed can make a rule validated against `app.model.columns` broken
  against the published table; `scopes.preview` says so until the build is published.

## Out of scope

- **Rules on raw rows.** `raw.records` is one generic table read as the build login; a rule there
  would need its own design.
- **View-materialised models.** Still refused to every scope login, as in ADR 0142: a view runs as
  its owner.
- **Free-form predicates.** Only `eq` and `in` over a model's columns, compiled with `%I` and `%L`.
  A predicate a person wrote would be SQL running inside every reader's query.

## Options rejected

- **A policy keyed on a session setting or `SET ROLE`.** A reader's SQL can set either
  (`privileges.md`, ADR 0142).
- **Blanking hidden columns** (a view, or a policy that nulls them). A blank reads as a real empty
  value; a refusal is visibly a refusal. And a view runs as its owner.
- **An allow-list of visible columns.** See the trade-off above.
- **Text comparison.** See above.
- **Refusing every rule-bearing grant unless the caller reaches the whole model.** Simpler, and it
  would make a narrowed head of department unable to share any of their own rows; containment is a
  page of code and is pinned from both sides.
- **`FORCE ROW LEVEL SECURITY`.** The owner builds and tests the table and must read all of it.
- **One policy `TO PUBLIC` with the rule-bearing logins excluded.** A login missing from the
  exclusion would read every row; the explicit `TO` list fails closed instead.
- **A stored "broken" flag.** It would be a second record of what the policy writer decided, true
  only until the next build; asking the same function against the live table cannot drift.
