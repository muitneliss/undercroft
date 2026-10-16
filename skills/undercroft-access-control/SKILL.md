---
name: undercroft-access-control
description: Turn a request about who may do or see what in an Undercroft customer into the smallest change that grants it, over its MCP tools or its CLI -- give someone a role, define a role of the customer's own, or grant one permission or reading one model, raw stream, report or dashboard to a role or a person, standing or until a date. Use when a person asks to let someone edit models, read the raw lake, manage sources or people, to "make X an admin", to create a role such as an accountant, to let a department see only some models or one dashboard, to give access until the end of the month, to take access away, or asks why someone may not do or see something. It reads what the caller holds and reaches first, asks one question at a time, explains the subset rule, states the plan and asks before every write, checks reach before and after, and says what is not possible yet. Needs the undercroft skill for how to reach the platform.
---

# Who may do what, changed by the smallest step

A request about access is usually a sentence about a person and a task: "let Minh fix the
models", "Lan needs the raw data until the end of the month", "Sales should see only their
dashboard". Undercroft answers it with one of four changes, and the right one is the smallest that
covers the task and no more:

1. **Give the person a role** the customer already has (`people.setRole`, or `people.invite`
   for someone not yet in). A role is a named set of permissions.
2. **Define a role of the customer's own** (`roles.save`), when several people need the same set
   of permissions and no role holds exactly that set.
3. **Grant one permission** to a role or to one person (`grants.save` with `permission`),
   standing or until a moment, when one person needs one more thing, or needs it for a while.
4. **Grant reading one thing** (`grants.save` with `object`): a model or reference table
   (`model:fct_sales`), a raw stream or a whole source (`raw:hubspot/deals`, `raw:hubspot/*`), a
   question or a dashboard (`report:question:<id>`, `report:dashboard:<id>`), or the whole of one
   (`model:*`, `raw:*`, `report:*`).

What a person may DO is their permissions; what they may READ is their **reach**. The four
built-in roles reach everything. A role of the customer's own reaches ONLY what is granted to it,
and a grant to one person adds to whatever their role reaches. So narrowing what someone sees is a
role of the customer's own with object grants -- never a built-in, which sees everything.

Read the `undercroft` skill first. It says how to reach the platform (MCP tools or the CLI), how
an operation is spelled on each door, and what each refusal means. Its `access-control.md`
reference has the permission catalogue, the built-in roles and every procedure each permission
covers. This skill names operations by procedure path.

## Guardrails

1. **Read what the caller holds and reaches before proposing anything.** `grants.reach` with no
   `role` and no `email` answers the caller's own `permissions` and `reach` -- `models`, `raw`,
   `reports`, each `"all"` or the named things. Decide from that answer, never from `role` and
   never from a role's name: a customer's own role is called whatever the customer chose, and
   only its permissions and reach say what it holds. Read what a role holds from `roles.list` or
   `roles.get`, and what it reaches from `grants.reach` with `role`; read what has been granted
   from `grants.list`.
2. **Ask one question at a time**, through the host's question tool when it has one (Claude
   Code's `AskUserQuestion`, for example), otherwise as numbered options. "Which customer?",
   "Which person?", "Until when?" are separate questions. A dismissed question is not a yes.
3. **Map the task to permissions, then to the smallest change.** Name the task's permissions
   first ("fixing models is `models:write`, and reading what they are built over is
   `lake:read`"). Then prefer, in order: a role the customer already has that holds exactly
   those; a grant of the one missing permission; a new role only when the same set is needed by
   more than one person or for good.
4. **State the plan and ask before every write.** Before `roles.save`, `roles.delete`,
   `grants.save`, `grants.delete`, `people.setRole` or `people.invite`, say in one or two
   sentences what will change, for whom, in which customer and until when, and ask. Act only on
   a yes to that exact plan; a changed plan is asked again. With the CLI, run the command with
   `--dry-run` first.
5. **Never grant more than the task needs.** Do not suggest `admin` because it is simplest:
   `admin` also manages people, sources, keys and the customer itself. If the person insists,
   say what else it gives and ask once more.
6. **Stop at a refusal and explain it.** Never work around one -- not with another operation that
   reaches the same thing, and not by asking for someone else's credential.
7. **Removing is a write too.** `grants.delete`, `roles.delete` and `people.removeMember` take
   access away; `people.removeMember` also takes every grant to that person. Each is its own
   act, needs its own yes, and is never folded into another plan.

## Who may make each change

| Change                                     | Needs                                    |
| ------------------------------------------ | ---------------------------------------- |
| Read the roles (`roles.list`, `roles.get`) | membership of the customer, nothing more |
| Read the grants (`grants.list`)            | `people:manage` (it says who holds what) |
| `people.invite`, `people.setRole`          | `people:manage`, and the subset rule     |
| `roles.save`, `roles.delete`               | `roles:manage`, and the subset rule      |
| `grants.save`, `grants.delete`             | `roles:manage`, and the subset rule      |
| `grants.reach` about oneself               | membership of the customer, nothing more |
| `grants.reach` about a role or a person    | `people:manage`                          |

**The subset rule.** Nobody may give, grant or take away a permission they do not hold
themselves, nor reading something they cannot read themselves: `model:*` only by someone who
reads every model, `raw:hubspot/*` only by someone who reads all of that source or the whole lake.
A person who reads only some models cannot invite anyone at a built-in role, since every built-in
reads everything. Inviting someone at a role, or setting someone's role, needs every permission the
role confers; changing someone's role needs every permission of the role they leave as well;
removing a person needs everything they hold. Saving a role needs every permission it will hold
and every one it held; deleting it needs those and every permission granted to it. `admin`
holds everything, so an admin is never stopped by it. The four built-in roles -- `viewer`,
`member`, `builder`, `admin` -- cannot be saved or deleted; the customer defines its own instead.

## The workflow

### 1. Find the ground

Take the customer from `tenants.list`; if the person has several, ask which. Read `tenants.get`
for their `permissions`. Read `roles.list` for the roles the customer has and what each holds.
If the request names a person, find them in `people.members` (this needs `people:manage`); an
address that is not there is invited, not given a role.

### 2. Understand the task

Ask what the person needs to do, not which role they want. Map it to permissions with the
catalogue in the `undercroft` skill's `access-control.md` reference. Three requests, and the
change each ends in:

- **"Cho Minh sửa model" -- let Minh edit models.** Editing models is `models:write`, and Minh
  will read the raw lake they are built over, `lake:read`. The built-in `builder` holds both
  (and `reports:author`), and nothing else. Plan: `people.setRole` with `role: "builder"` for
  Minh's address.
- **"Tạo vai trò Kế toán chỉ xem báo cáo và đọc raw" -- an Accountant role that views reports
  and reads the raw lake.** Viewing reports needs no permission; reading raw is `lake:read`.
  No built-in holds `lake:read` without `models:write`, and several people will hold it, so a
  role of the customer's own: `roles.save` with `key: "ke_toan"`, `label: "Kế toán"`,
  `permissions: ["lake:read"]` and `create: true`. Ask whether they also author reports, which
  would add `reports:author`. Then give it to each person with `people.setRole`.
- **"Cho Lan quyền đọc raw đến cuối tháng" -- Lan may read raw until the end of the month.**
  One person, one permission, for a while: `grants.save` with `email` Lan's address,
  `permission: "lake:read"` and `expiresAt` the last moment of the month as an ISO 8601 instant
  with its offset, such as `2026-10-31T23:59:59+08:00` (Singapore time, which every date in
  Undercroft is shown in). Say the date back in words before asking.
- **"Cho phòng Sales chỉ xem model fct_sales" -- let the Sales department see only the model
  `fct_sales`.** Narrowing what people see needs a role of the customer's own, because every
  built-in sees everything. Plan: `roles.save` with `key: "sales"`, `label: "Sales"`,
  `permissions: []` (add `reports:author` if they write their own questions) and `create: true`;
  then `grants.save` with `role: "sales"` and `object: "model:fct_sales"`; then `people.setRole`
  for each person. Ask which reports they should open: a report is reached by its own grant
  (`object: "report:dashboard:<id>"`, and one per question on it, ids from
  `bi.dashboards.list` and `bi.questions.list`), and opening one never widens what it reads --
  a question over a model they do not reach is refused. Check the model name in `models.list`
  first; a name the customer lacks is refused.
- **"Cho Minh xem dữ liệu HubSpot" -- Minh may read the HubSpot data in the raw lake.** One person,
  one permission and one source: `grants.save` with `permission: "lake:read"`, then with
  `object: "raw:hubspot/*"`, both to Minh's address. A built-in role already reaches the whole
  lake, so if Minh holds one, the permission alone is the change -- `grants.reach` says which.

### 3. Check the caller can make the change, and what the person reaches now

Compare what the change involves with the caller's own `permissions` and `reach`. When the caller
lacks one, say so before proposing it: name the permission or the object, say that only someone
who holds it can make this change, and suggest who -- someone with `admin` in this customer always
can. Do not stop at "you cannot": if part of the request is within reach, offer that part.

For a change to what someone reads, read their reach first -- `grants.reach` with `role` or
`email` -- and say it in a sentence ("Sales reads every model today, because its role was given
`model:*`"), so the plan says what changes rather than only what is added. To narrow a role that
was given a whole (`model:*`), the change is taking that grant away (`grants.delete`) and granting
the named things, each its own act.

### 4. State the plan, ask, then write

Show the plan (guardrail 4), get a yes, and make the one call. Report what the platform
answered: `roles.save` and `grants.save` answer `unchanged: true` when what was sent is what was
stored already, which is not a change to announce. After a grant, the person holds it from their
next request; there is nothing to wait for.

### 5. Confirm from the platform

Read back what changed: `roles.get` for a role, `grants.list` for a grant (an expired one is
listed with `expired: true` and holds nothing), `people.members` for a role given, and
`grants.reach` for what the role or the person reads now. Say what the person can now do and see,
in terms of the task they asked about.

## Refusals

- **`PERMISSION_DENIED` with `reason: "PERMISSION_REQUIRED"`**: the caller lacks the permission
  the operation itself needs -- `roles:manage` to save a role, `people:manage` to set a role or
  read the grants. Its `permission` names it. Say so, and that someone holding it in this
  customer can do it or give it to them.
- **`PERMISSION_DENIED` with `reason: "PERMISSION_NOT_HELD"`**: the subset rule. The caller may
  make this kind of change, but not with these permissions: `permission` is the first one they
  lack and `permissions` all of them, comma-separated. Explain the rule in one sentence and
  suggest someone who holds them.
- **`PERMISSION_DENIED` with `reason: "REACH_NOT_HELD"`**: the subset rule over reading. The
  caller holds every permission involved but cannot read `object` (the first) or `objects` (all,
  comma-separated) themselves. Explain it, and suggest someone who reads them.
- **`PERMISSION_DENIED` with `reason: "WHOLE_REACH_REQUIRED"`**: the raw console, a model preview,
  test failures and every change to the models, macros and reference tables run as the
  customer's build login, which reads everything, so they need `model:*` and `raw:*` beside their
  permission. `objects` names the wholes missing. A narrow role is refused them by design; say so.
- **`NOT_FOUND` with `reason: "OBJECT_NOT_FOUND"`**: the model, reference table, question or
  dashboard the object names does not exist. Read the list it would come from; never guess a name
  or an id.
- **`VALIDATION_FAILED` with `reason: "OBJECT_SHAPE"`** or **`"ONE_OBJECT"`**: the object is not
  one a grant can name (a `*` stands only for a whole: `model:fct_*` is refused), or the call named
  both or neither of `permission` and `object`.
- **`NOT_FOUND` with `reason: "ROLE_NOT_FOUND"`**: the customer has no role with that key. Read
  `roles.list`; never guess a key.
- **`NOT_FOUND` with `reason: "NOT_MEMBER"`**: the address holds no role in this customer. A
  grant goes only to a member: invite them first.
- **`CONFLICT` with `reason: "ROLE_IN_USE"`**: a role is not deleted while anyone holds it or an
  open invitation names it; `members` and `invitations` say how many. Moving those people is a
  plan of its own.
- **`CONFLICT` with `reason: "ROLE_TAKEN"`**: `create: true` and the key is in use. Read the role
  with `roles.get` and ask whether to change that one or choose another key.
- **`VALIDATION_FAILED` with `reason: "BUILT_IN_ROLE"`**: a built-in cannot be changed. Offer a
  role of the customer's own.
- **`VALIDATION_FAILED` with `reason: "EXPIRY_PASSED"`**: the expiry is not in the future.
- **`CONFLICT` on `people.setRole` or `people.removeMember` for the last admin**: a customer must
  keep someone holding `admin`. A role of the customer's own never counts as that, whatever it
  holds.

## Not possible yet

Say so plainly when asked, rather than approximating with something broader:

- **Rules on rows or columns** -- "only Hanoi's invoices", "hide the salary column". Not
  available; a grant on a model reads all of it, and what a model selects is the only way to
  narrow what a report shows today.
- **Writing only some models.** `models:write` changes the whole dbt project, which reads every
  model and the raw lake, so it needs `model:*` and `raw:*`; there is no "edit only `fct_sales`".
- **A grant across customers.** Every role, grant and permission holds in one customer.
