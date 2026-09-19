---
title: Runbook Deployment
type: source
date: 2026-09-19
tags: []
source: docs/runbook/deployment.md
source_path: docs/runbook/deployment.md
source_hash: daa54f3b9b03084b81213803c165965e776d69a253814fe983dff64999ef3c29
ingested: 2026-09-19
---

# Runbook Deployment

How Undercroft reaches and stays on the Dokploy host `lowbit.link` as one raw-compose stack. The control plane is now the only public surface: the Reports division inside it is the BI, and Metabase is gone ([[ADR 0020: BI is first-party, Metabase leaves the stack]]). The server compose differs from the development one in three ways (published images, no host ports, a unique network alias per service). Merging the release-please PR cuts a tag; CI builds the images and runs `scripts/dokploy.ts preflight → deploy → verify → smoke`, where `verify` compares the running image config digests against ghcr rather than trusting Dokploy's `done`, and treats the two one-shot services (`db-migrate`, `kestra-flows`) as "must have exited 0" by reading the compose file's own `service_completed_successfully` declarations. The smoke probe is the control plane's `/api/health` alone.

Environment variables: Dokploy only injects what a service's `environment:` block names; the `:?set in .env` variables hard-fail the stack if unset (S3 keys, the Postgres passwords for the bootstrap user and the two platform roles, the Kestra user/password and its Postgres password, the trigger token, the secret key, the session secret, the public URL). The per-source clients default to empty and are set when a source is offered: the Google ingest client for Gmail and Drive, the Xero client (see [[Runbook Xero Setup]]); HubSpot needs none, its token is pasted. Neither dbt nor BI has a password of its own any more — each build and each question runs as the tenant's own login, minted right before (ADR 0018) — so `UNDERCROFT_DBT_PASSWORD` and `UNDERCROFT_METABASE_PG_PASSWORD` are dead, and removing them and the `undercroft-bi` domain from Dokploy's environment is a human's step, because CI never writes the blob. Each service connects to Postgres as its own role: `db-migrate` is the one service using the bootstrap superuser, applies the schema, then sets `undercroft_app`'s and `undercroft_worker`'s passwords, so the grant model in `packages/db/sql` binds; the offline suites run as those roles via `db.become(...)`.

Kestra's flows are delivered by the deploy: `flows/` is baked into the control-plane image and the `kestra-flows` one-shot runs `scripts/kestraFlows.ts` against Kestra's API on every deploy (PUT per flow, POST when new), exiting non-zero on a rejected flow so the worker never starts against last release's flow. The one flow, `ingest_due`, asks the worker every fifteen minutes which (customer, source) pairs are due and starts each; a pair already running is a 409 the flow ignores. Kestra has no domain; executions are inspected over a read-only SSH tunnel (`{{ envs.x }}` reads `ENV_X`; Kestra silently 401s on a password that fails its complexity rules).

The runbook also covers applying migrations by hand, sign-in setup and the first superadmin via `UNDERCROFT_SUPERADMINS`, rollback by pinning `IMAGE_TAG` to a published tag (the release stamp is printed in every page's colophon), and the known gaps: the real `pg` + `search_path` path is exercised on deploy, not in the gate; a real login (not `SET ROLE`) is proven only by `bun run itest` against the compose Postgres; the raw lake is not in a backup set.
