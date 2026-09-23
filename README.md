<!-- The device, from apps/ui/public. Absolute raw URLs, not repository-relative
     ones: GitHub rewrites a relative path only for markdown image syntax, and
     leaves it alone inside raw HTML -- where it then resolves against the blob
     page and loads an HTML document instead of the mark. The reversed cut is
     for GitHub's dark theme, which the ink block would disappear into. -->
<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="https://raw.githubusercontent.com/muitneliss/undercroft/main/apps/ui/public/mark-reversed.svg"
  />
  <img
    src="https://raw.githubusercontent.com/muitneliss/undercroft/main/apps/ui/public/mark.svg"
    alt=""
    width="64"
    height="64"
  />
</picture>

# Undercroft

> An immutable raw lake, declarative connectors, and a schema you define yourself.

An _undercroft_ is the vaulted chamber beneath a building — the part that holds
everything up and outlives what stands on it. That is the whole architecture in one
word: the raw lake is the only durable layer, and everything above it is a projection
you can drop and rebuild.

**Status: pre-alpha.** Under active construction; nothing is stable yet.

## What it does

Connect your accounts, declare what to pull in YAML, and write your own SQL on top.

```
  your APIs ──▶ raw lake (S3/MinIO)  ──▶  raw.records (Postgres)  ──▶  dbt  ──▶  BI
              immutable, content-addressed      one generic table      your models
```

- **The raw lake is create-only and content-addressed.** Re-storing identical bytes
  writes nothing. Nothing is ever overwritten in place. It is the one layer that cannot
  be recomputed, so it is the one layer treated as durable.
- **Connectors are YAML, not code.** Base URL, auth, pagination, entities, cursors.
  Adding a REST source needs no migration and no pull request.
- **No business schema ships.** Records land in one generic table; every table above it
  is a dbt model you wrote. Undercroft has no opinion about what a "customer" is.
- **Multi-tenant.** Per-tenant credentials sealed with AES-256-GCM, and a control-plane
  UI where someone connects their own accounts.
- **Anything can ingest.** A REST lake API means a shell script or an orchestrator can
  land data too — through the same create-only, content-addressed path.
- **Documents, not only records.** Gmail and Drive are first-party collectors, because a
  PDF is bytes and a YAML spec cannot describe bytes. Their text is extracted and lands
  beside the records.
- **Search the whole lake.** One box over both payloads and document text, folded so that
  Vietnamese matches with or without tone marks, and stemmed for English.
- **The BI is first-party.** Questions and dashboards live in the Reports division, and
  every one runs as the tenant's own read-only login — not as the web process.
- **An assistant with exactly your permissions.** It reaches the platform's own procedures
  through the real role gates, so it can refuse you; a change is proposed as a proof you
  strike, and a separate model checks you asked for it before one is ever offered.
- **A CLI for people and agents.** `undercroft` does everything the web UI does, one command
  per API procedure, as the person who signed in — never more. Writes stay off per
  environment until a person turns them on.

## From a terminal, or from an agent

A person runs it through the release it ships in, with Node 22 or newer. Below,
`undercroft` stands for
`npx -y --package=https://github.com/muitneliss/undercroft/releases/download/vX.Y.Z/undercroft-cli-X.Y.Z.tgz undercroft`:

```sh
undercroft config set-profile prod --url https://undercroft.example.test
undercroft auth login          # the same emailed code as the web sign-in
undercroft runs list           # asks which customer
```

An agent such as Claude Code or Codex gets it as a skill, which runs the pinned release with
`--agent`, so every answer is one JSON envelope:

```sh
npx skills add muitneliss/undercroft --skill undercroft-cli --agent claude-code -y
```

Signing in and allowing writes stay a person's job. The CLI refuses an agent that tries
either. See [docs/runbook/cli.md](docs/runbook/cli.md) and
[ADR 0044](docs/adr/0044-an-agent-reaches-undercroft-as-a-caller.md).

## Design rules

1. **Raw is the only durable layer.** Everything in Postgres is a projection and may be
   dropped and rebuilt. Raw cannot be recomputed.
2. **Never guess; return nothing and say why.** An empty cell is visibly missing; a wrong
   value is invisibly false. "No evidence" is never "pass". Money is a string end to end,
   and an unreadable amount is `null`, never `0`.
3. **One writer, many callers.** Every byte enters through the lake's create-only path,
   whatever called it.

## Stack

TypeScript on [Bun](https://bun.sh), end to end. Postgres, S3/MinIO,
[Kestra](https://kestra.io) for scheduling, [dbt](https://getdbt.com) for transforms, and
charts in the control plane itself — plus a read-only Postgres role for any BI tool you
would rather point at it.

## Development

Every operation goes through [Task](https://taskfile.dev) (`brew install go-task` or see
[the install docs](https://taskfile.dev/installation)) — never a bare `bun run` typed by
hand. `task --list-all` enumerates everything; see `.claude/rules/tooling.md` for why.

```sh
bun install
task ci:verify      # typecheck, lint, format, tests -- offline, no credentials needed
task dev:run        # the whole local stack -- Postgres, MinIO, Kestra, the worker, the
                     # control plane, the UI -- with hot reload, one command
task dev:cli -- describe   # build the CLI and run it against your local stack
```

`ci:verify` is the gate and runs with no Docker, no network and no credentials. `task
ci:itest` adds the Docker-backed integration tier.

Signing in to the control plane is **invite-only**, by Google or a one-time code.
[docs/runbook/sign-in-setup.md](docs/runbook/sign-in-setup.md) walks through the OAuth client,
the mail key, the first invitation, and how to check each step actually worked.

## License

MIT
