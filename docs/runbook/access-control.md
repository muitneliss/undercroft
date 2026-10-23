# Access control: roles and grants

What a person may do in a customer is a set of permissions, and what they may read is their
REACH: which models, raw streams and reports. Every customer has the four built-in roles, which
reach everything; this runbook is how a customer defines roles of its own, grants one permission
or reading one thing to a role or a person, makes a grant expire, checks what someone reaches, and
takes access away -- in the web UI, with the CLI, and over MCP. What each permission covers, the
object syntax and every bound are the [permissions reference](../reference/permissions.md); why it
works this way is [ADR 0139](../adr/0139-tenant-access-is-casbin-policy.md),
[ADR 0141](../adr/0141-custom-roles-and-grants-under-the-subset-rule.md),
[ADR 0142](../adr/0142-object-reach-and-scope-logins.md),
[ADR 0143](../adr/0143-row-and-column-rules-on-model-grants.md) and
[ADR 0147](../adr/0147-each-division-reads-under-its-own-permission.md).

## Before you start

- **Who may.** Defining roles and giving grants needs `roles:manage`; reading the grants and
  giving someone a role needs `people:manage`. An `admin` holds both.
- **The subset rule.** You can give, grant or take away only permissions you hold yourself, and
  reading only what you can read yourself. A person holding `roles:manage` but not `keys:manage`
  cannot define a role holding `keys:manage`, grant it, or invite anyone at such a role; one who
  reads only `fct_sales` cannot grant `model:*`, nor invite anyone at a built-in role, which
  reads everything. The refusal names what you lack.
- **What a role of your own reads.** A built-in role reads every model, the whole raw lake and
  every report. A role the customer defines reads ONLY what is granted to it -- `model:fct_sales`,
  `raw:hubspot/deals`, a report, or the whole of one with `model:*`, `raw:*`, `report:*` -- and a
  grant to one person adds to whatever their role reads. Roles defined before this release were
  given all three wholes, so they read what they did.
- **What a role opens.** A role holding no permission opens Customers and Reports alone, as a
  `viewer` does. Sources, the Journal, the Raw lake and Models each open on a read permission of
  their own -- `sources:read`, `runs:read`, `lake:read`, `models:read` -- in the browser, the CLI
  and MCP alike, so a role meant to follow the runs holds `runs:read`, and one meant to read the
  dbt project `models:read`. Reading a model's rows through Reports needs none of them: a grant on
  the model is enough.
- **Choose the smallest change.** A role the customer already has, if one holds exactly what the
  person needs; a grant, for one more permission or one for a while; a new role, when several
  people need the same set.

## In the web UI

Open the customer, then **People**.

### Define a role

1. Choose **Roles**. The table lists the four built-ins and the customer's own roles, with what
   each holds and how many people hold it.
2. Under **Define a role**, fill in the key (lowercase letters, digits and underscores, starting
   with a letter, such as `accountant`; it cannot be changed later), the display name, and an
   optional description.
3. Tick the permissions. A box for a permission you do not hold is locked.
4. Press **Define role**.

To change a role's permissions, press **Edit permissions…** on its row, tick, and press **Save
permissions**; **Cancel** discards the ticks. A built-in role has no Edit: it cannot be changed.

To delete a role, press **Delete…** and then the plate that names it. A role somebody holds, or
an open invitation names, is not deleted: move those people to another role, or withdraw the
invitations, first. Every grant to the role goes with it.

### Give someone a role

On **Members**, choose the role in the person's row; to invite somebody new at it, use the form
on **Invitations**. Both list every role the customer has; a role of its own shows its display
name with its key beside it.

### Grant a permission, and make it expire

1. Choose **Grants**. The table lists every grant, including expired ones.
2. Under **Grant a permission**, choose whom it is for -- a role, or a person on the roster --
   and the permission.
3. To make it expire, pick the last day it holds. It holds until the end of that day in your
   own time zone, the one your browser shows every date in (ADR 0149). Leave it empty for a
   grant that does not expire.
4. Press **Grant**.

An expired grant stays in the list, marked expired, and holds nothing. Granting the same
permission to the same subject again moves its expiry rather than adding a second grant.

### Let a role or a person read one thing

On **Grants**, under **Grant a permission**, the second select also lists what can be read:
**Read the whole** (every model, the whole raw lake, every report -- offered only if you read the
whole of it yourself), each model and reference table (listed if you hold `models:read`), each raw
source and stream (listed if you hold `lake:read`), and each question and dashboard. Choose one
and press **Grant**, as for a permission.

To let the Sales department see only the model `fct_sales` and the dashboard built on it: define
a role `sales` with no permissions, grant it `fct_sales`, grant it the dashboard and each of its
questions, and give the people the role. A dashboard tile whose question someone was not granted
shows **not granted**; a question over a model they were not granted is refused by the database.

### Let someone read only some rows, or not some columns

A grant on one model or reference table can say how much of it it gives. Choose the model under
**Grant a permission**, and the form offers its columns, as its last build found them -- if you
hold `models:read`, which reading them needs:

1. **Only rows where**: press **Add a condition**, choose a column, **equals** or **is one of**, and
   type the value -- one to a line for **is one of**. A row must meet every condition. A value is
   compared as the column's own type, and an empty cell never matches.
2. **Hide columns**: tick each column the person may not read. A hidden column is refused when they
   query it, `SELECT *` included, never shown blank.
3. Press **Grant**. Under the form, **They can see now** says what the role or person reads: how
   many models, and for each one limited, which rows and which columns are hidden.

To let the head of Sales see only Sales's rows of `fct_sales`: grant their role (or them) the model
`fct_sales` with the condition `dept` **equals** `Sales`. To hide the salary column from staff:
grant their role `fct_sales` with `salary` ticked under **Hide columns**.

Three things to know:

- **Grants add up.** Someone whose role reads Sales's rows and who is also granted the whole model
  reads every row; two rules on one model show the rows of either. A built-in role reads every
  model whole and is never limited.
- **Hiding is a list of what to hide.** A column a later build adds is visible until somebody hides
  it. Check **They can see now** after a model gains a column.
- **A broken rule shows no rows.** A rule naming a column the model no longer has shows that person
  none of the table's rows -- never all of them -- and **They can see now** says it is broken. Fix
  the rule, or take it away.

A total someone reads over a table whose rows they see only some of is the total of what they see:
Reports says so above the figure.

### Take a grant away

On **Grants**, press **Take away…** on its row, then the plate naming whose it is. Removing a
person from the customer takes every grant to them away as well. Deleting a model, a reference
table, a question or a dashboard takes away every grant on it.

## With the CLI

The commands are the procedures, one per command (`undercroft describe roles save --agent`
lists each one's flags). A write needs a profile that allows writes; run it with `--dry-run`
first to see the request.

Read what you hold, and the roles there are:

```sh
undercroft tenants get --tenant-id CASE-0042 --agent
undercroft roles list --tenant-id CASE-0042 --agent
```

Define a role. Its permissions are an array, so they go in the JSON input:

```sh
undercroft roles save --tenant-id CASE-0042 --key accountant --label "Accountant" \
  --description "Reads reports and the raw lake" --create \
  --input-json '{"permissions":["reports:author","lake:read"]}'
```

Without `--create` the same command replaces the role's label, description and permissions, and
answers `unchanged: true` when nothing differs. Delete one with
`undercroft roles delete --tenant-id CASE-0042 --key accountant --yes`.

Give a person the role, or invite them at it:

```sh
undercroft people set-role --tenant-id CASE-0042 --email lan@example.test --role accountant
undercroft people invite --tenant-id CASE-0042 --email new@example.test --role accountant
```

Grant one permission to a person until the end of 31 October, Singapore time, or to every holder
of a role with no expiry:

```sh
undercroft grants save --tenant-id CASE-0042 --email lan@example.test \
  --permission lake:read --expires-at 2026-10-31T23:59:59+08:00
undercroft grants save --tenant-id CASE-0042 --role member --permission lake:read
```

Let a role read one model, a raw source, or a dashboard -- `--object` instead of `--permission`:

```sh
undercroft grants save --tenant-id CASE-0042 --role sales --object model:fct_sales
undercroft grants save --tenant-id CASE-0042 --role sales --object 'raw:hubspot/*'
undercroft grants save --tenant-id CASE-0042 --role sales --object report:dashboard:<id>
```

Let a role read only Sales's rows of a model, without its salary column. The rule and the hidden
columns are arrays, so they go in the JSON input:

```sh
undercroft grants save --tenant-id CASE-0042 --role sales --object model:fct_sales \
  --input-json '{"rowRule":[{"column":"dept","op":"eq","values":["Sales"]}],"hiddenColumns":["salary"]}'
```

See what a role, a person or you yourself may do and read, before and after a grant -- `grants
reach` for the decision, `scopes preview` for what it comes to, model by model, with each one's
rows, hidden columns and any broken rule:

```sh
undercroft grants reach --tenant-id CASE-0042 --role sales --agent
undercroft grants reach --tenant-id CASE-0042 --email lan@example.test --agent
undercroft scopes preview --tenant-id CASE-0042 --role sales --agent
undercroft scopes preview --tenant-id CASE-0042 --agent
```

List the grants, for everybody or for one subject, and take one away by its `id`:

```sh
undercroft grants list --tenant-id CASE-0042 --email lan@example.test --agent
undercroft grants delete --tenant-id CASE-0042 --id <id from grants list> --yes
```

## Over MCP

The tools are the same procedures with `.` as `_`: `roles_list`, `roles_get`, `roles_save`,
`roles_delete`, `grants_list`, `grants_save`, `grants_delete`, `grants_reach` and `scopes_preview`, beside
`people_setRole` and `people_invite`. Each takes the same input as the CLI command above, as JSON; `roles_save`, `roles_delete`, `grants_save` and `grants_delete` need a connection with a
write grant. An agent with the `undercroft-access-control` skill
([agent skills](agent-skills.md)) turns a sentence such as "let Lan read the raw data until the
end of the month" into one of these calls and asks before making it.

## When it is refused

| Refusal                               | What it means, and what to do                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORBIDDEN`, `PERMISSION_REQUIRED`    | You lack the permission the command itself needs (`roles:manage`, or `people:manage`). Ask someone who holds it.                                    |
| `FORBIDDEN`, `PERMISSION_NOT_HELD`    | The subset rule: `permissions` lists what you would give or take away without holding it. Ask someone who holds those, such as an admin.            |
| `FORBIDDEN`, `REACH_NOT_HELD`         | The subset rule over reading: `objects` lists what you would give or take away without reading it yourself.                                         |
| `FORBIDDEN`, `WHOLE_REACH_REQUIRED`   | The console, a model preview, test failures and changes to models run as the build login, which reads everything: they need `model:*` and `raw:*`.  |
| `NOT_FOUND`, `OBJECT_NOT_FOUND`       | The model, reference table, question or dashboard the object names does not exist. A raw stream need not exist yet.                                 |
| `BAD_REQUEST`, `OBJECT_SHAPE`         | The object is not one a grant can name; the sentence lists the forms.                                                                               |
| `BAD_REQUEST`, `ONE_OBJECT`           | Name exactly one of `--permission` and `--object`.                                                                                                  |
| `BAD_REQUEST`, `COLUMN_NOT_FOUND`     | A rule names a column the model's last build did not find; the sentence lists its columns. A model never built has none: build it first.            |
| `BAD_REQUEST`, `RULES_NEED_ONE_MODEL` | A row rule or hidden columns go only on a grant of one model, never on `model:*`, a permission, raw data or a report.                               |
| `BAD_REQUEST`, `RULE_SHAPE`           | An `eq` condition takes exactly one value; use `in` for several.                                                                                    |
| `CONFLICT`, `GRANT_CHANGED`           | Someone else changed the grant while you saved it; read it again and save again.                                                                    |
| `BAD_REQUEST`, `COLUMN_NOT_GRANTED`   | A query named a column your grants hide, or used `SELECT *` on such a table. Name the columns you may read.                                         |
| `NOT_FOUND`, `ROLE_NOT_FOUND`         | The customer has no role with that key. `roles list` shows the keys.                                                                                |
| `NOT_FOUND`, `NOT_MEMBER`             | A grant to a person needs them to be a member. Invite them first.                                                                                   |
| `CONFLICT`, `ROLE_IN_USE`             | The role is held or named by an open invitation; `members` and `invitations` say how many.                                                          |
| `CONFLICT`, `ROLE_TAKEN`              | `--create` with a key in use. Edit that role, or choose another key.                                                                                |
| `BAD_REQUEST`, `BUILT_IN_ROLE`        | `viewer`, `member`, `builder` and `admin` cannot be saved or deleted. Define a role of your own.                                                    |
| `BAD_REQUEST`, `EXPIRY_PASSED`        | The expiry is not in the future.                                                                                                                    |
| `CONFLICT` on the last admin          | A customer keeps someone holding `admin`. A role of the customer's own never counts as `admin`, whatever it holds: make someone else `admin` first. |

## Not possible yet

- **Rules on raw rows.** A rule goes on a model or reference table; the raw lake is read whole or by
  stream.
- **Rules on a view-materialised model.** A scope login is never granted a view, so a reader of
  fewer than every model cannot read one at all.
- **Conditions other than equals and is one of** -- a range, a pattern, a condition one person
  writes in SQL.
