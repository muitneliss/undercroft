---
name: undercroft-cli
description: Operate an Undercroft data platform from the terminal through its `undercroft` CLI -- list and trigger ingest runs, read the raw lake, manage connections, ingest keys, people, dbt models, reports and dashboards. Use whenever a task involves an Undercroft deployment (tenants such as CASE-0042, runs, the raw lake, dbt models, BI questions or dashboards), or when a person asks you to do something they would otherwise do in Undercroft's web UI. Also use it to report a defect you hit in Undercroft as a GitHub issue.
---

# Undercroft CLI

`undercroft` does everything Undercroft's web UI does, through the same API, as the person
who signed in. The commands mirror the platform's API one to one: `runs list`,
`bi questions save`, `connections start-oauth`. Every role check and refusal the web UI
has applies here unchanged. You act as the person, never as more.

## Install it

This file is written for one release of the CLI, and this line installs it:

<!-- x-release-please-start-version -->

```sh
v=1.40.0; npm install -g "https://github.com/muitneliss/undercroft/releases/download/v$v/undercroft-cli-$v.tgz"
```

<!-- x-release-please-end -->

Before your first command in a session, run `undercroft --version`. It prints
`undercroft/<version> <platform> <node>`.

- **It prints the version in the line above.** The CLI is ready.
- **The command is not found.** Tell the person you are installing the Undercroft CLI, then
  run the line above.
- **It prints a different version.** The person installed another release. Ask them before
  you replace it with the line above, because this file's commands and error codes are the
  ones that release has.
- **`npm install -g` fails with `EACCES`.** Do not use `sudo`. Run each command through `npx`
  from the same URL instead:
  `npx -y --package="<the URL above, with the version filled in>" undercroft <command> --agent`.

The CLI needs Node 22 or newer. When `node --version` is older, stop and tell the person.

## Run it

Always pass `--agent`. It makes stdout hold exactly one JSON envelope, never prompts, and
never uses colour. Parse stdout as JSON and branch on `ok`, then on `error.code`. The exit
code agrees with the code. `references/cli-contract.md` lists both.

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
  open in their browser. Pass `--add-account` to connect a further Gmail or Drive account.
  Each further account is its own source, such as `gmail.3fa9c1d2e0ab`, and every `--source`
  flag takes that full name. Take it from `connections list`; never build one.

## Never retry these

`AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `WRITES_DISABLED`, `HUMAN_REQUIRED` and
`NOT_FOUND` do not change on a retry. Report them to the person with the envelope's
`message`, which is the server's own sentence. `NOT_FOUND` may mean the thing is not yours to
see, and the platform deliberately does not say which. You may retry `NETWORK_ERROR` and
`TIMEOUT` once. You may retry `VALIDATION_FAILED` after fixing the input, using
`error.details`.

## Reporting a problem

When Undercroft itself fails, file a bug so a maintainer can fix it. Do not only work around
it. The report goes through the repository's bug form, so it reaches triage in the shape the
maintainers asked for.

**What to report.** Report these:

- `INTERNAL_ERROR`, which means the server failed.
- `NETWORK_ERROR` or `TIMEOUT` that is still there after your one retry, once the person
  confirms the server is up.
- `VALIDATION_FAILED` on input that matches the schema `undercroft describe <command>` gave
  you. That means the CLI and the server disagree.
- Output that breaks `references/cli-contract.md`. For example, stdout that is not exactly
  one JSON envelope, an exit code that does not match `error.code`, a code missing from the
  table, or an amount sent as a number instead of a string.
- A value you do not believe. For example, a run that says `succeeded` with no records
  behind it, or two reads that contradict each other. A wrong value that looks right is the
  worst kind of bug.

Do not report a refusal. Codes such as `AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`,
`WRITES_DISABLED`, `HUMAN_REQUIRED`, `NOT_FOUND`, `CONFIRMATION_REQUIRED` and
`CONFIG_REQUIRED` mean the platform is working as designed. Do not report your own mistakes
either, such as a flag you misspelled.

**A security problem never goes in a public issue.** Examples are seeing another tenant's
data, a write that got past `allowWrites`, or a secret in an envelope. Stop, and give the
person
`https://github.com/muitneliss/undercroft/security/advisories/new`.

**How to file:**

1. **Search first:**
   `gh issue list --repo muitneliss/undercroft --state all --search "<code or key words>"`.
   If the bug is already filed, give the person its link instead of filing it again.
2. **Read the form; do not work from memory.** Fetch it with
   `curl -fsSL https://raw.githubusercontent.com/muitneliss/undercroft/main/.github/ISSUE_TEMPLATE/bug_report.yml`.
   Fill every `required` field. For the questions that offer choices, use one of the listed
   options word for word. For "Where did you see it?", that is
   `CLI in agent mode (Claude Code, Codex or another agent)`.
3. **Collect the facts; do not guess them.** You need the exact command you ran, the whole
   failure envelope, `undercroft --version`, `node --version`, the operating system, and
   the server's host from `undercroft config show --agent`. The envelope's `error.traceId`,
   when present, goes in the form's **Trace ID** field as well as in the envelope: it is
   what the operator looks the failure up by. For the server's version and
   the person's role, ask the person. If a fact is not known, write "unknown".
4. **Redact.** The repository is public. Replace real tenant IDs, e-mail addresses, names
   and record contents with `CASE-0042` and `acme@example.test`. Never include a sign-in
   code, a cookie, a token or anything from `credentials.json`. An envelope never holds a
   secret, but its `message` can quote real data.
5. **Show the person the redacted draft and file it only after they agree.** Filing
   publishes it. Then run:
   `gh issue create --repo muitneliss/undercroft --title "bug: <one line>" --label bug --body-file -`.
   Write the body as the form would render it. That is one `### <field label>` heading per
   field, in the form's order, with `_No response_` under an optional field you leave
   empty. Put the envelope in a fenced block.
6. **If `gh` is missing or not signed in,** give the person a link to the form with the
   title and the text fields filled in, and let them submit it:
   `https://github.com/muitneliss/undercroft/issues/new?template=bug_report.yml&title=<title>&what-happened=<text>&expected=<text>&steps=<text>&trace-id=<traceId>&logs=<envelope>`.
   URL-encode each value.

Then tell the person the issue's URL. If a workaround exists, carry on with the task. If
not, stop there.

## Choosing the environment

`undercroft config show --agent` says which server and profile are in use, and why. Pass
`--profile <name>` to choose a named profile. `--url <url>` is for one-off reads only: it
never allows writes. When the answer is `CONFIG_REQUIRED`, ask the person which environment
they mean. Never pick one yourself.
