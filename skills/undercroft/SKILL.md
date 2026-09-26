---
name: undercroft
description: Work in an Undercroft data platform through its MCP tools or its `undercroft` CLI -- list and trigger ingest runs, read the raw lake, manage connections, ingest keys and people, write and build dbt models, save reports and dashboards. Use whenever a task involves an Undercroft deployment (tenants such as CASE-0042, runs, the raw lake, dbt models, BI questions or dashboards), or when a person asks you to do something they would otherwise do in Undercroft's web UI. Read it before any Undercroft workflow skill, such as undercroft-model-builder. Also use it to report a defect you hit in Undercroft as a GitHub issue.
---

# Undercroft

Undercroft is a data platform. Records from sources such as HubSpot, Xero, Gmail and Google
Drive land in an immutable raw lake. People write dbt models over that lake, and reports and
dashboards read the tables the models build.

Everything the web UI does, you can do too, as the person who signed in and never as more.
Every role check and every refusal the web UI has applies to you unchanged.

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

The workflow skills name operations by their procedure path. Translate the path for your
door with this rule.

## How to work

1. **Find the operation before you use it.** Over MCP, read the tool's input schema in the
   tool list. With the CLI, run `undercroft describe <command> --agent`. Never call an
   operation you have not seen listed, and never invent one.
2. **Read before you write, and never guess an ID.** Take a tenant ID from `tenants.list`, a
   run ID from `runs.list`, a model name from `models.list` and a source name from
   `connections.list`. Tenant IDs look like `CASE-0042`. When an ID is not in what you read,
   stop and ask the person. Do not construct one.
3. **Say what you will change, then change it.** Before a `write` or `destructive`
   operation, tell the person what it will do and to what. With the CLI, run it with
   `--dry-run` first.
4. **A destructive operation needs the person's yes for that exact act.** Deleting,
   revoking, disconnecting and removing someone cannot be undone. Over MCP your host may ask
   for confirmation; with the CLI, `--yes` is the confirmation, and you pass it only after the
   person asked for that act.
5. **Report what the platform said, not what you expected.** Success is the operation's
   answer, never your assumption.

## Workflows

Each workflow is its own skill. Follow it when the person's request matches.

- `undercroft-model-builder`: turn a query into a dbt model, or design and build a new model,
  by interviewing the person first and checking the model before it is saved.

## Things only the person can do

- **Sign in.** Over MCP, the host sends the person through Undercroft's own sign-in and
  consent pages. With the CLI, the sign-in code arrives in their inbox:
  `references/cli.md` has the two steps.
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
  state -- a name already taken, a build already running. Tell the person; do not loop.
- **Retry once:** `NETWORK_ERROR` and `TIMEOUT`.
- **Fix, then retry:** `VALIDATION_FAILED`, using the issues in its details.

A refusal is the platform working as designed. `INTERNAL_ERROR`, a value you do not believe,
or an answer that breaks the contract in `references/cli.md` or `references/mcp.md` is a
defect: `references/reporting-a-bug.md` says how to report it.

## Choosing the environment

With the CLI, `undercroft config show --agent` says which server and profile are in use, and
why. When the answer is `CONFIG_REQUIRED`, ask the person which environment they mean.
Never pick one yourself. Over MCP, the server is the one the person connected.
