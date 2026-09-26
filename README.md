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
[![Agent skills](https://img.shields.io/badge/npx%20skills-undercroft-000000)](docs/runbook/agent-skills.md)

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
  A spec is data, validated against `specs/schema/connector.v1.json`, so a new REST source
  needs no migration. It ships in the worker image, and the control plane lists the sources
  it can connect, so offering one to users is a small code change and a release. HubSpot and
  Xero ship as examples in `specs/connectors/`.
- **No business schema ships.** Records land in one generic table; every table above it
  is a dbt model you wrote. Undercroft has no opinion about what a "customer" is.
- **Multi-tenant.** Per-tenant credentials sealed with AES-256-GCM, and a control-plane
  UI where someone connects their own accounts. Each tenant's rows are fenced by row-level
  security, and its people are viewers, members or admins. An admin invites, changes a
  role and removes a member, but never the last admin.
- **Anything can ingest.** A REST lake API means a shell script or an orchestrator can
  land data too — through the same create-only, content-addressed path.
- **Documents, not only records.** Gmail and Drive are first-party collectors, because a
  PDF is bytes and a YAML spec cannot describe bytes. Their text is extracted and lands
  beside the records. A tenant can connect several mailboxes and drives, and each one is a
  source of its own. A file is recognised by its type first, Google Docs, Sheets and Slides
  are exported, and a signed OpenAttestation record is verified before any of it is read;
  [the file-format reference](docs/reference/file-formats.md) lists every type.
- **Search the whole lake.** One box over both payloads and document text, folded so that
  Vietnamese matches with or without tone marks, and stemmed for English.
- **The BI is first-party.** Questions and dashboards live in the Reports division, and
  every one runs as the tenant's own read-only login — not as the web process.
- **It says when a sync breaks.** A failed run, a grant about to lapse and an ingest key
  about to expire are emailed to the tenant's admins. A failure, and the run that next
  succeeds, can also post to the operators' Lark group.
- **An assistant with exactly your permissions.** It reaches the platform's own procedures
  through the real role gates, so it can refuse you; a change is proposed as a proof you
  strike, and a separate model checks you asked for it before one is ever offered.
- **A CLI for people and agents.** `undercroft` does everything the web UI does, one command
  per API procedure, as the person who signed in — never more. Writes stay off for
  each profile until a person turns them on.
- **An MCP server for any agent.** claude.ai, Claude Desktop, Claude Code and any other MCP
  client get every procedure as a tool at `/mcp`, signed in with Google or a personal token,
  with a read or write grant the person chooses. Query results and live runs render as
  widgets in the chat.
- **Skills that teach an agent the workflows.** One family, installed with `npx skills` or
  served by `/mcp` itself, works over either door. The model builder interviews the person,
  checks the SQL before it saves, and asks before it builds.

## Ways in

Every way in reaches the same procedures through the same role gates, as the person who
signed in. This page only says which to choose; each runbook says how.

| Way in                  | Choose it when                                                                | How                                              |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| The web UI              | you are a person at a browser                                                 | [sign-in](docs/runbook/sign-in-setup.md)         |
| The `undercroft` CLI    | you work in a terminal or a script (Node 22+)                                 | [the CLI](docs/runbook/cli.md#running-it)        |
| The `undercroft` skills | your agent should know the workflows, not just the tools: over MCP or the CLI | [agent skills](docs/runbook/agent-skills.md)     |
| MCP at `/mcp`           | your agent speaks MCP: claude.ai, Claude Desktop, Claude Code                 | [connecting over MCP](docs/runbook/mcp-setup.md) |
| The assistant           | you want to ask in plain words inside the web UI                              | [the assistant](docs/runbook/assistant-setup.md) |

Two things stay a person's on every agent path: signing in, and allowing writes. The
decisions are [ADR 0044](docs/adr/0044-an-agent-reaches-undercroft-as-a-caller.md) (the CLI),
[ADR 0060](docs/adr/0060-an-agent-reaches-undercroft-over-mcp.md) and
[ADR 0061](docs/adr/0061-an-mcp-client-signs-its-person-in-and-draws-two-widgets.md) (MCP).

## Design rules

1. **Raw is the only durable layer.** Everything in Postgres is a projection and may be
   dropped and rebuilt. Raw cannot be recomputed.
2. **Never guess; return nothing and say why.** An empty cell is visibly missing; a wrong
   value is invisibly false. "No evidence" is never "pass". Money is a string end to end,
   and an unreadable amount is `null`, never `0`.
3. **One writer, many callers.** Every byte enters through the lake's create-only path,
   whatever called it.

## Stack

TypeScript on [Bun](https://bun.sh), end to end. Postgres, S3 (MinIO, run as the
`pgsty/minio` community build; see
[ADR 0050](docs/adr/0050-the-raw-lake-runs-a-community-build-of-minio.md)),
[Kestra](https://kestra.io) for scheduling, [dbt](https://getdbt.com) for transforms, and
charts in the control plane itself — plus a read-only Postgres role for any BI tool you
would rather point at it.

## Development

Every operation goes through [Task](https://taskfile.dev), and `task ci:verify` is the gate:
it runs with no Docker, no network and no credentials. [CONTRIBUTING.md](CONTRIBUTING.md)
has the setup, the local stack and the checks outside the gate.

## Documentation

This README is an index. How to do a thing lives in its runbook, why it is that way lives in
its ADR, and what exactly it accepts lives in a reference page.

- **Runbooks,** one per way in or per thing to set up ([`docs/runbook/`](docs/runbook/)):
  - Using it: [the CLI](docs/runbook/cli.md), [connecting an agent over MCP](docs/runbook/mcp-setup.md),
    [agent skills](docs/runbook/agent-skills.md)
  - Setting it up: [sign-in](docs/runbook/sign-in-setup.md),
    [the assistant](docs/runbook/assistant-setup.md),
    [Google ingestion](docs/runbook/google-ingestion-setup.md), [Xero](docs/runbook/xero-setup.md)
  - Running it: [deployment](docs/runbook/deployment.md)
- **Decisions:** [`docs/adr/`](docs/adr/). Each ADR records the options that were rejected
  and why.
- **Reference:** [file formats a Gmail or Drive connection can land](docs/reference/file-formats.md).
- **Design:** [the CLI's home page and sign-in](docs/design/cli-home-and-sign-in.md).
- **Working on the code:** [CLAUDE.md](CLAUDE.md), also linked as `AGENTS.md`, is the map
  of the conventions. The rules it points to live in `.claude/rules/`.
- **Changes:** [CHANGELOG.md](CHANGELOG.md), maintained by release-please.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Report
vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## License

[MIT](LICENSE)
