---
name: undercroft
description: Work in an Undercroft data platform through its MCP tools or its `undercroft` CLI -- list and trigger ingest runs, read the raw lake, manage connections, ingest keys and people, write and build dbt models, save reports and dashboards, and find documents by what they are (an invoice, a contract, a KYC form) through the customer's catalogue of document kinds. Use whenever a task involves an Undercroft deployment (tenants such as CASE-0042, runs, the raw lake, dbt models, BI questions or dashboards), or when a person asks you to do something they would otherwise do in Undercroft's web UI. Read it before any Undercroft workflow skill, such as undercroft-model-builder. Also use it to report a defect you hit in Undercroft as a GitHub issue.
---

# Undercroft

Undercroft is a data platform. Records from sources such as HubSpot, Xero, Gmail and Google
Drive land in an immutable raw lake. People write dbt models over that lake, and reports and
dashboards read the tables the models build.

Everything the web UI does, you can do too, as the person who signed in and never as more.
Every role check and every refusal the web UI has applies to you unchanged.

## Words the platform uses

- **Model**: a dbt `SELECT` over the raw lake, built into a table in the tenant's analytics
  schema. The logic lives here: joins, deduplication, time zones, what a metric means. A
  model changes only when it is built -- after each successful ingest, or by
  `models.build`.
- **Macro**: a named piece of dbt Jinja a model calls, such as `{{ parse_amount(...) }}`.
  The platform ships a few into every project; a customer's admin can save the customer's
  own with `macros.save`, and every model of that customer can then call it. Reuse one
  (`macros.list`) before writing the same expression into a second model.
- **Question** (_câu hỏi_ in Vietnamese): a saved query over the built models, either a
  visual definition or SQL, together with how to draw it as a table or a chart. It is what
  other BI tools call a saved query, a chart or a Look; the name comes from Metabase, the BI
  Undercroft used before its own. A question runs when it is read (`bi.questions.answer`),
  so it is as fresh as the model's last build, never fresher. Keep it thin: pick, filter,
  group and sort one model. Logic a second question would repeat belongs in a model.
- **Dashboard**: saved questions on a grid, under shared filters.
- **Document kind**: what a document is -- `invoice`, `contract`, `kyc_form`, `other` -- from
  the customer's own catalogue of kinds. A classifier assigns one to every readable file,
  attachment and mail body in the background, so "find the KYC forms" is a filter, not a
  keyword search. Read `references/document-kinds.md` before you answer with a kind or change
  the catalogue: publishing a catalogue sends every document to the classifier again.

When a person finds the word "question" odd, tell them what it is. Do not rename it in
what you save.

## Choose a door

There are two doors onto the same operations. Use whichever this session has.

- **MCP.** If your tools include ones from an `undercroft` MCP server, such as
  `tenants_list` or `models_check`, use them. `references/mcp.md` covers connecting,
  grants and how a result or a refusal arrives.
- **The CLI.** Otherwise, if you can run commands, use `undercroft`. `references/cli.md`
  covers installing it, `--agent`, `--dry-run` and the exit codes.

If you have neither, tell the person. Do not reach Undercroft any other way: no database
connection, no HTTP call you build yourself.

## One operation, three spellings

Every operation is a procedure with a dotted path, and both doors spell it mechanically:

| Procedure           | MCP tool            | CLI command                    |
| ------------------- | ------------------- | ------------------------------ |
| `models.check`      | `models_check`      | `undercroft models check`      |
| `bi.questions.save` | `bi_questions_save` | `undercroft bi questions save` |
| `lake.querySchema`  | `lake_querySchema`  | `undercroft lake query-schema` |
| `macros.save`       | `macros_save`       | `undercroft macros save`       |

The workflow skills name operations by their procedure path. Translate the path for your
door with this rule.

## How to work

1. **Find the operation before you use it.** Over MCP, read the tool's input schema in the
   tool list. With the CLI, run `undercroft describe <command> --agent`. Never call an
   operation you have not seen listed, and never invent one.
2. **Read before you write, and never guess an ID.** Take a tenant ID from `tenants.list`, a
   run ID from `runs.list`, a model name from `models.list`, a macro name from `macros.list`
   and a source name from `connections.list`. Tenant IDs look like `CASE-0042`. When an ID is not in what you read,
   stop and ask the person. Do not construct one.
3. **Name the target of a read.** A whole tenant's lineage, schema or Drive folders is more
   than your context will hold. `models.lineage` takes a `name` (a model, or a raw table as
   `raw.records`) with `direction` and `depth`; `bi.schema` and `lake.querySchema` take
   `tables` or `match`, and `columns: false` for names alone; `connections.browseScope` takes
   `parentId` (`null` for the top level), `query`, `limit` and `cursor`. A name that is not
   there is refused as `NOT_FOUND`, never answered empty; a browse's `partial` still says when
   the listing behind a page was incomplete.
   The lists answer summaries. `models.list`, `macros.list`, `bi.questions.list` and
   `connections.list` take `names` or `match`, and leave out each item's body: a question's
   definition, a connection's chosen names, a build's columns, a macro's definition. Ask
   `include` for one only when you need it (`include: ["definition", "chart"]`,
   `["config"]`, `["columns"]`), or `get` the one item. `models.reference` takes `parts`:
   ask for `["tenantMacros"]` alone, since the other two parts never change.
4. **Say what you will change, then change it.** Before a `write` or `destructive`
   operation, tell the person what it will do and to what. With the CLI, run it with
   `--dry-run` first.
5. **A destructive operation needs the person's yes for that exact act.** Deleting,
   revoking, disconnecting and removing someone cannot be undone. Over MCP your host may ask
   for confirmation; with the CLI, `--yes` is the confirmation, and you pass it only after the
   person asked for that act.
6. **Report what the platform said, not what you expected.** Success is the operation's
   answer, never your assumption.

## Runs

- **Ask for the run you want, not every run.** `runs.list` narrows by `kind` (one or several),
  `status`, `trigger`, `parentRunId`, `chained`, `startedAfter` / `startedBefore` and up to 50
  `ids`, in any combination. "The last failed build" is `kind: ["build"]`, `status: "failed"`,
  `limit: 1`; "the transform that ingest started" is `parentRunId: <the ingest's id>`. An
  empty page means nothing matched.
- **Wait with `runs.get`, never with a loop.** After `runs.trigger`, call `runs.get` with its
  `runId` and `waitSeconds` (at most 50). It answers as soon as the run is no longer
  `running`; an ingest that ended `ok` names the transform it started in `childRun`, which you
  wait for the same way. When the wait runs out the run still says `running`, and you call
  again. Do not sleep and list runs in a shell loop.
- **Read a run's steps from its summary.** `runs.get` answers with `stepSummary` -- every dbt
  step counted by kind and status -- and lists only the steps that did not pass. Ask for
  `steps: "all"`, or narrow with `stepStatus`, `stepKind` or `stepName`, only when you need
  more, and page with `stepCursor`. A `skipped` step is not a pass.

## Workflows

Each workflow is its own skill. Follow it when the person's request matches.

- `undercroft-model-builder`: for a person who wants a model, a report or a dashboard, or
  wants to know what their data can answer. It first finds out what the tenant already has
  and what the person needs, and whether the right outcome is a look at the data, a report
  over existing models, a change to an existing model or macro, or a new model -- then gets
  a plan approved before any write, and checks a model before it is saved.

## Things only the person can do

- **Sign in.** Over MCP, the host sends the person through Undercroft's own sign-in and
  consent pages. With the CLI, the sign-in code arrives in their inbox:
  `references/cli.md` has the two steps. A desktop install on the person's own machine needs
  no code, and `references/cli.md` says how.
- **Allow writes.** An MCP connection carries a read or write grant the person chose. A CLI
  profile has `allowWrites`, off by default, which only a person at a terminal can turn on.
  A refusal for either reason is the person's decision to make. Never try to change it.
- **Open a consent URL.** `connections.startOAuth` returns a URL for the person to open in
  their browser. A further Gmail or Drive account is its own source, such as
  `gmail.3fa9c1d2e0ab`; take that full name from `connections.list`, never build one.

## Refusals

Both doors refuse with the same codes. Branch on the code, and give the person the
`message`, which is the server's own sentence in their language.

- **Never retry:** `AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `WRITES_DISABLED`,
  `HUMAN_REQUIRED` and `NOT_FOUND`. They do not change on a retry. `NOT_FOUND` may mean the
  thing is not yours to see, and the platform deliberately does not say which.
- **Ask first:** `CONFLICT` means the platform's state refused it, and the message says which
  state -- a name already taken, a build already running. Tell the person; do not loop. A
  customer an admin has deactivated refuses every operation this way, with
  `TENANT_DEACTIVATED` in the details, until an admin reactivates it (`tenants.reactivate`).
  `tenants.get` still answers, and its `deactivatedAt` says since when. Reactivating is the
  admin's decision: ask them, never reactivate a customer to finish a task.
- **Retry once:** `NETWORK_ERROR` and `TIMEOUT`.
- **Fix, then retry:** `VALIDATION_FAILED`, using the issues in its details. A `lake.search`
  that ran past its time limit is refused this way with no issues. The same search will stop
  again, so do not repeat it. Narrow it: one kind, more words, or a quoted phrase.

`lake.search` ranks only each kind's newest matches. When a kind had more, the answer's
`capped` names it and how many were ranked. Matches older than those are on no page, so tell
the person rather than reading the result as everything that matched.

A refusal is the platform working as designed. `INTERNAL_ERROR`, a value you do not believe,
or an answer that breaks the contract in `references/cli.md` or `references/mcp.md` is a
defect: `references/reporting-a-bug.md` says how to report it.

## Choosing the environment

With the CLI, `undercroft config show --agent` says which server and profile are in use, and
why. When the answer is `CONFIG_REQUIRED`, ask the person which environment they mean.
Never pick one yourself. Over MCP, the server is the one the person connected.
