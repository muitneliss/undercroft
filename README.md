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

[![CI](https://github.com/muitneliss/undercroft/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/muitneliss/undercroft/actions/workflows/ci.yml)
[![Release](https://github.com/muitneliss/undercroft/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/muitneliss/undercroft/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/muitneliss/undercroft?sort=semver)](https://github.com/muitneliss/undercroft/releases/latest)
[![License: MIT](https://img.shields.io/github/license/muitneliss/undercroft)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-only-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CLI: Node 22+](https://img.shields.io/badge/CLI-Node%2022%2B-5fa04e?logo=nodedotjs&logoColor=white)](docs/runbook/cli.md)
[![Agent skill](https://img.shields.io/badge/npx%20skills-undercroft--cli-000000)](skills/undercroft-cli/SKILL.md)

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
  Adding a REST source needs no migration and no pull request. HubSpot and Xero ship as
  examples in `specs/connectors/`.
- **No business schema ships.** Records land in one generic table; every table above it
  is a dbt model you wrote. Undercroft has no opinion about what a "customer" is.
- **Multi-tenant.** Per-tenant credentials sealed with AES-256-GCM, and a control-plane
  UI where someone connects their own accounts.
- **Anything can ingest.** A REST lake API means a shell script or an orchestrator can
  land data too — through the same create-only, content-addressed path.
- **Documents, not only records.** Gmail and Drive are first-party collectors, because a
  PDF is bytes and a YAML spec cannot describe bytes. Their text is extracted and lands
  beside the records. A tenant can connect several mailboxes and drives, and each one is a
  source of its own.
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

The `undercroft` CLI needs Node 22 or newer. Use either of the two ways below to get it.
Choose by who will type the commands, you or your agent.

### Install it yourself

```sh
npm install -g https://github.com/muitneliss/undercroft/releases/latest/download/undercroft-cli.tgz
undercroft --help
```

That installs the newest release. Run the same line again to upgrade, and run
`npm uninstall -g undercroft-cli` to remove it. To install one exact release instead:

<!-- x-release-please-start-version -->

```sh
v=1.27.2; npm install -g "https://github.com/muitneliss/undercroft/releases/download/v$v/undercroft-cli-$v.tgz"
```

<!-- x-release-please-end -->

Then point it at your server and sign in:

```sh
undercroft config set-profile prod --url https://undercroft.example.test
undercroft auth login          # the same emailed code as the web sign-in
undercroft runs list           # asks which customer
```

Writes are off for each profile until you turn them on. To allow them, run
`undercroft config set-profile prod --allow-writes`.

### Let your agent install it

Claude Code, Codex and other agents get the CLI through a skill. You install the skill, and
the skill installs the CLI:

```sh
npx skills add muitneliss/undercroft --skill undercroft-cli --agent claude-code -y   # or --agent codex
```

Then ask for the task in plain words, for example "list the latest runs for CASE-0042". On
first use the agent checks for `undercroft`. When the CLI is missing, or is a different
release from the one the skill was written for, the agent installs that release with
`npm install -g` and tells you. It passes `--agent` to every command, so each answer is one
JSON envelope it can read.

Two steps stay yours, and the CLI refuses an agent that tries either:

- **Signing in.** The agent asks you for the code that arrives by email.
- **Allowing writes.** Run `undercroft config set-profile <name> --allow-writes` in your own
  terminal.

See [docs/runbook/cli.md](docs/runbook/cli.md),
[ADR 0044](docs/adr/0044-an-agent-reaches-undercroft-as-a-caller.md) and
[ADR 0046](docs/adr/0046-the-cli-installs-once-from-the-latest-release.md).

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

## Documentation

- **Decisions:** [`docs/adr/`](docs/adr/). Each ADR records the options that were rejected
  and why.
- **Runbooks:** [`docs/runbook/`](docs/runbook/):
  - [sign-in](docs/runbook/sign-in-setup.md)
  - [Google ingestion](docs/runbook/google-ingestion-setup.md)
  - [Xero](docs/runbook/xero-setup.md)
  - [the assistant](docs/runbook/assistant-setup.md)
  - [the CLI](docs/runbook/cli.md)
  - [deployment](docs/runbook/deployment.md)
- **Working on the code:** [CLAUDE.md](CLAUDE.md), also linked as `AGENTS.md`, is the map
  of the conventions. The rules it points to live in `.claude/rules/`.
- **Changes:** [CHANGELOG.md](CHANGELOG.md), maintained by release-please.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Report
vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## License

[MIT](LICENSE)
