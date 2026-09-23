---
name: undercroft-cli
description: Operate an Undercroft data platform from the terminal through its `undercroft` CLI -- list and trigger ingest runs, read the raw lake, manage connections, ingest keys, people, dbt models, reports and dashboards. Use whenever a task involves an Undercroft deployment (tenants such as CASE-0042, runs, the raw lake, dbt models, BI questions or dashboards), or when a person asks you to do something they would otherwise do in Undercroft's web UI.
---

# Undercroft CLI

`undercroft` does everything Undercroft's web UI does, through the same API, as the person
who signed in. The commands mirror the platform's API one to one: `runs list`,
`bi questions save`, `connections start-oauth`. Every role check and refusal the web UI
has applies here unchanged. You act as the person, never as more.

## Run it

Always run the CLI through this pinned release, and always pass `--agent`:

<!-- x-release-please-start-version -->

```sh
npx -y --package=https://github.com/muitneliss/undercroft/releases/download/v1.19.0/undercroft-cli-1.19.0.tgz undercroft <command> --agent
```

<!-- x-release-please-end -->

In the rest of this file, `undercroft` means that whole `npx` line. It needs Node 22 or
newer.

`--agent` makes stdout hold exactly one JSON envelope, never prompts, and never uses colour.
Parse stdout as JSON and branch on `ok`, then on `error.code`. The exit code agrees with the
code. `references/cli-contract.md` lists both.

## How to work

1. **Find the command first.** `undercroft describe --agent` lists every command with its
   `effect`: `read`, `write`, `destructive` or `local`. Before you use a command you have not
   used in this session, run `undercroft describe <command> --agent` and read its `input` JSON
   Schema and its `flags`.
2. **Read before you write, and never guess an ID.** Take a tenant ID from `tenants list`, a
   run ID from `runs list`, and a key ID from `keys list`. Tenant IDs look like `CASE-0042`.
   When an ID is not in what you read, stop and ask the person. Do not construct one.
3. **Dry-run every write.** Run a `write` or `destructive` command with `--dry-run` first.
   The dry run checks the input's shape locally and echoes what would be sent, making no
   server call. The server can still refuse the real call; the dry run cannot tell you it will
   not.
4. **Pass `--yes` only when the person asked for that exact destructive act.** Without it a
   destructive command returns `CONFIRMATION_REQUIRED`. That is the question to ask the
   person, not an obstacle to remove.
5. **Pass large or nested input as JSON.** Scalar fields are flags (`--tenant-id`,
   `--source`, `--limit`). Anything nested, such as a model's body, a dashboard or a scope
   selection, goes through `--input -` (stdin), `--input <file>` or `--input-json '<json>'`.
   A typed flag overrides the same field in the JSON.

## Things only the person can do

- **Sign in.** Run `undercroft auth login --email <address> --agent` to have a code emailed.
  The person reads the code from their inbox and runs the second step, or tells you the code:
  `undercroft auth login --email <address> --code <code> --agent`.
- **Allow writes.** Each environment profile has `allowWrites`, off by default, and only a
  person at a terminal can turn it on. When you get `WRITES_DISABLED`, tell the person which
  profile it named. Never try to change the profile yourself: in agent mode that returns
  `HUMAN_REQUIRED`, by design.
- **Open a consent URL.** `connections start-oauth` returns a URL. Give it to the person to
  open in their browser.

## Never retry these

`AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `WRITES_DISABLED`, `HUMAN_REQUIRED` and
`NOT_FOUND` do not change on a retry. Report them to the person with the envelope's
`message`, which is the server's own sentence. `NOT_FOUND` may mean the thing is not yours to
see, and the platform deliberately does not say which. You may retry `NETWORK_ERROR` and
`TIMEOUT` once. You may retry `VALIDATION_FAILED` after fixing the input, using
`error.details`.

## Choosing the environment

`undercroft config show --agent` says which server and profile are in use, and why. Pass
`--profile <name>` to choose a named profile. `--url <url>` is for one-off reads only: it
never allows writes. When the answer is `CONFIG_REQUIRED`, ask the person which environment
they mean. Never pick one yourself.
