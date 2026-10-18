# 146. Each division of a book reads under its own permission

- Status: Accepted
- Date: 2026-10-18
- Extends: [ADR 0139](0139-tenant-access-is-casbin-policy.md), whose `requires` on a division
  only People used: Sources, the Journal, the Lake and Models now each require one, and the
  catalogue gains the three read permissions they need.
- Follows: [ADR 0119](0119-who-has-access-is-read-by-an-admin-alone.md), whose argument it applies
  to four more divisions: hiding a tab closes nothing, because the CLI, `/mcp` and the assistant
  call the router, so the gate is on the procedure and the tab only says so.
- Supersedes, in part: [ADR 0086](0086-a-tenant-writes-its-own-macros.md), where `macros.list`,
  `macros.get` and `macros.check` are open to any member: they need `models:read`.
- Supersedes, in part: [ADR 0092](0092-lineage-draws-only-declared-relations.md), where
  `models.lineage` has `models.list`'s gate, "any member of the customer": that gate is now
  `models:read`, so lineage's is too.
- Supersedes, in part: [ADR 0128](0128-a-tenant-keeps-its-own-reference-tables.md), where
  `seeds.list` and `seeds.get` are for any member: they need `models:read`.
- Supersedes, in part: [ADR 0085](0085-a-document-is-classified-into-its-tenants-own-catalogue-of-kinds.md),
  where `documentKinds.list` is a member's: it needs `lake:read`.
- Keeps: Reports and every read behind it, open to every member as before; reach (ADR 0142) and
  the row and column rules on it (ADR 0143), which still narrow every read here; the 404-not-403
  boundary and the deactivated-customer refusal, which come before any permission.

## Context

Issue 487. Only People was gated by a permission. Sources, the Journal, the Lake and Models opened
for every member, a viewer included, and the procedures behind them asked for nothing: a model's
SQL, every macro and reference table, the lineage, the run history with each run's refusals and
the scope it read with, every connection's schedule and chosen scope, and how much of each stream
had landed. `lake.summary` was open on purpose -- its docstring and `lake.test.ts` said "a viewer
reads counts" -- and so were the rest, by default: when they were written, a member was someone
who worked on the customer's data.

Since ADR 0139 a role is a set of permissions, and since ADR 0141 a customer defines its own. A
viewer is now typically someone who reads the customer's reports and nothing else -- a client's
manager, an auditor -- and every procedure above was theirs through the CLI and an MCP client
whatever the browser drew. A customer could not make a role that reads Reports without reading how
every number in them was built and from which accounts.

## Decision

- **Three read permissions join the catalogue**: `models:read` (Models: `models.list`, `.get`,
  `.revision`, `.check`, `.lineage`, `.reference`, `macros.list`, `.get`, `.check`, `seeds.list`,
  `.get`), `runs:read` (the Journal: `runs.list`, `.get`, `.events`) and `sources:read` (Sources:
  `connections.list`, `.get`). The Lake uses the `lake:read` it already had, and `lake.summary`
  and `documentKinds.list` -- the catalogue is a page of the Lake -- now need it too. Each is a
  `requirePermission` on the procedure, so every door is closed by the same line and every
  procedure's sentence says what it needs, read off the gate.
- **`models.revision` is a read of the project.** It hashes the questions as well as the models,
  macros and seeds, but its one reader is the model-builder workflow deciding whether what it read
  is current; a reader of Reports alone reads `bi.questions.list`'s own hashes.
- **`models.check` needs `models:read`, not nothing**: its findings name the models and macros the
  project holds. It still needs no `models:write` -- it is advisory and changes nothing.
- **The built-ins**: `viewer` and `member` hold none of the three, and open Customers and Reports
  alone; `builder` holds all three beside `models:write` and `lake:read`, because a model is fixed
  by reading what was connected, what was read and what the last build did, and connecting and
  running stay `sources:manage`; `admin` holds them by construction.
- **Each division `requires` its permission** (`apps/ui/src/lib/divisions.ts`): Sources
  `sources:read`, the Journal `runs:read`, the Lake `lake:read`, Models `models:read`. `closedTo`,
  the tab rail, the customer's directory and `Book`'s notice already read `requires`, so a closed
  division turns face-down and names its own permission with no new code.
- **A book opens where its reader can read.** "Open" on the customer list opened at Sources, which
  would now open every book onto a notice for a viewer; it opens at the first division in ring
  order open to the reader (`bookPath`), which is Sources for everyone who may read it.
- **A read that crosses divisions degrades, never refuses.** The Journal, the Lake and a run's leaf
  read the connections to name which mailbox of two a run read; for a reader without
  `sources:read` they ask nothing and draw what they draw before the list arrives (`useAccounts`).
  The grant form lists models and reference tables only for a holder of `models:read` and streams
  only for one of `lake:read`, and still offers the wildcards, the reports and a typed name. Each
  asks `can(permissions, …)`, never a role.
- **No migration.** A role's `permissions` is `text[]` with no catalogue CHECK, and a grant's
  object matches `^perm:[a-z]+:[a-z]+$`; a built-in's grants are code. Nor one for a customer's
  own role that holds a write and not its new read: on 2026-10-18 the deployed instance held no
  customer-defined role and no permission grant, so no stored role loses a read it had.

## Consequences

- A viewer's and a member's CLI, MCP client and assistant are refused these reads by name
  (`FORBIDDEN`, `PERMISSION_REQUIRED`, the permission); the assistant's `sourceStatus`,
  `recentRuns`, `runDetail`, `lakeSummary` and `listModels` say "Needs …" in their descriptions
  and refuse themselves through the router.
- A viewer's and a member's tab rail shows Sources, the Journal, the Lake and Models face-down, as
  People already was; the visual baselines that render a book as a viewer show it.
- A customer's own role can read Reports and the Journal without the sources, or the models
  without the lake. One that holds `tenant:manage` or `keys:manage` without `sources:read` cannot
  open Sources, where the rename, deactivation and ingest-key forms are; the built-ins never split
  these.
- A run's leaf still links an ingest to Sources and a build to Models for a reader of the Journal
  alone; the link opens on the closed division's notice, which names what is missing.
- ADR 0091's "a member or viewer sees a run's counts as plain figures" describes a page they no
  longer open; for a reader of the Journal without `lake:read` it holds as written.

## Options rejected

- **Reuse the write permissions for the reads** -- `models:write` opens Models, `sources:manage`
  opens Sources and the Journal. It needs nothing new, and it is wrong twice: the builder would
  lose Sources and the Journal, which they read to fix a model and must not manage, and reading
  would require being able to write, so no role could read the models without saving them.
- **One read permission for all four divisions.** Fewer words, and too coarse for exactly what a
  customer's own role is for: reading the run history without the models' SQL, or the models
  without the raw lake's counts. Four divisions, four questions a customer may answer differently.
- **Gate the tabs and leave the procedures open.** What ADR 0119 rejected for People: every door
  but the browser would still read them.
- **Leave `lake.summary` open, as "only counts".** Which streams a customer lands and how much of
  each says which systems it uses and how large it is, and it is the Lake division's first screen;
  a division whose first screen needed no permission would open for everyone and print nothing
  else.
