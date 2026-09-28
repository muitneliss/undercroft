---
title: Architecture
type: source
date: 2026-09-28
tags: []
source: docs/architecture.md
source_path: docs/architecture.md
source_hash: 0c79d9fe630bfe21d03d78b13a204d29a47f97337e85dbe79ad858b6d62ccebe
ingested: 2026-09-28
---

# Architecture

# Architecture

`docs/architecture.md` is the **map of the whole system**: which processes run, what each owns, how data moves between them, and who may touch what. It names the decision behind each part and links to it rather than restating it -- why lives in the ADRs, how in the runbooks, and the working conventions in `CLAUDE.md` and `.claude/rules/`. It carries Mermaid diagrams for the system context, the runtime topology, the code dependency graph, the layers, the data layers and the database roles, a state diagram of a run, and sequence diagrams for each key flow.

**The data layers.** A provider API or an ingest-key script writes through `LakeStore.put` into the raw lake on MinIO -- create-only, content-addressed, with `_blobs/` by sha256, a manifest per version and a `_journal/` per stream. Everything below is a projection that may be dropped and rebuilt ([[ADR 0001 Raw Lake Is the Only Durable Layer]], [[ADR 0002 One Generic Raw Table, No Business Schema]]): `raw.records` (projected from the journal by `loadStreamToRaw` from `raw.load_cursor`), `raw.documents` and `raw.document_text`, then each tenant's `analytics_<slug>` and `dq_<slug>` built by dbt as `undercroft_dbt_<slug>`, read by the Reports division as `undercroft_bi_<slug>`. Deleting a model drops what it built in both schemas, as the same dbt login, before its row goes, and keeps the row when the drop does not happen ([[ADR 0077 Deleting a Model Drops What It Built]]).

**The runtime.** One compose project on one Dokploy stack. The **control plane** (:3000) is the only public surface: the SPA, `/trpc`, `/mcp`, `/api/auth` with the OAuth authorization server, the assistant, and a 60-second alert tick; it holds no sealing key and never reads the lake. The **worker** (:8081, compose network only) owns everything that touches data: ingest, extract, dbt, customer-written SQL, the lake write API `POST /v1/lake/records`, and sealing credentials ([[ADR 0016 The Worker Seals the Control Plane Consents]]). **Kestra** is only a clock -- `ingest_due` every five minutes and `extract_due` hourly ask the worker what is due. Postgres, MinIO, Kestra's Postgres and the one-shots `db-migrate`, `kestra-flows` and `minio-init` complete the stack, each with a memory limit.

**The code.** Only the worker imports `lake` and `connector-runtime`; the UI imports the router as a type only and the CLI is kept an HTTP caller by `cli-no-backdoor`. Backend code runs handler → service → repo, SQL only in repos ([[ADR 0011 Layers Are Directories, Handler to Service to Repo]]). REST sources are YAML specs ([[ADR 0004 Declarative Connectors and the Lake Write API]]); Gmail and Drive are first-party collectors because a spec cannot describe bytes ([[ADR 0015 A First-Party Collector for Byte Sources]]).

**The flows drawn as sequences:** a scheduled ingest (claim one running run per tenant, source and verb; land every 200 records, project each chunk, then counts, watermark and removals; a transform chained only after a successful ingest); connecting a source by OAuth, where the control plane exchanges the code and the worker seals; extracting document text by backlog; running a report through the worker as the tenant's BI login, with NOT\_FOUND for a non-member; pushing through the lake write API; an MCP client signing its person in and calling tools through `appRouter.createCaller`; the assistant proposing a change past the injection gate ([[ADR 0029: The assistant is an interleaf, and it acts only through the router]]); and release to deploy. The run ledger is evidence rather than a log ([[ADR 0021 Run Evidence Is a Ledger, Not a Log Stream]]); counts are defined in [[What an ingest run counts]].

**The security model** tabulates each door -- web session, CLI with `allowWrites`, MCP with a read or write grant, the assistant, the service token, and ingest keys -- and the base procedures every router door shares. Row-level security keys on the connected login, per-tenant passwords are minted per session and never stored, and the BI roles are revoked all of `raw` ([[ADR 0018: per-tenant roles and row-level security]]). The platform `undercroft_bi` reads only the legacy shared `analytics` schema and three `ops` tables.

**Scheduling, observability and release**: cadence or a five-field cron evaluated in Singapore time ([[ADR 0059: A sync may run on a cron expression, beside the four presets]]); `x-trace-id` on every response and export to the host's `otel-lgtm` ([[ADR 0058: Every request is traced, into the host's shared otel-lgtm stack]]); and a release-only deploy that is verified by image digest ([[Runbook Deployment]]).
