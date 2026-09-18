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
[Kestra](https://kestra.io) for scheduling, [dbt](https://getdbt.com) for transforms,
and any BI tool that speaks Postgres.

## Development

```sh
bun install
bun run verify      # typecheck, lint, format, tests -- offline, no credentials needed
bun run migrate     # apply the schema to a real Postgres (UNDERCROFT_POSTGRES_DSN)
```

`verify` is the gate and runs with no Docker, no network and no credentials. `bun run
itest` adds the Docker-backed integration tier.

Signing in to the control plane is **invite-only**, by Google or a one-time code.
[docs/runbook/sign-in-setup.md](docs/runbook/sign-in-setup.md) walks through the OAuth client,
the mail key, the first invitation, and how to check each step actually worked.

## License

MIT
